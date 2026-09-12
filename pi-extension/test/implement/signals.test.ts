import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    DEFAULT_COVERAGE_FLOOR,
    checkPlanVerificationGate,
    countExecutableVerificationSteps,
    deriveBaselineVerificationSteps,
    formatImplementSignals,
    isExecutableStep,
    collectImplementSignals,
    parseVerificationSteps,
    signalsBlockAdvance,
    type ImplementSignals,
} from "../../src/implement/signals.js";
import { defaultState } from "../../src/core/state.js";
import { getArtifactPaths, getRunMissionBriefPath } from "../../src/core/paths.js";

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
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
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
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
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
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
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
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
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
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
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
                    "deleted-test-file": 0,
                    "weakened-assertion": 0,
                    "swallowed-error": 0,
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
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
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
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
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
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
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
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
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

describe("isExecutableStep", () => {
    it("treats shell commands as executable", () => {
        assert.strictEqual(isExecutableStep("npm test"), true);
        assert.strictEqual(isExecutableStep("$ npm run build"), true);
        assert.strictEqual(isExecutableStep("./scripts/check.sh"), true);
    });

    it("treats bare prose without shell shape as manual", () => {
        assert.strictEqual(isExecutableStep("verify"), false);
        assert.strictEqual(isExecutableStep("!!!"), false);
    });
});

describe("countExecutableVerificationSteps", () => {
    it("returns 0 when the plan has no ## Verification section", () => {
        assert.strictEqual(countExecutableVerificationSteps("# Plan\n\n## Steps\n\n1. npm test"), 0);
    });

    it("returns 0 when every step is prose", () => {
        const plan = "## Verification\n\n- eyeball\n- sanity";
        assert.strictEqual(countExecutableVerificationSteps(plan), 0);
    });

    it("counts only executable steps in a mixed section", () => {
        const plan = "## Verification\n\n1. npm test\n2. eyeball\n3. npm run build";
        assert.strictEqual(countExecutableVerificationSteps(plan), 2);
    });
});

describe("checkPlanVerificationGate", () => {
    function withRun(fn: (cwd: string, runId: string) => void) {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-gate-"));
        const runId = "2099-01-01-00-00-test";
        fs.mkdirSync(getArtifactPaths(cwd, runId).planDir, { recursive: true });
        try {
            fn(cwd, runId);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    }

    it("blocks when the plan file is missing", () => {
        withRun((cwd, runId) => {
            const gate = checkPlanVerificationGate(cwd, runId);
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("not readable"));
        });
    });

    it("blocks when the plan has no executable verification steps", () => {
        withRun((cwd, runId) => {
            fs.writeFileSync(getArtifactPaths(cwd, runId).plan, "# Plan\n\n## Verification\n\n- eyeball\n");
            const gate = checkPlanVerificationGate(cwd, runId);
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("no executable verification steps"));
        });
    });

    it("passes when at least one executable step exists and the ## Files manifest is valid", () => {
        withRun((cwd, runId) => {
            fs.writeFileSync(
                getArtifactPaths(cwd, runId).plan,
                "# Plan\n\n## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/a.ts | core | create | new module |\n\n## Verification\n\n1. npm test\n",
            );
            const gate = checkPlanVerificationGate(cwd, runId);
            assert.strictEqual(gate.blocked, false);
            assert.strictEqual(gate.reason, null);
        });
    });

    it("blocks when the plan has no ## Files manifest", () => {
        withRun((cwd, runId) => {
            fs.writeFileSync(getArtifactPaths(cwd, runId).plan, "# Plan\n\n## Verification\n\n1. npm test\n");
            const gate = checkPlanVerificationGate(cwd, runId);
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("## Files"));
        });
    });

    it("blocks with plan.md:line errors when the ## Files manifest is invalid", () => {
        withRun((cwd, runId) => {
            fs.writeFileSync(
                getArtifactPaths(cwd, runId).plan,
                "# Plan\n\n## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| ../escape.ts | core | create | x |\n| src/a.ts | core | move | y |\n\n## Verification\n\n1. npm test\n",
            );
            const gate = checkPlanVerificationGate(cwd, runId);
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("manifest has 2 error(s)"));
            assert.ok(gate.reason.includes("plan.md:7:"), "errors are listed plan.md:line-style");
            assert.ok(gate.reason.includes('invalid action "move"'));
        });
    });
});

