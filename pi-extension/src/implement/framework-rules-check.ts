/**
 * Framework-rules check — runs the forbidden-import rules of the plan's
 * locked framework against the target project during implement-stage
 * verification. Mirrors arch-rules-check.ts: a checker config is emitted
 * (dependency-cruiser JSON for TypeScript maps, import-linter INI for
 * Python maps) and the matching tool runs it when installed. The tool is
 * never installed by this module: when absent, the check reports
 * toolAvailable=false so the caller can warn-and-continue honestly.
 *
 * The framework map comes from the chirpi framework-library; the framework
 * id comes from the plan's `## Framework` field (manifest.ts). When the
 * field is missing or `none`, the check skips cleanly.
 *
 * Executable rules come from the map's machine-readable `## Rules` section
 * when present (preferred — strict, hand-written globs). Maps without one
 * fall back to conservative prose compilation of `## Forbidden patterns`:
 * only unambiguous "X importing Y" items compile (layout folder before
 * "import", folder/backticked-module targets after it, em-dash explanation
 * ignored). Every rule cites its source; items too vague to compile stay
 * visible in the report, never silently dropped.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadFrameworkMap, validateFrameworkMap, type FrameworkMap } from "@adi-mudi/pi-chirpi";
import { getArtifactPaths } from "../core/paths.js";
import { atomicWriteFile } from "../io/atomic-write.js";
import { parseFrameworkField, FRAMEWORK_NONE } from "./manifest.js";

export type FrameworkRulesTool = "dependency-cruiser" | "import-linter";

export interface FrameworkRule {
    /** The reason / source sentence this rule enforces. */
    source: string;
    /** Importer side: a project path glob (e.g. "routes/**",
     *  "*.controller.ts"). */
    from: string;
    /** Imported side: a path glob (e.g. "models/**") or a `pkg:<module>`
     *  external package (e.g. "pkg:express"). */
    to: string;
}

export interface FrameworkRulesResult {
    /** Framework id locked in the plan manifest; null when the plan carries
     *  no `## Framework` field. */
    frameworkId: string | null;
    /** True when the check did not run (no field, `none`, invalid map, no
     *  derivable rules, or unsupported language). skipReason says why. */
    skipped: boolean;
    skipReason: string | null;
    /** Executable rules derived from the map's forbidden patterns. */
    rules: FrameworkRule[];
    /** Emitted checker config, relative to the project root. */
    configPath: string | null;
    tool: FrameworkRulesTool | null;
    toolAvailable: boolean;
    /** The tool actually ran (rules derived + config emitted + tool available). */
    ran: boolean;
    violations: string[];
}

export type FrameworkRulesExecFn = (
    cmd: string,
    args: string[],
    cwd: string,
) => Promise<{ code: number; output: string }>;

const MAX_VIOLATIONS = 20;

/** Backticked tokens that are values or types, not importable modules. */
const NON_MODULE_TOKENS = new Set([
    "req", "res", "ctx", "app", "db", "request", "response", "current_app",
]);

async function defaultExec(cmd: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve) => {
        execFile(cmd, args, { cwd, timeout: 120_000, maxBuffer: 500_000 }, (err, stdout, stderr) => {
            const output = ((stdout ?? "") + (stderr ?? "")).trim();
            if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
                resolve({ code: -1, output });
                return;
            }
            const code = typeof err?.code === "number" ? err.code : err ? 1 : 0;
            resolve({ code, output });
        });
    });
}

function collectLines(output: string, pattern: RegExp): string[] {
    return output
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && pattern.test(l))
        .slice(0, MAX_VIOLATIONS);
}

