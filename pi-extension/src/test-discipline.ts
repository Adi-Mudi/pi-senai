/**
 * Test discipline scanner.
 *
 * Deterministic static analysis of test files. Detects common test
 * anti-patterns without trusting the LLM. Each heuristic is a small pure
 * function with its own tests; the aggregate report is the only public
 * surface most callers use.
 *
 * Heuristics implemented:
 *   1. zero-assertion    — test runs but never calls assert/expect/should
 *   2. over-mocking      — more than N test-double calls in one test
 *   3. mirror-logic      — assertion duplicates the production expression
 *   4. flaky-timing      — sleep/setTimeout not wrapped in a polling helper
 *   5. no-aaa            — multi-statement test with no AAA separators
 *   6. mystery-guest     — file read with a string path not in fixturePaths
 *   7. private-method    — call to method starting with _ or @private
 *   8. god-test          — too many asserts OR too long a body
 *
 * Severity levels (set per-heuristic below):
 *   - blocking       — should halt advance in Phase 3 strict mode
 *   - actionable     — surfaced in approval summary; user may override
 *   - informational  — surfaced as a hint; no action required
 */

import * as fs from "node:fs";
import * as node_path from "node:path";

// ----- Public types -------------------------------------------------------

export type FindingSeverity = "blocking" | "actionable" | "informational";

export type HeuristicId =
    | "zero-assertion"
    | "over-mocking"
    | "mirror-logic"
    | "flaky-timing"
    | "no-aaa"
    | "mystery-guest"
    | "private-method"
    | "god-test";

export interface Finding {
    heuristic: HeuristicId;
    severity: FindingSeverity;
    file: string;
    line: number;       // 1-based
    column: number;     // 0-based
    endLine: number;
    endColumn: number;
    message: string;
    excerpt: string;    // trimmed matched line, max 120 chars
}

export interface ScanReport {
    scannedFiles: number;
    findings: Finding[];
    byHeuristic: Record<HeuristicId, number>;
    bySeverity: Record<FindingSeverity, number>;
    blockingCount: number;
}

export interface HeuristicConfig {
    overMockingThreshold: number;
    godTestAssertThreshold: number;
    godTestBodyLengthThreshold: number;
}

export const DEFAULT_HEURISTIC_CONFIG: HeuristicConfig = {
    overMockingThreshold: 3,
    godTestAssertThreshold: 5,
    godTestBodyLengthThreshold: 50,
};

// ----- Heuristic configuration -------------------------------------------

/**
 * Severity per heuristic. The scanner returns the severity on each Finding so
 * downstream code can filter without re-deriving it.
 */
const HEURISTIC_SEVERITY: Record<HeuristicId, FindingSeverity> = {
    "zero-assertion": "blocking",
    "over-mocking": "blocking",
    "mirror-logic": "actionable",
    "flaky-timing": "actionable",
    "no-aaa": "informational",
    "mystery-guest": "actionable",
    "private-method": "actionable",
    "god-test": "actionable",
};

/**
 * Assertion-call patterns. Matched case-insensitively. Word-boundary anchors
 * keep short strings like `to` from accidentally matching. The match is
 * permissive on purpose — false negatives are worse than false positives here.
 */