describe("deriveBaselineVerificationSteps", () => {
    it("returns empty when no package.json exists", () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-base-"));
        try {
            assert.deepStrictEqual(deriveBaselineVerificationSteps(cwd), []);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("maps build and test scripts to npm commands", () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-base-"));
        try {
            fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { build: "tsc", test: "node --test" } }));
            assert.deepStrictEqual(deriveBaselineVerificationSteps(cwd), ["npm run build", "npm test"]);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("skips missing or empty scripts", () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-base-"));
        try {
            fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "  " } }));
            assert.deepStrictEqual(deriveBaselineVerificationSteps(cwd), []);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe("collectImplementSignals baseline steps", () => {
    it("runs baseline steps first and dedups plan steps", async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-collect-"));
        const runId = "2099-01-01-00-00-test";
        try {
            fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { build: "node -e \"process.exit(0)\"" } }));
            const ap = getArtifactPaths(cwd, runId);
            fs.mkdirSync(ap.planDir, { recursive: true });
            fs.mkdirSync(ap.implementDir, { recursive: true });
            fs.writeFileSync(ap.plan, "# Plan\n\n## Verification\n\n1. npm run build\n2. eyeball\n");
            const state = { ...defaultState(), runId, currentStage: "implementing" as const };
            const signals = await collectImplementSignals(cwd, state);
            const steps = signals.verificationSteps.map((s) => s.step);
            assert.deepStrictEqual(steps, ["npm run build", "eyeball"], `baseline first, plan deduped; got ${JSON.stringify(steps)}`);
            assert.strictEqual(signals.verificationSteps[0].passed, true);
            assert.strictEqual(signals.verificationSteps[1].passed, null);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe("checkPlanVerificationGate — architecture layer map (Phase 3)", () => {
    function withArchitectureProject(fn: (cwd: string, runId: string) => void) {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-gate-layers-"));
        const runId = "2099-01-01-00-00-layers";
        fs.mkdirSync(getArtifactPaths(cwd, runId).planDir, { recursive: true });
        fs.mkdirSync(path.join(cwd, ".pi", "architect"), { recursive: true });
        fs.mkdirSync(path.join(cwd, ".pi", "architecture-library"), { recursive: true });
        fs.writeFileSync(
            path.join(cwd, ".pi", "architect", "architect-profile.json"),
            JSON.stringify({
                projectName: "Test Project",
                projectSlug: "test-project",
                selectedArchitecture: "test-arch",
                drivers: {
                    functionalRequirements: [],
                    qualityAttributes: [],
                    constraints: [],
                    technicalConcerns: [],
                    uncertainties: [],
                },
                additionalConstraints: [],
            }),
        );
        fs.writeFileSync(
            path.join(cwd, ".pi", "architecture-library", "test-arch.md"),
            [
                "---",
                "name: test-arch",
                "---",
                "",
                "# Test Arch",
                "",
                "```json layer-map",
                JSON.stringify({
                    layers: [
                        { name: "core", folders: ["src/core"], mayImport: [] },
                        { name: "commands", folders: ["src/commands"], mayImport: ["core"] },
                    ],
                }),
                "```",
                "",
            ].join("\n"),
        );
        try {
            fn(cwd, runId);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    }

    function writePlanWithLayer(cwd: string, runId: string, layer: string): void {
        fs.writeFileSync(
            getArtifactPaths(cwd, runId).plan,
            `# Plan\n\n## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/core/a.ts | ${layer} | create | x |\n\n## Verification\n\n1. npm test\n`,
        );
    }

    it("blocks manifest rows whose layer is not in the architecture layer map", () => {
        withArchitectureProject((cwd, runId) => {
            writePlanWithLayer(cwd, runId, "bogus");
            const gate = checkPlanVerificationGate(cwd, runId);
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("not in the architecture layer map"));
        });
    });

    it("accepts manifest rows with declared layers", () => {
        withArchitectureProject((cwd, runId) => {
            writePlanWithLayer(cwd, runId, "core");
            const gate = checkPlanVerificationGate(cwd, runId);
            assert.strictEqual(gate.blocked, false);
            assert.strictEqual(gate.reason, null);
        });
    });
});

describe("signalsBlockAdvance — Phase 3 hard fails", () => {
    function baseSignals(): ImplementSignals {
        return {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: null,
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [],
            blockingFindings: [],
            actionableFindings: [],
            informationalFindings: [],
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
            strictMode: false,
        };
    }

    it("blocks when a planned create-file is missing on disk", () => {
        const signals = baseSignals();
        signals.manifestDiff = { missing: ["src/new-module.ts"], unexpected: [] };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, true);
        assert.ok(block.reasons.some((r) => r.includes("Planned file was not created: src/new-module.ts")));
    });

    it("blocks on unplanned files in manifest folders", () => {
        const signals = baseSignals();
        signals.manifestDiff = { missing: [], unexpected: ["src/stray.ts"] };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, true);
        assert.ok(block.reasons.some((r) => r.includes("Unplanned file in a manifest folder: src/stray.ts")));
    });

    it("blocks on arch-rules violations when the tool ran", () => {
        const signals = baseSignals();
        signals.archRules = {
            configFound: true,
            tool: "dependency-cruiser",
            configPath: ".dependency-cruiser.json",
            toolAvailable: true,
            ran: true,
            violations: ["error presentation-not-to-data: src/a.ts → src/data/b.ts"],
        };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, true);
        assert.ok(block.reasons.some((r) => r.includes("Architecture rule violation")));
    });

    it("does not block when the arch tool is absent (warn-and-continue)", () => {
        const signals = baseSignals();
        signals.archRules = {
            configFound: true,
            tool: "dependency-cruiser",
            configPath: ".dependency-cruiser.json",
            toolAvailable: false,
            ran: false,
            violations: [],
        };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, false);
        const out = formatImplementSignals(signals);
        assert.ok(out.includes("not installed"), "skip must be an honest message");
    });

    it("reports a clean manifest diff and zero violations without blocking", () => {
        const signals = baseSignals();
        signals.manifestDiff = { missing: [], unexpected: [] };
        signals.archRules = {
            configFound: true,
            tool: "dependency-cruiser",
            configPath: ".dependency-cruiser.json",
            toolAvailable: true,
            ran: true,
            violations: [],
        };
        assert.strictEqual(signalsBlockAdvance(signals).blocked, false);
    });
});