/** Extract the body of a `## <title>` section from a framework map. */
function extractSection(content: string, title: string): string {
    const m = content.match(new RegExp(`^##\\s+${title}\\s*$`, "m"));
    if (!m || m.index === undefined) return "";
    const tail = content.slice(m.index + m[0].length);
    const next = tail.search(/^##\s/m);
    return next >= 0 ? tail.slice(0, next) : tail;
}

/** Folder aliases declared in the map's `## Layout map` fenced block
 *  (basenames of entries ending with `/`, e.g. "routes", "services"). */
export function parseLayoutFolders(map: FrameworkMap): string[] {
    const fence = extractSection(map.content, "Layout map").match(/```[^\n]*\n([\s\S]*?)```/);
    if (!fence) return [];
    const aliases = new Set<string>();
    for (const m of fence[1].matchAll(/([\w-]+)\//g)) {
        aliases.add(m[1]);
    }
    return [...aliases].sort();
}

/** True when `text` names the folder alias, singular or plural. */
function mentionsAlias(text: string, alias: string): boolean {
    const singular = alias.endsWith("s") ? alias.slice(0, -1) : alias;
    return new RegExp(`\\b(?:${alias}|${singular})\\b`, "i").test(text);
}

/** Resolve a backticked token to a layout alias when it names one
 *  (`components/` → "components", `lib/db` → "lib/db" when lib is a folder),
 *  otherwise return the token unchanged. */
function resolveTargetToken(token: string, folders: string[]): string {
    const stripped = token.replace(/\/+$/, "");
    const first = stripped.split("/")[0];
    if (folders.some((f) => f === first || (f.endsWith("s") && f.slice(0, -1) === first))) {
        return folders.find((f) => f === stripped) ?? stripped;
    }
    for (const f of folders) {
        if (f === stripped || (f.endsWith("s") && f.slice(0, -1) === stripped)) return f;
    }
    return stripped;
}

/** Compile the map's `## Forbidden patterns` prose into executable rules.
 *  Fallback for maps without a `## Rules` section. Conservative by design:
 *  an item only compiles when a layout folder is named before the word
 *  "import" (the importer) and at least one target (layout folder or
 *  backticked module) is named after it, before any em-dash explanation.
 *  Everything else stays prose-only. Output uses the same glob / `pkg:`
 *  shape as parsed `## Rules` lines so one emission pipeline serves both. */
export function deriveForbiddenRules(map: FrameworkMap): FrameworkRule[] {
    const folders = parseLayoutFolders(map);
    if (folders.length === 0) return [];
    const section = extractSection(map.content, "Forbidden patterns");

    // Join wrapped numbered items into single lines.
    const items: string[] = [];
    let current: string | null = null;
    for (const raw of section.split(/\r?\n/)) {
        const line = raw.trim();
        const start = line.match(/^\d+\.\s+(.*)$/);
        if (start) {
            if (current) items.push(current);
            current = start[1];
        } else if (current && line) {
            current += " " + line;
        }
    }
    if (current) items.push(current);

    const rules: FrameworkRule[] = [];
    for (const item of items) {
        const importIdx = item.search(/\bimport/i);
        if (importIdx <= 0) continue;
        const before = item.slice(0, importIdx);
        // Explanation after an em-dash / spaced hyphen often names folders
        // that are ALLOWED targets ("goes through services") — ignore it.
        const after = item
            .slice(importIdx)
            .split(/—| - /)[0];
        const from = folders.find((f) => mentionsAlias(before, f));
        if (!from) continue;

        const targets = new Set<string>();
        for (const f of folders) {
            if (f !== from && mentionsAlias(after, f)) targets.add(`${f}/**`);
        }
        for (const m of after.matchAll(/`([^`]+)`/g)) {
            const token = m[1].trim();
            if (!/^[@\w][\w./-]*$/.test(token) || token.length <= 2) continue;
            if (NON_MODULE_TOKENS.has(token.toLowerCase())) continue;
            const resolved = resolveTargetToken(token, folders);
            if (resolved === from) continue;
            // A resolved layout path becomes a path glob; anything else is
            // treated as an external package.
            targets.add(folders.some((f) => resolved === f || resolved.startsWith(`${f}/`)) ? `${resolved}/**` : `pkg:${resolved}`);
        }
        for (const to of [...targets].sort()) {
            rules.push({ source: item, from: `${from}/**`, to });
        }
    }
    return rules;
}

/** The map's executable rules: parsed `## Rules` lines when present
 *  (preferred — strict, hand-written), prose compilation as fallback. */
export function frameworkRulesFromMap(map: FrameworkMap): FrameworkRule[] {
    if (map.rules.length > 0) {
        return map.rules.map((r) => ({ source: r.reason, from: r.from, to: r.to }));
    }
    return deriveForbiddenRules(map);
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert a path glob to a regex fragment: `**` matches across directories,
 *  `*` within one segment. */
function globToRegex(glob: string): string {
    return glob
        .split("**")
        .map((p) => escapeRegExp(p).replace(/\\\*/g, "[^/]*"))
        .join(".*");
}

function ruleName(id: string, rule: FrameworkRule): string {
    const clean = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    return `framework-${clean(id)}-${clean(rule.from)}-not-${clean(rule.to)}`;
}

/** Convert a path glob to a dotted module expression for import-linter
 *  (`routers/**` → `routers`, a leading-double-star glob for views.py → `views`). */
function globToModule(glob: string): string {
    let g = glob.replace(/^(\*\*\/)+/, "");
    g = g.replace(/\.py$/, "");
    g = g.replace(/\/(\*\*?)?$/, "");
    return g.replace(/\//g, ".");
}

/** Emit a dependency-cruiser JSON config with one forbidden rule per
 *  framework rule (same shape chirpi's arch-rules emits). */
export function emitFrameworkDependencyCruiserConfig(id: string, rules: FrameworkRule[]): string {
    const forbidden = rules.map((rule) => {
        const toPkg = rule.to.startsWith("pkg:") ? rule.to.slice(4) : null;
        return {
            name: ruleName(id, rule),
            severity: "error",
            comment: rule.source,
            from: { path: `(^|/)${globToRegex(rule.from)}` },
            to: toPkg !== null
                ? { path: `^${globToRegex(toPkg)}${/[*/]$/.test(toPkg) ? "" : "(/|$)"}` }
                : { path: `(^|/)${globToRegex(rule.to)}` },
        };
    });
    return JSON.stringify({ forbidden, options: { doNotFollow: { path: "node_modules" } } }, null, 2) + "\n";
}

/** Emit an import-linter INI config with one forbidden contract per
 *  framework rule. `rootPackage` defaults to "src". */
export function emitFrameworkImportLinterConfig(
    id: string,
    rules: FrameworkRule[],
    options?: { rootPackage?: string },
): string {
    const lines = ["[importlinter]", `root_package = ${options?.rootPackage ?? "src"}`, ""];
    rules.forEach((rule, i) => {
        lines.push(`[importlinter:contract:${i + 1}]`);
        lines.push(`name = ${ruleName(id, rule)} — ${rule.source}`);
        lines.push("type = forbidden");
        lines.push(`source_modules = ${globToModule(rule.from)}`);
        lines.push(`forbidden_modules = ${rule.to.startsWith("pkg:") ? rule.to.slice(4) : globToModule(rule.to)}`);
        lines.push("");
    });
    return lines.join("\n");
}

function skipResult(frameworkId: string | null, reason: string): FrameworkRulesResult {
    return {
        frameworkId,
        skipped: true,
        skipReason: reason,
        rules: [],
        configPath: null,
        tool: null,
        toolAvailable: false,
        ran: false,
        violations: [],
    };
}

/** Run the locked framework's forbidden-import rules at the implement gate.
 *  The exec function is injectable so tests can mock the runner instead of
 *  installing dependency-cruiser / import-linter. */
export async function checkFrameworkRules(
    cwd: string,
    runId: string,
    execFn: FrameworkRulesExecFn = defaultExec,
): Promise<FrameworkRulesResult> {
    const ap = getArtifactPaths(cwd, runId);
    let planContent: string;
    try {
        planContent = fs.readFileSync(ap.plan, "utf8");
    } catch {
        return skipResult(null, `plan.md not readable — framework check idle`);
    }

    const field = parseFrameworkField(planContent, cwd);
    if (!field.found) {
        return skipResult(null, "no `## Framework` field in plan.md — framework check idle");
    }
    if (field.error) {
        return skipResult(field.value, `invalid \`## Framework\` field: ${field.error}`);
    }
    if (field.value === FRAMEWORK_NONE || !field.value) {
        return skipResult(FRAMEWORK_NONE, "manifest records `none` — no framework checks apply");
    }

    const map = loadFrameworkMap(cwd, field.value);
    if (!map) {
        return skipResult(field.value, `framework map "${field.value}" not found in the chirpi framework-library`);
    }
    const problems = validateFrameworkMap(map);
    if (problems.length > 0) {
        return skipResult(field.value, `framework map "${field.value}" is invalid: ${problems.join("; ")}`);
    }

    const rules = frameworkRulesFromMap(map);
    if (rules.length === 0) {
        return skipResult(
            field.value,
            `no executable rules could be derived from the "${field.value}" forbidden patterns — review the map's prose manually`,
        );
    }

    fs.mkdirSync(ap.implementDir, { recursive: true });

    if (map.language === "typescript") {
        const configRel = path.relative(
            cwd,
            path.join(ap.implementDir, "framework-rules.dependency-cruiser.json"),
        );
        atomicWriteFile(path.join(cwd, configRel), emitFrameworkDependencyCruiserConfig(field.value, rules));
        const base: Omit<FrameworkRulesResult, "toolAvailable" | "ran" | "violations"> = {
            frameworkId: field.value,
            skipped: false,
            skipReason: null,
            rules,
            configPath: configRel,
            tool: "dependency-cruiser",
        };
        const bin = path.join(cwd, "node_modules", ".bin", "depcruise");
        if (!fs.existsSync(bin)) {
            return { ...base, toolAvailable: false, ran: false, violations: [] };
        }
        const target = fs.existsSync(path.join(cwd, "src")) ? "src" : ".";
        const { code, output } = await execFn(bin, ["--validate", configRel, target], cwd);
        const violations = code === 0 ? [] : collectLines(output, /error|violation/i);
        if (code !== 0 && violations.length === 0) {
            violations.push(`dependency-cruiser reported framework violations (exit code ${code})`);
        }
        return { ...base, toolAvailable: true, ran: true, violations };
    }

    if (map.language === "python") {
        const configRel = path.relative(cwd, path.join(ap.implementDir, "framework-rules.importlinter"));
        atomicWriteFile(path.join(cwd, configRel), emitFrameworkImportLinterConfig(field.value, rules));
        const base: Omit<FrameworkRulesResult, "toolAvailable" | "ran" | "violations"> = {
            frameworkId: field.value,
            skipped: false,
            skipReason: null,
            rules,
            configPath: configRel,
            tool: "import-linter",
        };
        const probe = await execFn("lint-imports", ["--version"], cwd);
        if (probe.code !== 0) {
            return { ...base, toolAvailable: false, ran: false, violations: [] };
        }
        const { code, output } = await execFn("lint-imports", ["--config", configRel], cwd);
        const violations = code === 0 ? [] : collectLines(output, /BROKEN|not allowed|error/i);
        if (code !== 0 && violations.length === 0) {
            violations.push(`import-linter reported broken framework contracts (exit code ${code})`);
        }
        return { ...base, toolAvailable: true, ran: true, violations };
    }

    return skipResult(field.value, `no checker for framework language "${map.language}"`);
}
