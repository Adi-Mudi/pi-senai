/**
 * Implement-stage discipline signal collector.
 *
 * Runs at the implement → implemented transition (i.e. before /senai-approve
 * advances the run). Collects discipline signals:
 *   1. Test smell scan report (deterministic, via test-discipline.ts).
 *   2. Project coverage (read from the hard-coded `coverage/coverage-summary.json`
 *      path — there is no `coveragePath` config field).
 *   3. Mission verification re-run (parses `<plan>` `## Verification`).
 *   4. Bugfix missions only: the brief's `## Regression test plan` must name
 *      a real test file covered by the plan's `## Files` manifest.
 *
 * The collector is advisory by default; strict mode promotes blocking findings
 * to a hard gate. Strict mode is opt-in via the SENAI_TEST_DISCIPLINE_STRICT
 * environment variable, so this is safe to enable on day one and harden later.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { scanTestFilesOnDisk, resolveTestPaths, detectDeletedTestFiles, isTestFilePath, type Finding, type ScanReport } from "./discipline.js";
import { parseFilesManifest, parseFrameworkField, diffFilesManifest, type ManifestDiff, type ManifestEntry } from "./manifest.js";
import { checkArchRules, type ArchRulesResult } from "./arch-rules-check.js";
import { checkFrameworkRules, type FrameworkRulesResult } from "./framework-rules-check.js";
import { loadArchitectProfile, getLayerMap, profileCodebase, discoverFrameworkLibrary, readFrameworkConfigSafe } from "@adi-mudi/pi-chirpi";
import { getArtifactPaths, getRunMissionBriefPath } from "../core/paths.js";
import { parseBriefMissionType } from "../core/mission-brief.js";
import { atomicWriteFile } from "../io/atomic-write.js";
import type { MissionType, SenaiState } from "../core/state.js";

export interface VerificationStep {
    step: string;
    passed: boolean | null;
    output?: string;
}

/** Bugfix pack signal: the brief's `## Regression test plan` must name a
 *  test file that exists on disk and is covered by the plan's `## Files`
 *  manifest. Every problem is a blocking reason at the implement →
 *  implemented gate (confirm-overridable, same style as verification
 *  failures). Undefined on ImplementSignals for non-bugfix runs. */
export interface BugfixRegressionTestResult {
    /** Test file(s) named in the brief's `## Regression test plan`. */
    candidates: string[];
    /** Problems found; empty = signal passes. */
    problems: string[];
}

export interface ImplementSignals {
    implementArtifactsPresent: boolean;
    testSmellScan: ScanReport | null;
    coveragePct: number | null;
    coverageFloor: number;
    criticalPathCoveragePct: number | null;
    verificationSteps: VerificationStep[];
    blockingFindings: Finding[];
    actionableFindings: Finding[];
    informationalFindings: Finding[];
    /** Phase 3: planned create-files vs disk. Null when the plan has no
     *  valid `## Files` manifest to diff against. */
    manifestDiff: ManifestDiff | null;
    /** Phase 3: emitted arch-rules config run. Null when the check failed. */
    archRules: ArchRulesResult | null;
    /** Phase 4: locked-framework rules run. Null when the check failed. */
    frameworkRules: FrameworkRulesResult | null;
    /** Bugfix pack: regression-test mapping check. Undefined for non-bugfix
     *  runs (optional so existing literal constructions keep compiling). */
    bugfixRegressionTest?: BugfixRegressionTestResult;
    strictMode: boolean;
}

export const DEFAULT_COVERAGE_FLOOR = 80;

/**
 * Read the `## Verification` section from a plan markdown body.
 * Returns a list of steps, each either a command (line starts with `$`) or a
 * manual check (any other line). Empty list if no section is found.
 */