const ASSERTION_PATTERNS: RegExp[] = [
    /\bassert[.A-Za-z_]*\s*\(/i,
    /\bexpect\s*\(/i,
    /\bshould\s*[\.\(]/i,             // chai should.equal or should(
    /\bverify\s*\(/i,
    /\bto[BeEqual]+(?:CloseTo|Equals?)?\s*\(/i,    // jest/vitest toBe/toEqual/toBeCloseTo
    /\bchai\b/i,
    /\.to\.?\s*\w+/i,                              // chai BDD style `.to.equal(...)`, `.to.be(...)`, etc.
    /\bassertThat\s*\(/i,                         // Java JUnit assertThat
    // Python: `assert <expr>` as a statement (not `assertEqual` etc., which is already covered).
    // Negative lookahead skips comparison operators so `assert a == b` is still caught by the assert line detector.
    /^\s*assert\s+(?!==|!=|is\s+None\b)/m,
];

/**
 * Mock-call patterns. Counted per test function. If count > threshold, fire.
 */
const MOCK_PATTERNS: RegExp[] = [
    /\bmock\s*\(/i,
    /\bMock::/,
    /\bcreateMock\s*\(/i,
    /\bjest\.fn\s*\(/i,
    /\bsinon\.stub\s*\(/i,
    /\bspyOn\s*\(/i,
    /\bcreateStubInstance\s*\(/i,
    /\bmockReturnValue\b/i,
    /\bmockResolvedValue\b/i,
    /\b@MockBean\b/,
];

/**
 * Marker comments that signal an AAA section.
 * Supports C-style `// Arrange` / `// Act` / `// Assert`, Python `# Arrange`, and shell `# Arrange`.
 */
const AAA_COMMENTS = /(?:\/\/|#)\s*(Arrange|Act|Assert|Setup|Given|When|Then)\b/i;

/**
 * File-read patterns used by mystery-guest detection.
 */
const FILE_READ_PATTERNS: RegExp[] = [
    /\breadFileSync\s*\(\s*['"`]([^'"`]+)['"`]/,
    /\bfs\.readFile\s*\(\s*['"`]([^'"`]+)['"`]/,
    /\bopen\s*\(\s*['"`]([^'"`]+)['"`]/,
];

/**
 * Sleep / setTimeout / wait patterns that suggest flaky timing.
 */
const FLAKY_TIMING_PATTERNS: RegExp[] = [
    /\bsleep\s*\(/i,
    /\bsetTimeout\s*\(/i,
    /\bwait_for\s*\(/i,
    /\btime\.sleep\s*\(/i,
    /\bThread\.sleep\s*\(/i,
];

/**
 * Helper names that wrap sleep/setTimeout safely (polling, eventually, until).
 * If the call is inside one of these, it is NOT flagged.
 */
const POLLING_HELPER_NAMES = /\b(poll|pollUntil|eventually|until|retry|waitForCondition|waitUntil)\s*\(/i;

// ----- Helpers ------------------------------------------------------------

interface TestBlock {
    name: string;
    startLine: number;     // 1-based
    endLine: number;       // 1-based, inclusive
    body: string;
}

/**
 * Split the file into per-test-function blocks. We use a simple heuristic
 * that is good enough for the patterns we care about: each `it(...)`, `test(...)`,
 * top-level `function`, or `def` is a new block. This is not perfect but it
 * does not need to be — the heuristics are statistical, not parser-based.
 */
function extractTestBlocks(content: string): TestBlock[] {
    const lines = content.split(/\r?\n/);
    const blocks: TestBlock[] = [];

    const blockStarts: Array<{ name: string; line: number }> = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // it('name', ...) / test('name', ...) / it(`name`, ...)
        const itMatch = line.match(/^\s*(?:it|test|specify)\s*\(\s*['"`]([^'"`]+)['"`]/);
        if (itMatch) {
            blockStarts.push({ name: itMatch[1], line: i + 1 });
            continue;
        }
        // function name(...) at top level
        const fnMatch = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
        if (fnMatch) {
            blockStarts.push({ name: fnMatch[1], line: i + 1 });
            continue;
        }
        // def name(...):
        const defMatch = line.match(/^\s*def\s+([A-Za-z_][\w]*)\s*\(/);
        if (defMatch) {
            blockStarts.push({ name: defMatch[1], line: i + 1 });
            continue;
        }
        // @Test annotation on its own line, followed by a method — handled by
        // treating the next non-annotation line as the block start.
        if (/^\s*@Test\b/.test(line)) {
            // Find the next non-annotation, non-comment line and treat it as start.
            for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                const next = lines[j];
                if (!/^\s*@/.test(next) && !/^\s*\/\//.test(next) && next.trim().length > 0) {
                    const m = next.match(/(?:public|private|protected)?\s*(?:static\s+)?(?:void|[\w<>,\[\]]+)\s+([A-Za-z_$][\w$]*)\s*\(/);
                    if (m) {
                        blockStarts.push({ name: m[1], line: j + 1 });
                    }
                    break;
                }
            }
        }
    }

    if (blockStarts.length === 0) {
        return [];
    }

    for (let i = 0; i < blockStarts.length; i++) {
        const start = blockStarts[i];
        const end = i + 1 < blockStarts.length
            ? blockStarts[i + 1].line - 1
            : lines.length;
        const body = lines.slice(start.line - 1, end).join("\n");
        blocks.push({
            name: start.name,
            startLine: start.line,
            endLine: end,
            body,
        });
    }
    return blocks;
}

function trimExcerpt(line: string): string {
    const trimmed = line.trim();
    return trimmed.length <= 120 ? trimmed : trimmed.slice(0, 117) + "...";
}

function findLineCol(body: string, blockStartLine: number, pattern: RegExp): { line: number; column: number; endLine: number; endColumn: number; matchedLine: string } | null {
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(pattern);
        if (m && m[0]) {
            return {
                line: blockStartLine + i,
                column: m.index ?? 0,
                endLine: blockStartLine + i,
                endColumn: (m.index ?? 0) + m[0].length,
                matchedLine: lines[i],
            };
        }
    }
    return null;
}

function pushFinding(
    findings: Finding[],
    file: string,
    block: TestBlock,
    heuristic: HeuristicId,
    pattern: RegExp,
    message: string,
): void {
    const hit = findLineCol(block.body, block.startLine, pattern);
    if (!hit) return;
    findings.push({
        heuristic,
        severity: HEURISTIC_SEVERITY[heuristic],
        file,
        line: hit.line,
        column: hit.column,
        endLine: hit.endLine,
        endColumn: hit.endColumn,
        message,
        excerpt: trimExcerpt(hit.matchedLine),
    });
}

// ----- Heuristics ---------------------------------------------------------

export function detectZeroAssertion(content: string, filePath: string): Finding[] {
    const findings: Finding[] = [];
    const blocks = extractTestBlocks(content);
    for (const block of blocks) {
        const hasAssert = ASSERTION_PATTERNS.some((p) => p.test(block.body));
        if (!hasAssert) {
            findings.push({
                heuristic: "zero-assertion",
                severity: HEURISTIC_SEVERITY["zero-assertion"],
                file: filePath,
                line: block.startLine,
                column: 0,
                endLine: block.startLine,
                endColumn: 0,
                message: `Test '${block.name}' has no assertion calls.`,
                excerpt: trimExcerpt(block.body.split(/\r?\n/)[0] ?? ""),
            });
        }
    }
    return findings;
}

export function detectOverMocking(
    content: string,
    filePath: string,
    threshold: number = DEFAULT_HEURISTIC_CONFIG.overMockingThreshold,
): Finding[] {
    const findings: Finding[] = [];
    const blocks = extractTestBlocks(content);
    for (const block of blocks) {
        let count = 0;
        let firstHit: { line: number; column: number; endLine: number; endColumn: number; matchedLine: string } | null = null;
        for (const pattern of MOCK_PATTERNS) {
            const lines = block.body.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(pattern);
                if (m && m[0]) {
                    count++;
                    if (!firstHit) {
                        firstHit = {
                            line: block.startLine + i,
                            column: m.index ?? 0,
                            endLine: block.startLine + i,
                            endColumn: (m.index ?? 0) + m[0].length,
                            matchedLine: lines[i],
                        };
                    }
                }
            }
        }
        if (count > threshold && firstHit) {
            findings.push({
                heuristic: "over-mocking",
                severity: HEURISTIC_SEVERITY["over-mocking"],
                file: filePath,
                line: firstHit.line,
                column: firstHit.column,
                endLine: firstHit.endLine,
                endColumn: firstHit.endColumn,
                message: `Test '${block.name}' uses ${count} test doubles (threshold: ${threshold}). Refactor or use a narrow integration test.`,
                excerpt: trimExcerpt(firstHit.matchedLine),
            });
        }
    }
    return findings;
}

/**
 * Split a string at the top-level comma, respecting nested parentheses.
 * Returns [before, after] or null if no top-level comma is found.
 */
function splitAtTopLevelComma(s: string): [string, string] | null {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (c === "," && depth === 0) {
            return [s.slice(0, i), s.slice(i + 1)];
        }
    }
    return null;
}

export function detectMirrorLogic(content: string, filePath: string): Finding[] {
    const findings: Finding[] = [];
    const blocks = extractTestBlocks(content);
    for (const block of blocks) {
        // Look for: assert*(EXPR1, EXPR2) where EXPR1 and EXPR2 are syntactically
        // identical. We split at the top-level comma (paren-aware) to handle nested
        // function calls correctly.
        const lines = block.body.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Find an assertion-style call: word "assert" followed by an opening paren.
            const callStart = line.search(/\bassert\w*\s*\(/);
            if (callStart < 0) continue;
            const openParen = line.indexOf("(", callStart);
            if (openParen < 0) continue;
            // Find the matching close paren.
            let depth = 1;
            let closeParen = -1;
            for (let p = openParen + 1; p < line.length; p++) {
                const c = line[p];
                if (c === "(" || c === "[" || c === "{") depth++;
                else if (c === ")" || c === "]" || c === "}") {
                    depth--;
                    if (depth === 0) {
                        closeParen = p;
                        break;
                    }
                }
            }
            if (closeParen < 0) continue;
            const args = line.slice(openParen + 1, closeParen);
            const parts = splitAtTopLevelComma(args);
            if (!parts) continue;
            const lhs = parts[0].trim();
            const rhs = parts[1].trim();
            // Strip a trailing semicolon or method chain from the RHS (e.g. `.to.equal(...)`).
            const rhsStripped = rhs.replace(/[;,]\s*$/, "");
            if (lhs.length > 0 && lhs === rhsStripped) {
                findings.push({
                    heuristic: "mirror-logic",
                    severity: HEURISTIC_SEVERITY["mirror-logic"],
                    file: filePath,
                    line: block.startLine + i,
                    column: 0,
                    endLine: block.startLine + i,
                    endColumn: line.length,
                    message: `Test '${block.name}' asserts the same expression on both sides.`,
                    excerpt: trimExcerpt(line),
                });
            }
        }
    }
    return findings;
}

export function detectFlakyTiming(content: string, filePath: string): Finding[] {
    const findings: Finding[] = [];
    const blocks = extractTestBlocks(content);
    for (const block of blocks) {
        // If the block as a whole is inside a polling helper name, skip the whole block.
        if (POLLING_HELPER_NAMES.test(block.body)) {
            continue;
        }
        for (const pattern of FLAKY_TIMING_PATTERNS) {
            pushFinding(findings, filePath, block, "flaky-timing", pattern,
                `Test '${block.name}' uses a fixed timing call. Wrap in a polling helper or use condition-based waits.`);
        }
    }
    return findings;
}

export function detectNoAAA(content: string, filePath: string): Finding[] {
    const findings: Finding[] = [];
    const blocks = extractTestBlocks(content);
    for (const block of blocks) {
        const lines = block.body.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length <= 5) continue;
        // Check for blank-line separation OR AAA comments.
        const hasBlankLineSeparator = /\n\s*\n/.test(block.body);
        const hasAAAComment = AAA_COMMENTS.test(block.body);
        if (!hasBlankLineSeparator && !hasAAAComment) {
            findings.push({
                heuristic: "no-aaa",
                severity: HEURISTIC_SEVERITY["no-aaa"],
                file: filePath,
                line: block.startLine,
                column: 0,
                endLine: block.startLine,
                endColumn: 0,
                message: `Test '${block.name}' has no AAA structure (no blank lines, no Arrange/Act/Assert comments).`,
                excerpt: trimExcerpt(lines[0] ?? ""),
            });
        }
    }
    return findings;
}

export function detectMysteryGuest(
    content: string,
    filePath: string,
    fixturePaths: string[] = [],
): Finding[] {
    const findings: Finding[] = [];
    const blocks = extractTestBlocks(content);
    for (const block of blocks) {
        const lines = block.body.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            for (const pattern of FILE_READ_PATTERNS) {
                const m = lines[i].match(pattern);
                if (m && m[1]) {
                    const readPath = m[1];
                    const inFixture = fixturePaths.some((p) => readPath.includes(p));
                    if (!inFixture) {
                        findings.push({
                            heuristic: "mystery-guest",
                            severity: HEURISTIC_SEVERITY["mystery-guest"],
                            file: filePath,
                            line: block.startLine + i,
                            column: m.index ?? 0,
                            endLine: block.startLine + i,
                            endColumn: (m.index ?? 0) + m[0].length,
                            message: `Test '${block.name}' reads '${readPath}' which is not in the fixture paths.`,
                            excerpt: trimExcerpt(lines[i]),
                        });
                    }
                }
            }
        }
    }
    return findings;
}

export function detectPrivateMethod(content: string, filePath: string): Finding[] {
    const findings: Finding[] = [];
    const blocks = extractTestBlocks(content);
    for (const block of blocks) {
        const lines = block.body.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Method call starting with underscore: ._helper() or _helper(
            const m = line.match(/\._([A-Za-z_$][\w$]*)\s*\(/);
            if (m) {
                findings.push({
                    heuristic: "private-method",
                    severity: HEURISTIC_SEVERITY["private-method"],
                    file: filePath,
                    line: block.startLine + i,
                    column: m.index ?? 0,
                    endLine: block.startLine + i,
                    endColumn: (m.index ?? 0) + m[0].length,
                    message: `Test '${block.name}' calls a private method '.${m[1]}()'. Test public API only.`,
                    excerpt: trimExcerpt(line),
                });
                continue;
            }
            // Standalone call: _helper( — only flag if it's clearly a method call (followed by ; or whitespace+statement-end)
            const m2 = line.match(/\b_([A-Za-z_$][\w$]*)\s*\(/);
            if (m2 && !/\b(const|let|var|function|return|new)\s+_/.test(line)) {
                findings.push({
                    heuristic: "private-method",
                    severity: HEURISTIC_SEVERITY["private-method"],
                    file: filePath,
                    line: block.startLine + i,
                    column: m2.index ?? 0,
                    endLine: block.startLine + i,
                    endColumn: (m2.index ?? 0) + m2[0].length,
                    message: `Test '${block.name}' may be calling private '_${m2[1]}()'. Verify it is public API.`,
                    excerpt: trimExcerpt(line),
                });
            }
        }
    }
    return findings;
}

export function detectGodTest(
    content: string,
    filePath: string,
    assertThreshold: number = DEFAULT_HEURISTIC_CONFIG.godTestAssertThreshold,
    bodyLengthThreshold: number = DEFAULT_HEURISTIC_CONFIG.godTestBodyLengthThreshold,
): Finding[] {
    const findings: Finding[] = [];
    const blocks = extractTestBlocks(content);
    for (const block of blocks) {
        const bodyLines = block.body.split(/\r?\n/);
        const assertCount = ASSERTION_PATTERNS.reduce(
            (acc, p) => acc + (block.body.match(new RegExp(p.source, "g"))?.length ?? 0),
            0,
        );
        if (assertCount > assertThreshold) {
            findings.push({
                heuristic: "god-test",
                severity: HEURISTIC_SEVERITY["god-test"],
                file: filePath,
                line: block.startLine,
                column: 0,
                endLine: block.startLine,
                endColumn: 0,
                message: `Test '${block.name}' has ${assertCount} assertions (threshold: ${assertThreshold}). Consider splitting.`,
                excerpt: trimExcerpt(bodyLines[0] ?? ""),
            });
        }
        if (bodyLines.length > bodyLengthThreshold) {
            findings.push({
                heuristic: "god-test",
                severity: HEURISTIC_SEVERITY["god-test"],
                file: filePath,
                line: block.startLine,
                column: 0,
                endLine: block.endLine,
                endColumn: 0,
                message: `Test '${block.name}' body is ${bodyLines.length} lines (threshold: ${bodyLengthThreshold}). Consider splitting.`,
                excerpt: trimExcerpt(bodyLines[0] ?? ""),
            });
        }
    }
    return findings;
}

// ----- Aggregation --------------------------------------------------------

function emptyReport(): ScanReport {
    return {
        scannedFiles: 0,
        findings: [],
        byHeuristic: {
            "zero-assertion": 0,
            "over-mocking": 0,
            "mirror-logic": 0,
            "flaky-timing": 0,
            "no-aaa": 0,
            "mystery-guest": 0,
            "private-method": 0,
            "god-test": 0,
        },
        bySeverity: {
            blocking: 0,
            actionable: 0,
            informational: 0,
        },
        blockingCount: 0,
    };
}

export function scanTestFiles(
    files: Array<{ path: string; content: string }>,
    config: Partial<HeuristicConfig> = {},
): ScanReport {
    const cfg = { ...DEFAULT_HEURISTIC_CONFIG, ...config };
    const report = emptyReport();
    report.scannedFiles = files.length;

    for (const file of files) {
        const findings = [
            ...detectZeroAssertion(file.content, file.path),
            ...detectOverMocking(file.content, file.path, cfg.overMockingThreshold),
            ...detectMirrorLogic(file.content, file.path),
            ...detectFlakyTiming(file.content, file.path),
            ...detectNoAAA(file.content, file.path),
            ...detectMysteryGuest(file.content, file.path),
            ...detectPrivateMethod(file.content, file.path),
            ...detectGodTest(file.content, file.path, cfg.godTestAssertThreshold, cfg.godTestBodyLengthThreshold),
        ];

        for (const finding of findings) {
            report.findings.push(finding);
            report.byHeuristic[finding.heuristic]++;
            report.bySeverity[finding.severity]++;
            if (finding.severity === "blocking") {
                report.blockingCount++;
            }
        }
    }
    return report;
}

export function scanTestFilesOnDisk(
    paths: string[],
    config: Partial<HeuristicConfig> = {},
): ScanReport {
    const files: Array<{ path: string; content: string }> = [];
    for (const p of paths) {
        try {
            const content = fs.readFileSync(p, "utf8");
            files.push({ path: p, content });
        } catch {
            // Skip files that cannot be read.
        }
    }
    return scanTestFiles(files, config);
}

/**
 * Resolve the test file paths for a run. Reads files.json codePaths + testPaths
 * and joins them with the cwd. Returns absolute paths. Returns an empty array
 * if files.json does not exist or has no test paths.
 */
export function resolveTestPaths(cwd: string, _runId?: string): string[] {
    let config: { testPaths?: string[]; codePaths?: string[] } = {};
    try {
        // Lazy-load files-config to avoid a circular import at module load time.
        // Read the JSON directly to stay ESM-compatible.
        const path = node_path;
        const cfgPath = path.join(cwd, ".pi", "senai", "files.json");
        if (fs.existsSync(cfgPath)) {
            const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
            config = (raw as { testPaths?: string[]; codePaths?: string[] }) ?? {};
        }
    } catch {
        // Safe to ignore — fall back to empty paths.
    }
    const out: string[] = [];
    for (const p of config.testPaths ?? []) {
        out.push(p);
    }
    for (const p of config.codePaths ?? []) {
        out.push(p);
    }
    return out.map((p) => (p.startsWith("/") ? p : `${cwd}/${p}`));
}
