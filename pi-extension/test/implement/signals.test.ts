import { describe, it } from "node:test";
import assert from "node:assert";
import {
    DEFAULT_COVERAGE_FLOOR,
    formatImplementSignals,
    parseVerificationSteps,
    signalsBlockAdvance,
    type ImplementSignals,
} from "../../src/implement-signals.js";

describe("parseVerificationSteps", () => {
    it("extracts numbered steps from a plan's ## Verification section", () => {
        const plan = `# Plan

## Verification

1. Run \`npm test\`
2. Run \`npm run lint\`
3. Open the app and check the dashboard renders

## Notes

Whatever.`;
        const steps = parseVerificationSteps(plan);
        assert.strictEqual(steps.length, 3);
        assert.ok(steps[0].includes("npm test"));
        assert.ok(steps[1].includes("npm run lint"));
        assert.ok(steps[2].includes("dashboard renders"));
    });

    it("returns an empty list when no ## Verification section exists", () => {
        const plan = `# Plan\n\n## Steps\n\n1. Do thing one\n2. Do thing two`;
        const steps = parseVerificationSteps(plan);
        assert.strictEqual(steps.length, 0);
    });

    it("strips leading list markers (1. , - , *, $)", () => {
        const plan = `## Verification

- npm test
* npm run lint
$ npm run build`;
        const steps = parseVerificationSteps(plan);
        assert.strictEqual(steps.length, 3);
        assert.ok(steps[0] === "npm test");
        assert.ok(steps[1] === "npm run lint");
        assert.ok(steps[2] === "npm run build");
    });
});

describe("signalsBlockAdvance", () => {
    it("always blocks on a failed verification step (regardless of strict mode)", () => {
        const signals: ImplementSignals = {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: 90,
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [{ step: "npm test", passed: false, output: "1 failed" }],
            blockingFindings: [],
            actionableFindings: [],
            informationalFindings: [],
            strictMode: false,
        };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, true);
        assert.ok(block.reasons.some((r) => r.includes("Verification step failed")));
    });

    it("does NOT block on advisory findings when strict mode is off", () => {
        const signals: ImplementSignals = {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: 50,    // below floor
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [],
            blockingFindings: [], // no blocking findings
            actionableFindings: [],
            informationalFindings: [],
            strictMode: false,
        };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, false);
    });

    it("blocks on blocking findings when strict mode is on", () => {
        const signals: ImplementSignals = {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: 90,
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [],
            blockingFindings: [
                {
                    heuristic: "zero-assertion",
                    severity: "blocking",
                    file: "/test.ts",
                    line: 5,
                    column: 0,
                    endLine: 5,
                    endColumn: 0,
                    message: "no asserts",
                    excerpt: "it('x', () => { ... })",
                },
            ],
            actionableFindings: [],
            informationalFindings: [],
            strictMode: true,
        };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, true);
        assert.ok(block.reasons[0].includes("zero-assertion"));
    });

    it("blocks on coverage-below-floor when strict mode is on", () => {
        const signals: ImplementSignals = {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: 50,
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [],
            blockingFindings: [],
            actionableFindings: [],
            informationalFindings: [],
            strictMode: true,
        };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, true);
        assert.ok(block.reasons.some((r) => r.toLowerCase().includes("coverage")));
    });

    it("does not block when strict mode is off and there are no verification failures", () => {
        const signals: ImplementSignals = {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: null,
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [{ step: "manual check", passed: null }],
            blockingFindings: [],
            actionableFindings: [],
            informationalFindings: [],
            strictMode: false,
        };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, false);
    });
});

describe("formatImplementSignals", () => {
    it("renders the scan summary with all severity buckets", () => {
        const signals: ImplementSignals = {
            implementArtifactsPresent: true,
            testSmellScan: {
                scannedFiles: 3,
                findings: [
                    { heuristic: "zero-assertion", severity: "blocking", file: "/a.ts", line: 1, column: 0, endLine: 1, endColumn: 0, message: "no asserts", excerpt: "" },
                    { heuristic: "no-aaa", severity: "informational", file: "/b.ts", line: 5, column: 0, endLine: 5, endColumn: 0, message: "no AAA", excerpt: "" },
                    { heuristic: "private-method", severity: "actionable", file: "/c.ts", line: 10, column: 0, endLine: 10, endColumn: 0, message: "private method", excerpt: "" },
                ],
                byHeuristic: {
                    "zero-assertion": 1,
                    "over-mocking": 0,
                    "mirror-logic": 0,
                    "flaky-timing": 0,
                    "no-aaa": 1,
                    "mystery-guest": 0,
                    "private-method": 1,
                    "god-test": 0,
                },
                bySeverity: { blocking: 1, actionable: 1, informational: 1 },
                blockingCount: 1,
            },
            coveragePct: 73,
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [
                { step: "npm test", passed: true },
                { step: "npm run lint", passed: false, output: "1 warning" },
                { step: "open the dashboard", passed: null },
            ],
            blockingFindings: [],
            actionableFindings: [],
            informationalFindings: [],
            strictMode: false,
        };
        const out = formatImplementSignals(signals);
        assert.ok(out.includes("Test smell scan"));
        assert.ok(out.includes("3 findings"));
        assert.ok(out.includes("1 blocking"));
        assert.ok(out.includes("Coverage"));
        assert.ok(out.includes("73.0%"));
        assert.ok(out.includes("BELOW floor"));
        assert.ok(out.includes("Mission verification"));
        assert.ok(out.includes("1 pass"));
        assert.ok(out.includes("1 fail"));
        assert.ok(out.includes("1 manual"));
        assert.ok(out.includes("Strict mode: off"));
    });

    it("renders a clean summary when no scan is available", () => {
        const signals: ImplementSignals = {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: null,
            coverageFloor: DEFAULT_COVERAGE_FLOOR,
            criticalPathCoveragePct: null,
            verificationSteps: [],
            blockingFindings: [],
            actionableFindings: [],
            informationalFindings: [],
            strictMode: false,
        };
        const out = formatImplementSignals(signals);
        assert.ok(out.includes("tool did not run"));
        assert.ok(out.includes("not measured"));
        assert.ok(out.includes("0 pass"));
    });

    it("shows strict mode ON when the env var is set", () => {
        // We test by constructing the signals directly with strictMode = true.
        const signals: ImplementSignals = {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: 85,
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [],
            blockingFindings: [],
            actionableFindings: [],
            informationalFindings: [],
            strictMode: true,
        };
        const out = formatImplementSignals(signals);
        assert.ok(out.includes("Strict mode: on"));
    });

    it("lists failed verification step summaries inline", () => {
        const signals: ImplementSignals = {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: null,
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [
                { step: "very long verification step description that should be truncated to 80 chars for the inline summary display", passed: false, output: "exit 1" },
            ],
            blockingFindings: [],
            actionableFindings: [],
            informationalFindings: [],
            strictMode: false,
        };
        const out = formatImplementSignals(signals);
        assert.ok(out.includes("FAILED:"));
        // Truncation is 80 chars max.
        const line = out.split("\n").find((l) => l.includes("FAILED:")) ?? "";
        const summaryLen = line.replace(/^\s*-\s*FAILED:\s*/, "").length;
        assert.ok(summaryLen <= 80, `expected FAILED summary <= 80 chars; got ${summaryLen}`);
    });
});
