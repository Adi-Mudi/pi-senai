/**
 * Plan `## Files` manifest parser (Phase 2).
 *
 * Every plan must carry a `## Files` section with a markdown table, one row
 * per file the plan touches:
 *
 *   ## Files
 *
 *   | path | layer | action | reason |
 *   | --- | --- | --- | --- |
 *   | src/foo.ts | commands | create | new command handler |
 *
 * Validation is deterministic: path must be non-empty and project-relative
 * (no absolute paths, no `..` escaping the project root), layer must be
 * non-empty, action must be one of create / edit / delete, and duplicate
 * paths are rejected. Errors carry the 1-based line number in the plan
 * document so the approve gate can list them file:line-style.
 *
 * Layer validation against the architecture's layer map is Phase 3 — the
 * optional `layers` parameter exists so a layer map can be passed in later
 * without changing call sites.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { discoverFrameworkLibrary } from "@adi-mudi/pi-chirpi";

export type ManifestAction = "create" | "edit" | "delete";

export const MANIFEST_ACTIONS: readonly ManifestAction[] = ["create", "edit", "delete"];

export interface ManifestEntry {
    /** Project-relative path exactly as written in the plan. */
    path: string;
    layer: string;
    action: ManifestAction;
    reason: string;
    /** 1-based line number of the row in the plan document. */
    line: number;
}

export interface ManifestError {
    /** 1-based line number in the plan document; 0 for section-level errors. */
    line: number;
    message: string;
}

export interface FilesManifestResult {
    /** True when the plan has no `## Files` section at all. */
    missingSection: boolean;
    entries: ManifestEntry[];
    errors: ManifestError[];
}

const SECTION_HEADING = /^##\s+Files\s*$/;
const NEXT_HEADING = /^##\s/;
const EXPECTED_HEADER = ["path", "layer", "action", "reason"];

/** Split a markdown table row into trimmed cells. Returns null when the line
 *  is not a table row. */
function splitRow(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) return null;
    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    return cells;
}

/** True for markdown separator rows like `| --- | :--- | ---: |`. */
function isSeparatorRow(cells: string[]): boolean {
    return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

/** Validate the path cell. Returns an error message or null. */
function validateManifestPath(p: string): string | null {
    if (!p) return "path is empty";
    if (path.isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\")) {
        return `path "${p}" is absolute — paths must be project-relative`;
    }
    const segments = p.split(/[\\/]+/);
    if (segments.includes("..")) {
        return `path "${p}" escapes the project root — ".." segments are not allowed`;
    }
    return null;
}

/** Parse the `## Files` manifest from a plan markdown body.
 *
 *  `options.layers` is the future hook for architecture layer-map validation
 *  (Phase 3): when provided, each row's layer must be one of the listed
 *  layer names. */
export function parseFilesManifest(
    planContent: string,
    options?: { layers?: readonly string[] },
): FilesManifestResult {
    const lines = planContent.split(/\r?\n/);
    const headingIdx = lines.findIndex((l) => SECTION_HEADING.test(l.trim()));
    if (headingIdx < 0) {
        return { missingSection: true, entries: [], errors: [] };
    }

    const entries: ManifestEntry[] = [];
    const errors: ManifestError[] = [];
    const seen = new Map<string, number>(); // normalized path → first line
    let headerSeen = false;

    for (let i = headingIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (NEXT_HEADING.test(line.trim())) break;
        const cells = splitRow(line);
        if (cells === null) continue;
        const lineNo = i + 1;

        if (!headerSeen) {
            headerSeen = true;
            const header = cells.map((c) => c.toLowerCase());
            if (header.length !== EXPECTED_HEADER.length || !EXPECTED_HEADER.every((h, j) => header[j] === h)) {
                errors.push({
                    line: lineNo,
                    message: `manifest header must be exactly "| path | layer | action | reason |"`,
                });
            }
            continue;
        }
        if (isSeparatorRow(cells)) continue;

        if (cells.length !== EXPECTED_HEADER.length) {
            errors.push({
                line: lineNo,
                message: `malformed row — expected 4 columns (path | layer | action | reason), got ${cells.length}`,
            });
            continue;
        }

        const [rawPath, layer, rawAction, reason] = cells;

        const pathError = validateManifestPath(rawPath);
        if (pathError) {
            errors.push({ line: lineNo, message: pathError });
            continue;
        }

        if (!layer) {
            errors.push({ line: lineNo, message: `layer is empty for path "${rawPath}"` });
            continue;
        }
        if (options?.layers && !options.layers.includes(layer)) {
            errors.push({
                line: lineNo,
                message: `layer "${layer}" for path "${rawPath}" is not in the architecture layer map`,
            });
            continue;
        }

        const action = rawAction.toLowerCase();
        if (!MANIFEST_ACTIONS.includes(action as ManifestAction)) {
            errors.push({
                line: lineNo,
                message: `invalid action "${rawAction}" for path "${rawPath}" — must be one of ${MANIFEST_ACTIONS.join(", ")}`,
            });
            continue;
        }

        const normalized = rawPath.replace(/\\/g, "/");
        const firstLine = seen.get(normalized);
        if (firstLine !== undefined) {
            errors.push({
                line: lineNo,
                message: `duplicate path "${rawPath}" (first listed on line ${firstLine})`,
            });
            continue;
        }
        seen.set(normalized, lineNo);

        entries.push({ path: rawPath, layer, action: action as ManifestAction, reason, line: lineNo });
    }

    if (!headerSeen) {
        errors.push({ line: 0, message: "`## Files` section has no manifest table" });
    }

    return { missingSection: false, entries, errors };
}

export interface FrameworkFieldResult {
    /** True when the plan carries a `## Framework` section. */
    found: boolean;
    /** Normalized value (lowercased single token): a framework id or `none`.
     *  Null when the section is missing or empty. */
    value: string | null;
    /** 1-based line of the value in the plan document (heading line when the
     *  section is empty); 0 when the section is missing. */
    line: number;
    /** Validation error, or null when the value is `none` or a known
     *  framework-library id. */
    error: string | null;
}

const FRAMEWORK_HEADING = /^##\s+Framework\b\s*:?\s*(.*)$/;
export const FRAMEWORK_NONE = "none";

/** Parse the optional `## Framework` field from a plan markdown body. The
 *  value is a single framework id from the chirpi framework-library, or
 *  `none` when the project has no framework. The id is validated against the
 *  installed @adi-mudi/pi-chirpi library (bundled maps plus the project's
 *  `.pi/framework-library/` overrides); an unknown id is a parse error. */
export function parseFrameworkField(planContent: string, cwd: string): FrameworkFieldResult {
    const lines = planContent.split(/\r?\n/);
    let headingIdx = -1;
    let inlineValue = "";
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].trim().match(FRAMEWORK_HEADING);
        if (m) {
            headingIdx = i;
            inlineValue = m[1].trim();
            break;
        }
    }
    if (headingIdx < 0) {
        return { found: false, value: null, line: 0, error: null };
    }

    let rawValue = inlineValue;
    let valueLine = headingIdx + 1;
    if (!rawValue) {
        for (let i = headingIdx + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (NEXT_HEADING.test(line)) break;
            if (!line) continue;
            rawValue = line;
            valueLine = i + 1;
            break;
        }
    }
    // Tolerate planner formatting: one bullet marker and/or backtick wrap.
    rawValue = rawValue.replace(/^[-*]\s+/, "").replace(/^`+|`+$/g, "").trim();

    if (!rawValue) {
        return {
            found: true,
            value: null,
            line: headingIdx + 1,
            error: "`## Framework` section is empty — write a single framework id or `none`",
        };
    }
    if (/\s/.test(rawValue)) {
        return {
            found: true,
            value: null,
            line: valueLine,
            error: `\`## Framework\` value "${rawValue}" must be a single framework id or \`none\``,
        };
    }

    const value = rawValue.toLowerCase();
    if (value === FRAMEWORK_NONE) {
        return { found: true, value, line: valueLine, error: null };
    }

    let knownIds: string[] = [];
    try {
        knownIds = discoverFrameworkLibrary(cwd).map((m) => m.id.toLowerCase());
    } catch {
        knownIds = [];
    }
    if (!knownIds.includes(value)) {
        const known = knownIds.length > 0 ? knownIds.sort().join(", ") : "(framework-library unavailable or empty)";
        return {
            found: true,
            value,
            line: valueLine,
            error: `unknown framework id "${value}" — known framework-library ids: ${known}`,
        };
    }
    return { found: true, value, line: valueLine, error: null };
}