export function parseVerificationSteps(planContent: string): string[] {
    const startMarker = "## Verification";
    const idx = planContent.indexOf(startMarker);
    if (idx < 0) return [];
    // Take from the heading until the next ## heading or end of file.
    const tail = planContent.slice(idx + startMarker.length);
    const nextHeading = tail.search(/^##\s/m);
    const section = nextHeading >= 0 ? tail.slice(0, nextHeading) : tail;

    const steps: string[] = [];
    for (const rawLine of section.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        // Strip leading list markers: "1. ", "- ", "* ", "$ "
        const m = line.match(/^(?:\d+\.\s+|[-*]\s+|\$\s*)/);
        const cleaned = m ? line.slice(m[0].length).trim() : line;
        if (cleaned.length > 0) steps.push(cleaned);
    }
    return steps;
}

/**
 * Heuristic: a step is executable when its command (or its backticked
 * command) starts with a known runner — npm, node, python, make, a `./path`,
 * etc. Prose steps ("Open the app and check the dashboard") are manual
 * checks the orchestrator cannot run.
 */
const EXECUTABLE_STEP_START =
    /^(?:\$\s*)?(?:(?:npm|npx|node|yarn|pnpm|bun|deno|python3?|pip3?|pytest|make|cmake|cargo|go|docker|docker-compose|bash|sh|git|tsc|curl|test|ls|cat|grep|mkdir|cp|mv|rm|cd|echo)\b|\.?\/)/;

export function isExecutableStep(step: string): boolean {
    let s = step.trim();
    if (!s) return false;
    const ticked = s.match(/`([^`]+)`/);
    if (ticked) s = ticked[1].trim();
    return EXECUTABLE_STEP_START.test(s);
}

/**
 * Count the verification steps in a plan body that the orchestrator can
 * actually execute. Prose-only or missing sections return 0.
 */
export function countExecutableVerificationSteps(planContent: string): number {
    return parseVerificationSteps(planContent).filter(isExecutableStep).length;
}

/** Layer names from the project's architecture layer map (pi-chirpi), used
 *  to validate the plan's `## Files` manifest rows. Null when no architecture
 *  or no layer map exists — manifest validation then accepts any non-empty
 *  layer string. */
function loadArchitectureLayerNames(cwd: string): string[] | null {
    try {
        const profile = loadArchitectProfile(cwd);
        if (!profile) return null;
        const map = getLayerMap(profile.selectedArchitecture, cwd);
        return map && map.layers.length > 0 ? map.layers.map((l) => l.name) : null;
    } catch {
        return null;
    }
}

/** Framework ids the codebase profiler detected from the project's
 *  dependencies (chirpi framework-library is the source of truth). Empty on
 *  any profiler failure — detection must never break the gate. */
function detectedFrameworkIds(cwd: string): string[] {
    try {
        return profileCodebase(cwd).detectedFrameworks;
    } catch {
        return [];
    }
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Framework id locked in `.pi/senai/framework.json` (written by chirpi's
 *  /chirpi-predefined-framework and /chirpi-configure-framework). Null when
 *  no lock exists or the file is unreadable/malformed — the safe reader never
 *  throws, and the try/catch guards against an unexpected chirpi failure:
 *  a broken lock file must never crash the gate. */
function lockedFrameworkId(cwd: string): string | null {
    try {
        const { config } = readFrameworkConfigSafe(cwd);
        return config ? config.id : null;
    } catch {
        return null;
    }
}

/** Framework ids named in the plan's `## Tech Stack` section, matched against
 *  the framework-library ids and display names. Only that section is scanned
 *  so random prose can never false-positive. Empty when the plan has no tech
 *  stack section. */
function techStackFrameworkIds(planContent: string, cwd: string): string[] {
    const m = planContent.match(/^##\s+Tech\s*Stack\s*:?\s*$/im);
    if (!m || m.index === undefined) return [];
    const tail = planContent.slice(m.index + m[0].length);
    const next = tail.search(/^##\s/m);
    const section = (next >= 0 ? tail.slice(0, next) : tail).toLowerCase();
    let maps: ReturnType<typeof discoverFrameworkLibrary> = [];
    try {
        maps = discoverFrameworkLibrary(cwd);
    } catch {
        return [];
    }
    const ids: string[] = [];
    for (const map of maps) {
        const names = [map.id, map.framework].filter((n) => n).map((n) => n.toLowerCase());
        if (names.some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`).test(section))) {
            ids.push(map.id);
        }
    }
    return ids.sort();
}

/**
 * Hard gate for the planning → planned approval. Three checks, in order:
 *   1. The plan must contain at least one executable verification step. A
 *      missing plan file or a missing / prose-only `## Verification` section
 *      blocks the advance.
 *   2. The plan must carry a valid `## Files` manifest (parsed via
 *      manifest.ts). A missing section or any validation error blocks the
 *      advance with the exact errors listed as plan.md:<line>.
 *   3. Framework lock: when the codebase profiler detected a framework or
 *      the plan's `## Tech Stack` names one, the plan's `## Framework` field
 *      must record the same framework id. A missing field, `none`, or a
 *      contradicting id blocks the advance. An unknown id is a parse error.
 *      When nothing is detected or named, the field is optional and `none`
 *      means no framework checks run downstream. A framework locked in
 *      `.pi/senai/framework.json` (chirpi) must match the field exactly —
 *      a mismatch blocks the advance regardless of the other signals.
 */
export function checkPlanVerificationGate(cwd: string, runId: string): { blocked: boolean; reason: string | null } {
    const planPath = getArtifactPaths(cwd, runId).plan;
    let content: string;
    try {
        content = fs.readFileSync(planPath, "utf8");
    } catch {
        return { blocked: true, reason: `Plan file not readable at ${planPath} — cannot verify the ## Verification section.` };
    }
    const executable = countExecutableVerificationSteps(content);
    if (executable === 0) {
        return {
            blocked: true,
            reason: "Plan has no executable verification steps — add at least one runnable command (e.g. `npm test`) under `## Verification` in plan.md, then approve again.",
        };
    }
    const layerNames = loadArchitectureLayerNames(cwd);
    const manifest = parseFilesManifest(content, layerNames ? { layers: layerNames } : undefined);
    if (manifest.missingSection) {
        return {
            blocked: true,
            reason: "Plan is missing the mandatory `## Files` manifest — add a `| path | layer | action | reason |` table under `## Files` in plan.md, then approve again.",
        };
    }
    if (manifest.errors.length > 0) {
        const listed = manifest.errors.slice(0, 10).map((e) => `plan.md:${e.line}: ${e.message}`);
        return {
            blocked: true,
            reason: `Plan \`## Files\` manifest has ${manifest.errors.length} error(s):\n${listed.join("\n")}\nFix plan.md, then approve again.`,
        };
    }
    const framework = parseFrameworkField(content, cwd);
    if (framework.error) {
        return {
            blocked: true,
            reason: `Plan \`## Framework\` field is invalid (plan.md:${framework.line}): ${framework.error}\nFix plan.md, then approve again.`,
        };
    }
    // Hard lock: a framework locked via chirpi (.pi/senai/framework.json) wins
    // over every other signal — the plan's ## Framework field must match it.
    const locked = lockedFrameworkId(cwd);
    if (locked && locked !== "none") {
        if (!framework.found) {
            return {
                blocked: true,
                reason: `Framework lock missing: .pi/senai/framework.json locks \`${locked}\` but the plan has no \`## Framework\` field — add a \`## Framework\` section recording \`${locked}\` to plan.md, then approve again.`,
            };
        }
        if (framework.value !== locked) {
            return {
                blocked: true,
                reason: `Framework lock mismatch: .pi/senai/framework.json locks \`${locked}\` but the \`## Framework\` field records \`${framework.value ?? "none"}\` — fix the \`## Framework\` field in plan.md (or re-run /chirpi-configure-framework to change the lock), then approve again.`,
            };
        }
    }
    if (locked === "none" && framework.found && framework.value && framework.value !== "none") {
        return {
            blocked: true,
            reason: `Framework lock mismatch: .pi/senai/framework.json locks \`none\` (architecture-only) but the \`## Framework\` field records \`${framework.value}\` — fix the \`## Framework\` field in plan.md (or re-run /chirpi-configure-framework to change the lock), then approve again.`,
        };
    }
    const expectedFrameworks = [...new Set([...detectedFrameworkIds(cwd), ...techStackFrameworkIds(content, cwd)])].sort();
    if (expectedFrameworks.length > 0) {
        const expectedList = expectedFrameworks.join(", ");
        if (!framework.found) {
            return {
                blocked: true,
                reason: `Framework lock missing: framework(s) ${expectedList} were detected from dependencies or named in the plan's tech stack — add a \`## Framework\` section to plan.md recording the chosen framework id, then approve again.`,
            };
        }
        if (framework.value === "none") {
            return {
                blocked: true,
                reason: `Framework lock contradiction: framework(s) ${expectedList} were detected from dependencies or named in the plan's tech stack, but the \`## Framework\` field says \`none\` — record the framework id in plan.md, then approve again.`,
            };
        }
        if (framework.value && !expectedFrameworks.includes(framework.value)) {
            return {
                blocked: true,
                reason: `Framework lock contradiction: the \`## Framework\` field records \`${framework.value}\` but framework(s) ${expectedList} were detected from dependencies or named in the plan's tech stack — fix the \`## Framework\` field in plan.md, then approve again.`,
            };
        }
    }
    return { blocked: false, reason: null };
}

/**
 * Baseline verification steps derived from the project itself, independent of
 * what the planner wrote. Reads `<cwd>/package.json` scripts: `build` maps to
 * `npm run build`, `test` maps to `npm test`. Empty when no package.json or
 * no matching scripts exist.
 */
export function deriveBaselineVerificationSteps(cwd: string): string[] {
    try {
        const raw = fs.readFileSync(path.join(cwd, "package.json"), "utf8");
        const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
        const scripts = pkg.scripts ?? {};
        const steps: string[] = [];
        if (typeof scripts.build === "string" && scripts.build.trim()) steps.push("npm run build");
        if (typeof scripts.test === "string" && scripts.test.trim()) steps.push("npm test");
        return steps;
    } catch {
        return [];
    }
}

/**
 * Run a verification step via bash. Returns passed=true/false or passed=null
 * when the step was a manual check (does not start with a recognizable shell
 * command and the runner cannot execute it).
 */
export async function runVerificationStep(step: string, cwd: string, timeoutMs: number = 60000): Promise<VerificationStep> {
    if (!isExecutableStep(step)) {
        return { step, passed: null };
    }
    try {
        const { execFile } = await import("node:child_process");
        return await new Promise((resolve) => {
            execFile(
                "/bin/bash",
                ["-c", step],
                { cwd, timeout: timeoutMs, maxBuffer: 200_000 },
                (err, stdout, stderr) => {
                    const passed = !err;
                    const out = ((stdout ?? "") + (stderr ?? "")).trim().slice(0, 2000);
                    resolve({ step, passed, output: passed ? out : (out || String(err)) });
                },
            );
        });
    } catch (err: unknown) {
        return { step, passed: false, output: String(err) };
    }
}

/**
 * Read a coverage report from a known location. Today this is a stub: returns
 * null unless the project has a coverage file at `<cwd>/coverage/coverage-summary.json`.
 * The implementer sub-agent runs the project's own coverage tool and writes
 * the result; this reader picks it up if present.
 */
export function readCoverageFromProject(cwd: string): number | null {
    const candidates = [
        path.join(cwd, "coverage", "coverage-summary.json"),
        path.join(cwd, "coverage-summary.json"),
    ];
    for (const p of candidates) {
        try {
            if (!fs.existsSync(p)) continue;
            const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
            // Istanbul / nyc shape: { total: { lines: { pct }, branches: { pct } } }
            const total = (raw as { total?: { lines?: { pct?: number }; branches?: { pct?: number } } }).total;
            if (total?.lines?.pct != null && total?.branches?.pct != null) {
                return Math.min(total.lines.pct, total.branches.pct);
            }
            if (total?.lines?.pct != null) {
                return total.lines.pct;
            }
        } catch {
            // Ignore — return null on parse failure.
        }
    }
    return null;
}

function isStrictMode(): boolean {
    return process.env.SENAI_TEST_DISCIPLINE_STRICT === "1";
}

/** Persisted implement/manifest-diff-report.md — the Phase-3 manifest diff
 *  as a run artifact, so the approve gate and doctor can verify it like any
 *  other stage artifact. Deterministic; no LLM involved. */
export function formatManifestDiffReport(diff: ManifestDiff | null): string {
    const lines = [
        "# Manifest diff report",
        "",
        `Generated: ${new Date().toISOString()}`,
        "",
    ];
    if (!diff) {
        lines.push("No valid `## Files` manifest in plan.md — diff not computed.");
        return lines.join("\n") + "\n";
    }
    lines.push(`Missing planned create-files: ${diff.missing.length}`);
    for (const p of diff.missing) lines.push(`- ${p}`);
    lines.push("");
    lines.push(`Unexpected files in manifest folders: ${diff.unexpected.length}`);
    for (const p of diff.unexpected) lines.push(`- ${p}`);
    if (diff.missing.length === 0 && diff.unexpected.length === 0) {
        lines.push("", "Clean: every planned create-file exists; no unplanned files in manifest folders.");
    }
    return lines.join("\n") + "\n";
}

/** Persisted implement/arch-rules-report.md — the Phase-3 arch-rules run
 *  as a run artifact. Tool-absent is recorded honestly as a skip. */
export function formatArchRulesReport(result: ArchRulesResult | null): string {
    const lines = [
        "# Arch rules report",
        "",
        `Generated: ${new Date().toISOString()}`,
        "",
    ];
    if (!result) {
        lines.push("Arch-rules check failed to run (collection error).");
        return lines.join("\n") + "\n";
    }
    if (!result.configFound) {
        lines.push("No emitted arch-rules config found (.dependency-cruiser.json / .importlinter) — check skipped.");
        return lines.join("\n") + "\n";
    }
    lines.push(`Config: ${result.configPath}`);
    lines.push(`Tool: ${result.tool}`);
    if (!result.toolAvailable) {
        lines.push("", `SKIPPED: ${result.tool} is not installed — install it in the target project to enforce the layer map.`);
        return lines.join("\n") + "\n";
    }
    lines.push(`Violations: ${result.violations.length}`);
    for (const v of result.violations) lines.push(`- ${v}`);
    if (result.violations.length === 0) lines.push("", "Clean: the architecture layer map holds.");
    return lines.join("\n") + "\n";
}

/** Persisted implement/framework-rules-report.md — the Phase-4 framework
 *  rules run as a run artifact. Skips (`none`, no field, no derivable rules)
 *  and tool-absent runs are recorded honestly. */
export function formatFrameworkRulesReport(result: FrameworkRulesResult | null): string {
    const lines = [
        "# Framework rules report",
        "",
        `Generated: ${new Date().toISOString()}`,
        "",
    ];
    if (!result) {
        lines.push("Framework-rules check failed to run (collection error).");
        return lines.join("\n") + "\n";
    }
    if (result.skipped) {
        lines.push(`SKIPPED: ${result.skipReason}`);
        return lines.join("\n") + "\n";
    }
    lines.push(`Framework: ${result.frameworkId}`);
    lines.push(`Config: ${result.configPath}`);
    lines.push(`Tool: ${result.tool}`);
    lines.push("");
    lines.push(`Derived rules: ${result.rules.length}`);
    for (const r of result.rules) lines.push(`- ${r.from} must not import ${r.to} — ${r.source}`);
    if (!result.toolAvailable) {
        lines.push("", `SKIPPED: ${result.tool} is not installed — install it in the target project to enforce the framework rules.`);
        return lines.join("\n") + "\n";
    }
    lines.push("");
    lines.push(`Violations: ${result.violations.length}`);
    for (const v of result.violations) lines.push(`- ${v}`);
    if (result.violations.length === 0) lines.push("", "Clean: the framework rules hold.");
    return lines.join("\n") + "\n";
}

function readCoverageFloor(): number {
    const raw = process.env.SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR;
    if (raw == null || raw === "") return DEFAULT_COVERAGE_FLOOR;
    const n = Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_COVERAGE_FLOOR;
}

// ----- Bugfix pack: regression-test mapping (Phase 4) ----------------------

/** Slice the body of a `## <heading>` section out of a markdown document.
 *  Returns null when the heading is absent. */
function briefSection(body: string, heading: string): string | null {
    const idx = body.indexOf(heading);
    if (idx < 0) return null;
    const tail = body.slice(idx + heading.length);
    const next = tail.search(/\n##\s/);
    return (next >= 0 ? tail.slice(0, next) : tail).trim();
}

/** Read the run's mission brief. Tries state.missionBriefPath first, then the
 *  canonical per-run brief path. Returns null when neither is readable. */
function readRunBrief(cwd: string, state: SenaiState): string | null {
    const candidates: string[] = [];
    if (state.missionBriefPath) candidates.push(path.resolve(cwd, state.missionBriefPath));
    if (state.runId) candidates.push(getRunMissionBriefPath(cwd, state.runId));
    for (const p of candidates) {
        try {
            return fs.readFileSync(p, "utf8");
        } catch {
            /* try the next candidate */
        }
    }
    return null;
}

/** Mission type for the current run: state.missionType wins; otherwise parse
 *  the run brief. Undefined when neither source carries one. */
function resolveRunMissionType(cwd: string, state: SenaiState): MissionType | undefined {
    if (state.missionType) return state.missionType;
    const brief = readRunBrief(cwd, state);
    return brief ? parseBriefMissionType(brief) : undefined;
}

/** Normalize a manifest/brief path for comparison: forward slashes, no
 *  leading `./`. */
function normalizeManifestPath(p: string): string {
    let n = p.replace(/\\/g, "/");
    if (n.startsWith("./")) n = n.slice(2);
    return n;
}

/** Test files named in a `## Regression test plan` section body: anything
 *  that looks like a path ending in `.test.<ext>` or `.spec.<ext>`.
 *  Normalized, deduped, sorted. */
function extractTestFileCandidates(section: string): string[] {
    const found = new Set<string>();
    for (const m of section.matchAll(/[\w@./-]+\.(?:test|spec)\.[a-z0-9]+/gi)) {
        found.add(normalizeManifestPath(m[0]));
    }
    return [...found].sort();
}

/** The plan's `## Files` manifest as a normalized path set. Null when the
 *  plan is unreadable or the manifest is missing/invalid — callers report
 *  that as its own problem instead of failing the coverage check. */
function readManifestPathSet(cwd: string, runId: string): Set<string> | null {
    try {
        const content = fs.readFileSync(getArtifactPaths(cwd, runId).plan, "utf8");
        const manifest = parseFilesManifest(content);
        if (manifest.missingSection || manifest.errors.length > 0) return null;
        return new Set(manifest.entries.map((e) => normalizeManifestPath(e.path)));
    } catch {
        return null;
    }
}

/** Bugfix pack signal: the brief's `## Regression test plan` must name a
 *  test file that exists on disk and is covered by the plan's `## Files`
 *  manifest. Returns undefined for non-bugfix runs. */
export function checkBugfixRegressionTest(cwd: string, state: SenaiState): BugfixRegressionTestResult | undefined {
    if (resolveRunMissionType(cwd, state) !== "bugfix") return undefined;
    const problems: string[] = [];
    const brief = readRunBrief(cwd, state);
    if (!brief) {
        problems.push("no readable mission brief — bugfix runs need a filled `## Regression test plan` section");
        return { candidates: [], problems };
    }
    const section = briefSection(brief, "## Regression test plan");
    if (!section || section.replace(/_TBD_/gi, "").trim().length === 0) {
        problems.push("mission brief has no filled `## Regression test plan` section — name the regression test file there");
        return { candidates: [], problems };
    }
    const candidates = extractTestFileCandidates(section);
    if (candidates.length === 0) {
        problems.push("`## Regression test plan` names no test file — add the path of the failing regression test (e.g. `test/foo.test.ts`)");
        return { candidates, problems };
    }
    const manifestPaths = state.runId ? readManifestPathSet(cwd, state.runId) : null;
    if (manifestPaths === null) {
        problems.push("cannot verify `## Files` manifest coverage — plan.md is missing, unreadable, or has an invalid manifest");
    }
    for (const candidate of candidates) {
        if (!fs.existsSync(path.resolve(cwd, candidate))) {
            problems.push(`regression test file does not exist on disk: ${candidate}`);
        }
        if (manifestPaths !== null && !manifestPaths.has(candidate)) {
            problems.push(`regression test file is not covered by the plan's \`## Files\` manifest: ${candidate}`);
        }
    }
    return { candidates, problems };
}

/**
 * Collect the three discipline signals for the implement stage.
 * Failures inside any individual collector must not throw — return null
 * for that signal so the other signals still surface.
 */
export async function collectImplementSignals(cwd: string, state: SenaiState): Promise<ImplementSignals> {
    const strictMode = isStrictMode();
    const coverageFloor = readCoverageFloor();

    // Implement artifacts presence — checked by the existing artifact logic; we
    // surface it here for completeness.
    let implementArtifactsPresent = false;
    if (state.runId) {
        const ap = getArtifactPaths(cwd, state.runId);
        try {
            implementArtifactsPresent = fs.readdirSync(ap.implementDir).length > 0;
        } catch {
            implementArtifactsPresent = false;
        }
    }

    // 1. Test smell scan
    let scan: ScanReport | null = null;
    try {
        const paths = resolveTestPaths(cwd);
        scan = paths.length > 0 ? scanTestFilesOnDisk(paths) : null;
    } catch {
        scan = null;
    }

    // 2. Coverage
    const coveragePct = readCoverageFromProject(cwd);

    // 3. Mission verification re-run — baseline steps derived from the project
    // itself always run first (planner-independent floor), then the plan's own
    // ## Verification steps. Exact duplicates run once.
    const verificationSteps: VerificationStep[] = [];
    const seenSteps = new Set<string>();
    for (const s of deriveBaselineVerificationSteps(cwd)) {
        seenSteps.add(s);
        verificationSteps.push(await runVerificationStep(s, cwd));
    }
    if (state.runId) {
        const ap = getArtifactPaths(cwd, state.runId);
        try {
            if (fs.existsSync(ap.plan)) {
                const planContent = fs.readFileSync(ap.plan, "utf8");
                const steps = parseVerificationSteps(planContent);
                for (const s of steps) {
                    if (seenSteps.has(s)) continue;
                    verificationSteps.push(await runVerificationStep(s, cwd));
                }
            }
        } catch {
            // Verification collection failure must not throw — leave steps as-is.
        }
    }

    // 4. Manifest diff (Phase 3): planned create-files vs actual disk state.
    // Only files touched since the run started count as unexpected, so
    // pre-existing project files never false-positive.
    let manifestDiff: ManifestDiff | null = null;
    let manifestEntries: readonly ManifestEntry[] = [];
    if (state.runId) {
        try {
            const ap = getArtifactPaths(cwd, state.runId);
            const planContent = fs.readFileSync(ap.plan, "utf8");
            const manifest = parseFilesManifest(planContent);
            if (!manifest.missingSection && manifest.errors.length === 0) {
                manifestEntries = manifest.entries;
                const since = Date.parse(state.startedAt);
                manifestDiff = diffFilesManifest(
                    manifest.entries,
                    cwd,
                    Number.isFinite(since) ? { since } : undefined,
                );
            }
        } catch {
            manifestDiff = null;
        }
    }

    // 5. Arch rules (Phase 3): run the emitted config when the tool is
    // available. Tool absent = warn-and-continue, never a silent skip.
    let archRules: ArchRulesResult | null = null;
    try {
        archRules = await checkArchRules(cwd);
    } catch {
        archRules = null;
    }

    // 6. Framework rules (Phase 4): run the locked framework's forbidden
    // rules after arch-rules. `none` / no field = clean skip, tool absent =
    // warn-and-continue.
    let frameworkRules: FrameworkRulesResult | null = null;
    try {
        frameworkRules = state.runId ? await checkFrameworkRules(cwd, state.runId) : null;
    } catch {
        frameworkRules = null;
    }

    // 7. Bugfix pack (Phase 4): the brief's `## Regression test plan` must
    // map to a real, manifest-covered test file. Best-effort — a collection
    // failure is itself a problem, never a throw.
    const isBugfix = resolveRunMissionType(cwd, state) === "bugfix";
    let bugfixRegressionTest: BugfixRegressionTestResult | undefined;
    if (isBugfix && state.runId) {
        try {
            bugfixRegressionTest = checkBugfixRegressionTest(cwd, state);
        } catch {
            bugfixRegressionTest = { candidates: [], problems: ["bugfix regression-test check failed to run"] };
        }
    }

    // Bugfix escalation of the discipline heuristics: a planned test file
    // missing on disk, a weakened assertion, or an error swallowed in a
    // fix-target file all become blocking. Non-bugfix runs keep the
    // per-heuristic default severities from discipline.ts.
    let deletedTestFindings: Finding[] = [];
    try {
        const plannedTestPaths = manifestEntries.map((e) => e.path).filter(isTestFilePath);
        deletedTestFindings = detectDeletedTestFiles(plannedTestPaths, cwd);
    } catch {
        deletedTestFindings = [];
    }
    if (isBugfix) {
        deletedTestFindings = deletedTestFindings.map((f) => ({ ...f, severity: "blocking" as const }));
    }

    // Phase 4: persist both verification reports into the run's implement/
    // directory so the artifact guards (approve gate + doctor) can verify
    // them like any other stage artifact. Best-effort — a write failure
    // must never break signal collection.
    if (state.runId) {
        try {
            const ap = getArtifactPaths(cwd, state.runId);
            fs.mkdirSync(ap.implementDir, { recursive: true });
            atomicWriteFile(ap.manifestDiffReport, formatManifestDiffReport(manifestDiff));
            atomicWriteFile(ap.archRulesReport, formatArchRulesReport(archRules));
            atomicWriteFile(ap.frameworkRulesReport, formatFrameworkRulesReport(frameworkRules));
        } catch {
            /* report persistence is best-effort */
        }
    }

    // Partition findings by severity. Deleted-test findings come from the
    // manifest diff inputs, not the scan; scan findings carry the bugfix
    // escalation computed above (swallowed-error only escalates when the
    // file is a fix target — a non-test manifest entry).
    const fixTargets = new Set(
        manifestEntries
            .filter((e) => !isTestFilePath(e.path))
            .map((e) => path.resolve(cwd, e.path)),
    );
    const escalatedScanFindings = (scan?.findings ?? []).map((f) => {
        if (!isBugfix) return f;
        if (f.heuristic === "weakened-assertion") return { ...f, severity: "blocking" as const };
        if (f.heuristic === "swallowed-error" && fixTargets.has(path.resolve(cwd, f.file))) {
            return { ...f, severity: "blocking" as const };
        }
        return f;
    });
    const blocking: Finding[] = [];
    const actionable: Finding[] = [];
    const informational: Finding[] = [];
    for (const f of [...escalatedScanFindings, ...deletedTestFindings]) {
        if (f.severity === "blocking") blocking.push(f);
        else if (f.severity === "actionable") actionable.push(f);
        else informational.push(f);
    }

    return {
        implementArtifactsPresent,
        testSmellScan: scan,
        coveragePct,
        coverageFloor,
        criticalPathCoveragePct: null, // not wired yet
        verificationSteps,
        blockingFindings: blocking,
        actionableFindings: actionable,
        informationalFindings: informational,
        manifestDiff,
        archRules,
        frameworkRules,
        bugfixRegressionTest,
        strictMode,
    };
}

/**
 * Format the signals as a short notification string for the approval summary.
 * Pure — no side effects, no I/O.
 */
export function formatImplementSignals(signals: ImplementSignals): string {
    const lines: string[] = [];
    lines.push("Implement signals:");

    if (signals.testSmellScan) {
        const s = signals.testSmellScan;
        const total = s.findings.length;
        const b = s.blockingCount;
        const a = signals.actionableFindings.length;
        const i = signals.informationalFindings.length;
        lines.push(`- Test smell scan: ${total} findings (${b} blocking / ${a} actionable / ${i} informational)`);
        if (b > 0) {
            for (const f of signals.blockingFindings.slice(0, 5)) {
                lines.push(`    - [${f.heuristic}] ${f.file}:${f.line} — ${f.message}`);
            }
            if (b > 5) lines.push(`    - ... and ${b - 5} more blocking findings`);
        }
    } else {
        lines.push("- Test smell scan: tool did not run (no test paths configured)");
    }

    if (signals.coveragePct != null) {
        const below = signals.coveragePct < signals.coverageFloor ? " (BELOW floor)" : "";
        lines.push(`- Coverage: ${signals.coveragePct.toFixed(1)}% on changed files (floor ${signals.coverageFloor}%)${below}`);
    } else {
        lines.push("- Coverage: not measured (no coverage-summary.json found)");
    }

    const passedSteps = signals.verificationSteps.filter((s) => s.passed === true).length;
    const failedSteps = signals.verificationSteps.filter((s) => s.passed === false).length;
    const manualSteps = signals.verificationSteps.filter((s) => s.passed === null).length;
    lines.push(`- Mission verification: ${passedSteps} pass / ${failedSteps} fail / ${manualSteps} manual (out of ${signals.verificationSteps.length})`);
    if (failedSteps > 0) {
        for (const s of signals.verificationSteps.filter((s) => s.passed === false).slice(0, 3)) {
            lines.push(`    - FAILED: ${s.step.slice(0, 80)}`);
        }
    }

    if (signals.manifestDiff) {
        const m = signals.manifestDiff;
        lines.push(`- Manifest diff: ${m.missing.length} missing / ${m.unexpected.length} unexpected planned-create files`);
        for (const p of m.missing.slice(0, 5)) lines.push(`    - MISSING: ${p}`);
        for (const p of m.unexpected.slice(0, 5)) lines.push(`    - UNEXPECTED: ${p}`);
    }

    if (signals.archRules) {
        const a = signals.archRules;
        if (!a.configFound) {
            lines.push("- Arch rules: no emitted config found (skipped)");
        } else if (!a.toolAvailable) {
            lines.push(
                `- Arch rules: ${a.configPath} found but ${a.tool} is not installed — SKIPPED (install the tool in the target project to enforce the layer map)`,
            );
        } else if (a.ran) {
            lines.push(`- Arch rules (${a.tool}): ${a.violations.length} violation(s)`);
            for (const v of a.violations.slice(0, 5)) lines.push(`    - ${v.slice(0, 120)}`);
        }
    }

    if (signals.frameworkRules) {
        const f = signals.frameworkRules;
        if (f.skipped) {
            lines.push(`- Framework rules: skipped — ${f.skipReason}`);
        } else if (!f.toolAvailable) {
            lines.push(
                `- Framework rules (${f.frameworkId}): ${f.rules.length} rule(s) derived but ${f.tool} is not installed — SKIPPED (install the tool in the target project to enforce the framework rules)`,
            );
        } else if (f.ran) {
            lines.push(`- Framework rules (${f.frameworkId}, ${f.tool}): ${f.violations.length} violation(s)`);
            for (const v of f.violations.slice(0, 5)) lines.push(`    - ${v.slice(0, 120)}`);
        }
    }

    if (signals.bugfixRegressionTest) {
        const r = signals.bugfixRegressionTest;
        if (r.problems.length === 0) {
            lines.push(`- Bugfix regression test: ok (${r.candidates.join(", ")})`);
        } else {
            lines.push(`- Bugfix regression test: ${r.problems.length} problem(s)`);
            for (const p of r.problems.slice(0, 5)) lines.push(`    - ${p}`);
        }
    }

    lines.push(`- Strict mode: ${signals.strictMode ? "on (blocking findings will halt advance)" : "off (advisory; set SENAI_TEST_DISCIPLINE_STRICT=1 to enable)"}`);

    return lines.join("\n");
}

/**
 * Collects the blocking reasons for an implement → implemented advance.
 * Actual enforcement: /senai-approve shows these reasons and asks the user to
 * confirm — the user MAY override ("Advance anyway?"). The only no-override
 * gate is checkPlanVerificationGate (planning → planned). In non-strict mode,
 * only verification failures, manifest diff violations, tool-enforced
 * arch/framework rule violations, and bugfix regression-test problems
 * contribute reasons — coverage and smell findings are advisory.
 */
export function signalsBlockAdvance(signals: ImplementSignals): { blocked: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // A failed required (non-null) verification step always contributes a
    // blocking reason (confirm-overridable at approve — see docstring).
    for (const step of signals.verificationSteps) {
        if (step.passed === false) {
            reasons.push(`Verification step failed: ${step.step.slice(0, 80)}`);
        }
    }

    // Manifest diff violations always contribute blocking reasons — the
    // plan's `## Files` manifest is the contract for what the implement
    // stage may write. (Confirm-overridable at approve — see docstring.)
    if (signals.manifestDiff) {
        for (const p of signals.manifestDiff.missing.slice(0, 10)) {
            reasons.push(`Planned file was not created: ${p}`);
        }
        for (const p of signals.manifestDiff.unexpected.slice(0, 10)) {
            reasons.push(`Unplanned file in a manifest folder: ${p}`);
        }
    }

    // Arch-rules violations contribute blocking reasons when the tool
    // actually ran. Tool absent only warns (see formatImplementSignals) —
    // never blocks. (Confirm-overridable at approve — see docstring.)
    if (signals.archRules?.ran) {
        for (const v of signals.archRules.violations.slice(0, 10)) {
            reasons.push(`Architecture rule violation: ${v.slice(0, 120)}`);
        }
    }

    // Framework-rules violations contribute blocking reasons when the tool
    // actually ran. Skips (`none`, no field, tool absent) never block.
    // (Confirm-overridable at approve — see docstring.)
    if (signals.frameworkRules?.ran) {
        for (const v of signals.frameworkRules.violations.slice(0, 10)) {
            reasons.push(`Framework rule violation: ${v.slice(0, 120)}`);
        }
    }

    // Bugfix pack: regression-test mapping problems always block, strict
    // mode or not. (Confirm-overridable at approve — see docstring.)
    if (signals.bugfixRegressionTest) {
        for (const p of signals.bugfixRegressionTest.problems.slice(0, 10)) {
            reasons.push(`Bugfix regression test: ${p}`);
        }
    }

    if (signals.strictMode) {
        for (const f of signals.blockingFindings) {
            reasons.push(`[${f.heuristic}] ${f.file}:${f.line} — ${f.message}`);
        }
        if (signals.coveragePct != null && signals.coverageFloor > 0 && signals.coveragePct < signals.coverageFloor) {
            reasons.push(`Coverage ${signals.coveragePct.toFixed(1)}% is below floor ${signals.coverageFloor}%`);
        }
    }

    return { blocked: reasons.length > 0, reasons };
}
