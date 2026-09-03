/**
 * Implement-stage discipline signal collector.
 *
 * Runs at the implement → implemented transition (i.e. before /senai-approve
 * advances the run). Collects three signals:
 *   1. Test smell scan report (deterministic, via test-discipline.ts).
 *   2. Project coverage (read from files.json coveragePath if present).
 *   3. Mission verification re-run (parses `<plan>` `## Verification`).
 *
 * The collector is advisory by default; strict mode promotes blocking findings
 * to a hard gate. Strict mode is opt-in via the SENAI_TEST_DISCIPLINE_STRICT
 * environment variable, so this is safe to enable on day one and harden later.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { scanTestFilesOnDisk, resolveTestPaths, type Finding, type ScanReport } from "./test-discipline.js";
import { getArtifactPaths } from "./constants.js";
import type { SenaiState } from "./state.js";

export interface VerificationStep {
    step: string;
    passed: boolean | null;
    output?: string;
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
 * Run a verification step via bash. Returns passed=true/false or passed=null
 * when the step was a manual check (does not start with a recognizable shell
 * command and the runner cannot execute it).
 */
export async function runVerificationStep(step: string, cwd: string, timeoutMs: number = 60000): Promise<VerificationStep> {
    // Heuristic: if the step looks like a shell command (starts with `$`,
    // or contains a known command-like prefix), run it. Otherwise return
    // null to mean "manual check, not run by the orchestrator".
    const looksLikeCommand = /^[\$\w/]/.test(step) && /[|&;]|\s/.test(step + " ");
    if (!looksLikeCommand) {
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

function readCoverageFloor(): number {
    const raw = process.env.SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR;
    if (raw == null || raw === "") return DEFAULT_COVERAGE_FLOOR;
    const n = Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_COVERAGE_FLOOR;
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

    // 3. Mission verification re-run
    const verificationSteps: VerificationStep[] = [];
    if (state.runId) {
        const ap = getArtifactPaths(cwd, state.runId);
        try {
            if (fs.existsSync(ap.plan)) {
                const planContent = fs.readFileSync(ap.plan, "utf8");
                const steps = parseVerificationSteps(planContent);
                for (const s of steps) {
                    verificationSteps.push(await runVerificationStep(s, cwd));
                }
            }
        } catch {
            // Verification collection failure must not throw — leave steps empty.
        }
    }

    // Partition findings by severity
    const blocking: Finding[] = [];
    const actionable: Finding[] = [];
    const informational: Finding[] = [];
    if (scan) {
        for (const f of scan.findings) {
            if (f.severity === "blocking") blocking.push(f);
            else if (f.severity === "actionable") actionable.push(f);
            else informational.push(f);
        }
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

    lines.push(`- Strict mode: ${signals.strictMode ? "on (blocking findings will halt advance)" : "off (advisory; set SENAI_TEST_DISCIPLINE_STRICT=1 to enable)"}`);

    return lines.join("\n");
}

/**
 * Returns true if the signals indicate a hard block (strict mode + blocking
 * finding OR a failed required verification step). In non-strict mode, only
 * verification failures block — coverage and smell findings are advisory.
 */
export function signalsBlockAdvance(signals: ImplementSignals): { blocked: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // A failed required (non-null) verification step is ALWAYS blocking.
    for (const step of signals.verificationSteps) {
        if (step.passed === false) {
            reasons.push(`Verification step failed: ${step.step.slice(0, 80)}`);
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