export interface ManifestDiff {
    /** Planned `create` files that do not exist on disk. */
    missing: string[];
    /** Files on disk inside the manifest's target folders that no planned
     *  `create` entry covers. */
    unexpected: string[];
}

/** Directories never walked when scanning for unexpected files. */
const DIFF_SKIP_DIRS = new Set([".git", "node_modules"]);

/** Compare planned create-files against the actual disk state under `cwd`.
 *  Exported in Phase 2, wired into the implement gate in Phase 3.
 *
 *  `unexpected` lists files inside the manifest's target folders that no
 *  manifest entry (any action) covers. When `options.since` (epoch ms) is
 *  given, only files modified at or after that timestamp count — this scopes
 *  the check to files the current run actually touched, so pre-existing
 *  project files never false-positive. */
export function diffFilesManifest(
    entries: readonly ManifestEntry[],
    cwd: string,
    options?: { since?: number },
): ManifestDiff {
    const creates = entries.filter((e) => e.action === "create");
    const covered = new Set(entries.map((e) => e.path.replace(/\\/g, "/")));

    const missing = creates
        .filter((e) => !fs.existsSync(path.join(cwd, e.path)))
        .map((e) => e.path)
        .sort();

    const targetDirs = new Set(creates.map((e) => path.posix.dirname(e.path.replace(/\\/g, "/"))));
    const unexpected: string[] = [];
    for (const dir of targetDirs) {
        const absDir = dir === "." ? cwd : path.join(cwd, dir);
        const walk = (abs: string): void => {
            let entriesOnDisk: fs.Dirent[];
            try {
                entriesOnDisk = fs.readdirSync(abs, { withFileTypes: true });
            } catch {
                return; // directory does not exist (yet) — nothing unexpected inside
            }
            for (const dent of entriesOnDisk) {
                if (dent.isDirectory()) {
                    if (DIFF_SKIP_DIRS.has(dent.name)) continue;
                    walk(path.join(abs, dent.name));
                } else if (dent.isFile()) {
                    const absFile = path.join(abs, dent.name);
                    const rel = path.relative(cwd, absFile).split(path.sep).join("/");
                    if (covered.has(rel)) continue;
                    if (options?.since !== undefined) {
                        try {
                            if (fs.statSync(absFile).mtimeMs < options.since) continue;
                        } catch {
                            continue;
                        }
                    }
                    unexpected.push(rel);
                }
            }
        };
        walk(absDir);
    }
    unexpected.sort();

    return { missing, unexpected };
}