describe("collectImplementSignals — manifest diff (Phase 3)", () => {
    const MANIFEST_PLAN =
        "# Plan\n\n## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/new-module.ts | core | create | mission file |\n\n## Verification\n\n- echo ok\n";

    it("hard-fails when a planned create-file was not written, passes once written", async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-mdiff-"));
        try {
            const runId = "2099-01-01-00-00-mdiff";
            const ap = getArtifactPaths(cwd, runId);
            fs.mkdirSync(ap.planDir, { recursive: true });
            fs.mkdirSync(ap.implementDir, { recursive: true });
            fs.writeFileSync(ap.plan, MANIFEST_PLAN);
            const state = {
                ...defaultState(),
                runId,
                currentStage: "implementing" as const,
                startedAt: new Date().toISOString(),
            };

            const blockedSignals = await collectImplementSignals(cwd, state);
            assert.ok(blockedSignals.manifestDiff, "manifest diff must be collected");
            assert.deepStrictEqual(blockedSignals.manifestDiff!.missing, ["src/new-module.ts"]);
            assert.strictEqual(signalsBlockAdvance(blockedSignals).blocked, true);

            fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
            fs.writeFileSync(path.join(cwd, "src", "new-module.ts"), "export {};\n");
            const cleanSignals = await collectImplementSignals(cwd, state);
            assert.deepStrictEqual(cleanSignals.manifestDiff!.missing, []);
            assert.deepStrictEqual(cleanSignals.manifestDiff!.unexpected, []);
            assert.strictEqual(signalsBlockAdvance(cleanSignals).blocked, false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("flags files the run created outside the manifest (mtime-scoped)", async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-mdiff-since-"));
        try {
            const runId = "2099-01-01-00-00-since";
            const ap = getArtifactPaths(cwd, runId);
            fs.mkdirSync(ap.planDir, { recursive: true });
            fs.mkdirSync(ap.implementDir, { recursive: true });
            // Backdate slightly: file mtimes written in the same millisecond
            // as `new Date()` would fail the strict `mtime > since` check.
            const startedAt = new Date(Date.now() - 1000).toISOString();
            // Pre-existing file in the target folder — created BEFORE the run
            // started, so it must not count as unexpected.
            fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
            const oldFile = path.join(cwd, "src", "old.ts");
            fs.writeFileSync(oldFile, "// old\n");
            const past = new Date(Date.now() - 60_000);
            fs.utimesSync(oldFile, past, past);
            fs.writeFileSync(ap.plan, MANIFEST_PLAN);
            fs.writeFileSync(path.join(cwd, "src", "new-module.ts"), "export {};\n");
            // A file written during the run that the manifest did not plan.
            fs.writeFileSync(path.join(cwd, "src", "sneaky.ts"), "export {};\n");

            const state = {
                ...defaultState(),
                runId,
                currentStage: "implementing" as const,
                startedAt,
            };
            const signals = await collectImplementSignals(cwd, state);
            assert.deepStrictEqual(signals.manifestDiff!.missing, []);
            assert.deepStrictEqual(signals.manifestDiff!.unexpected, ["src/sneaky.ts"]);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe("collectImplementSignals — Phase 4 persisted reports", () => {
    it("writes manifest-diff-report.md and arch-rules-report.md into the run's implement dir", async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-reports-"));
        try {
            const runId = "2099-01-01-00-00-reports";
            const ap = getArtifactPaths(cwd, runId);
            fs.mkdirSync(ap.planDir, { recursive: true });
            fs.mkdirSync(ap.implementDir, { recursive: true });
            fs.writeFileSync(
                ap.plan,
                "# Plan\n\n## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/new-module.ts | core | create | mission file |\n\n## Verification\n\n- echo ok\n",
            );
            const state = {
                ...defaultState(),
                runId,
                currentStage: "implementing" as const,
                startedAt: new Date(Date.now() - 1000).toISOString(),
            };

            await collectImplementSignals(cwd, state);

            const manifestReport = fs.readFileSync(ap.manifestDiffReport, "utf8");
            assert.ok(manifestReport.includes("# Manifest diff report"));
            assert.ok(manifestReport.includes("src/new-module.ts"), "missing planned file is listed");

            const archReport = fs.readFileSync(ap.archRulesReport, "utf8");
            assert.ok(archReport.includes("# Arch rules report"));
            assert.ok(
                archReport.includes("No emitted arch-rules config"),
                "tool/config absence is recorded honestly",
            );
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe("signalsBlockAdvance — bugfix regression test (Phase 4)", () => {
    function baseSignals(): ImplementSignals {
        return {
            implementArtifactsPresent: true,
            testSmellScan: null,
            coveragePct: null,
            coverageFloor: 80,
            criticalPathCoveragePct: null,
            verificationSteps: [],
            blockingFindings: [],
            actionableFindings: [],
            informationalFindings: [],
            manifestDiff: null,
            archRules: null,
            frameworkRules: null,
            strictMode: false,
        };
    }

    it("blocks on bugfix regression-test problems even with strict mode off", () => {
        const signals = baseSignals();
        signals.bugfixRegressionTest = {
            candidates: ["test/x.test.ts"],
            problems: ["regression test file does not exist on disk: test/x.test.ts"],
        };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, true);
        assert.ok(block.reasons.some((r) => r.includes("Bugfix regression test")));
    });

    it("does not block when the bugfix regression-test signal is clean", () => {
        const signals = baseSignals();
        signals.bugfixRegressionTest = { candidates: ["test/x.test.ts"], problems: [] };
        assert.strictEqual(signalsBlockAdvance(signals).blocked, false);
        const out = formatImplementSignals(signals);
        assert.ok(out.includes("Bugfix regression test: ok (test/x.test.ts)"));
    });

    it("lists bugfix regression-test problems in the formatted output", () => {
        const signals = baseSignals();
        signals.bugfixRegressionTest = {
            candidates: [],
            problems: ["mission brief has no filled `## Regression test plan` section"],
        };
        const out = formatImplementSignals(signals);
        assert.ok(out.includes("Bugfix regression test: 1 problem(s)"));
        assert.ok(out.includes("Regression test plan"));
    });
});

describe("collectImplementSignals — bugfix regression test (Phase 4)", () => {
    const BUGFIX_PLAN =
        "# Plan\n\n## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| test/lock.test.ts | core | create | regression |\n\n## Verification\n\n- echo ok\n";
    const BUGFIX_BRIEF =
        "# Mission brief\n\n## Mission type\n\nbugfix\n\n## Regression test plan\n\nAdd test/lock.test.ts reproducing the deadlock.\n";

    function setupBugfixRun(cwd: string, runId: string): void {
        const ap = getArtifactPaths(cwd, runId);
        fs.mkdirSync(ap.planDir, { recursive: true });
        fs.mkdirSync(ap.implementDir, { recursive: true });
        fs.writeFileSync(ap.plan, BUGFIX_PLAN);
        const briefPath = getRunMissionBriefPath(cwd, runId);
        fs.mkdirSync(path.dirname(briefPath), { recursive: true });
        fs.writeFileSync(briefPath, BUGFIX_BRIEF);
    }

    it("blocks when the brief's regression test file does not exist on disk", async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-bugfix-"));
        try {
            const runId = "2099-01-01-00-00-bugfix";
            setupBugfixRun(cwd, runId);
            const state = {
                ...defaultState(),
                runId,
                currentStage: "implementing" as const,
                startedAt: new Date(Date.now() - 1000).toISOString(),
                missionType: "bugfix" as const,
            };
            const signals = await collectImplementSignals(cwd, state);
            assert.ok(signals.bugfixRegressionTest, "bugfix signal must be collected");
            assert.deepStrictEqual(signals.bugfixRegressionTest!.candidates, ["test/lock.test.ts"]);
            assert.ok(
                signals.bugfixRegressionTest!.problems.some((p) => p.includes("does not exist on disk: test/lock.test.ts")),
                `expected a not-on-disk problem; got ${JSON.stringify(signals.bugfixRegressionTest!.problems)}`,
            );
            const block = signalsBlockAdvance(signals);
            assert.strictEqual(block.blocked, true);
            assert.ok(block.reasons.some((r) => r.includes("Bugfix regression test")));
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("passes once the regression test file exists and is manifest-covered", async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-bugfix-"));
        try {
            const runId = "2099-01-01-00-00-bugfix-ok";
            setupBugfixRun(cwd, runId);
            fs.mkdirSync(path.join(cwd, "test"), { recursive: true });
            fs.writeFileSync(path.join(cwd, "test", "lock.test.ts"), "export {};\n");
            const state = {
                ...defaultState(),
                runId,
                currentStage: "implementing" as const,
                startedAt: new Date(Date.now() - 1000).toISOString(),
                missionType: "bugfix" as const,
            };
            const signals = await collectImplementSignals(cwd, state);
            assert.ok(signals.bugfixRegressionTest);
            assert.deepStrictEqual(signals.bugfixRegressionTest!.problems, []);
            assert.strictEqual(signalsBlockAdvance(signals).blocked, false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("does not run the check for non-bugfix missions", async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-bugfix-"));
        try {
            const runId = "2099-01-01-00-00-feature";
            setupBugfixRun(cwd, runId);
            const state = {
                ...defaultState(),
                runId,
                currentStage: "implementing" as const,
                startedAt: new Date(Date.now() - 1000).toISOString(),
                missionType: "feature" as const,
            };
            const signals = await collectImplementSignals(cwd, state);
            assert.strictEqual(signals.bugfixRegressionTest, undefined);
            const block = signalsBlockAdvance(signals);
            assert.ok(!block.reasons.some((r) => r.includes("Bugfix regression test")));
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});
