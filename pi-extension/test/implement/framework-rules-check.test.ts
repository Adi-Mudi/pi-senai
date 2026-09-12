import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    checkFrameworkRules,
    deriveForbiddenRules,
    frameworkRulesFromMap,
    emitFrameworkDependencyCruiserConfig,
    type FrameworkRulesExecFn,
} from "../../src/implement/framework-rules-check.js";
import {
    collectImplementSignals,
    signalsBlockAdvance,
    formatImplementSignals,
    type ImplementSignals,
} from "../../src/implement/signals.js";
import { loadFrameworkMap } from "@adi-mudi/pi-chirpi";
import { defaultState } from "../../src/core/state.js";
import { getArtifactPaths } from "../../src/core/paths.js";

const RUN_ID = "2099-01-01-00-00-fwrules";

function makeProject(files: Record<string, string>): string {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-fwrules-"));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(cwd, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
    }
    return cwd;
}

function writePlan(cwd: string, body: string): void {
    const ap = getArtifactPaths(cwd, RUN_ID);
    fs.mkdirSync(ap.planDir, { recursive: true });
    fs.writeFileSync(ap.plan, body);
}

const EXPRESS_PLAN = "# Plan\n\n## Framework\n\nexpress\n\n## Verification\n\n- echo ok\n";
const NONE_PLAN = "# Plan\n\n## Framework\n\nnone\n\n## Verification\n\n- echo ok\n";

const noopExec: FrameworkRulesExecFn = async () => ({ code: 0, output: "" });

function loadExpressMap() {
    const map = loadFrameworkMap(process.cwd(), "express");
    assert.ok(map, "express map must load from the bundled framework library");
    return map;
}

describe("framework rules from map", () => {
    it("prefers the map's parsed ## Rules block (express)", () => {
        const map = loadExpressMap();
        assert.ok(map.rules.length > 0, "express map carries parsed rules");
        const rules = frameworkRulesFromMap(map);
        const pairs = rules.map((r) => `${r.from}→${r.to}`).sort();
        assert.deepStrictEqual(pairs, [
            "controllers/**→models/**",
            "routes/**→models/**",
            "services/**→pkg:express",
        ]);
        for (const r of rules) assert.ok(r.source.length > 0, "every rule carries its reason");
    });

    it("falls back to prose compilation for maps without a ## Rules section", () => {
        const proseMap = {
            id: "prose-fw",
            language: "typescript",
            framework: "Prose",
            officialDocs: "https://example.com",
            detectDeps: ["prose-fw"],
            rules: [],
            filePath: "prose-fw.md",
            content: [
                "# Prose",
                "",
                "## Layout map",
                "```",
                "src/",
                "  routes/",
                "  controllers/",
                "  services/",
                "  models/",
                "```",
                "",
                "## Forbidden patterns",
                "1. Route files importing models or the database directly — routes only wire URLs.",
                "2. Controllers importing models directly — controllers go through services.",
                "3. Services importing `express`, `req`, or `res` — services are framework-free.",
                "4. Business logic inside route files.",
            ].join("\n"),
        };
        const rules = deriveForbiddenRules(proseMap);
        const pairs = rules.map((r) => `${r.from}→${r.to}`).sort();
        assert.deepStrictEqual(pairs, [
            "controllers/**→models/**",
            "routes/**→models/**",
            "services/**→pkg:express",
        ]);
    });

    it("nestjs, django, and flask now produce executable rules from their ## Rules blocks", () => {
        for (const [id, min] of [["nestjs", 4], ["django", 1], ["flask", 2]] as const) {
            const map = loadFrameworkMap(process.cwd(), id);
            assert.ok(map, `${id} map must load`);
            const rules = frameworkRulesFromMap(map);
            assert.ok(rules.length >= min, `${id} should yield >= ${min} rule(s); got ${rules.length}`);
        }
    });

    it("emits a dependency-cruiser config with one forbidden rule per rule", () => {
        const map = loadExpressMap();
        const rules = frameworkRulesFromMap(map);
        const config = JSON.parse(emitFrameworkDependencyCruiserConfig("express", rules));
        assert.strictEqual(config.forbidden.length, rules.length);
        const servicesRule = config.forbidden.find((r: any) => r.name.includes("services-not-pkg-express"));
        assert.ok(servicesRule, "services→express rule present");
        assert.ok(servicesRule.to.path.includes("^express"));
        const routesRule = config.forbidden.find((r: any) => r.name.includes("routes-not-models"));
        assert.ok(routesRule.from.path.includes("routes/"), "path glob compiled to a regex");
    });
});

describe("checkFrameworkRules", () => {
    it("skips cleanly when the plan has no ## Framework field", async () => {
        const cwd = makeProject({});
        try {
            writePlan(cwd, "# Plan\n\n## Verification\n\n- echo ok\n");
            const result = await checkFrameworkRules(cwd, RUN_ID, noopExec);
            assert.strictEqual(result.skipped, true);
            assert.strictEqual(result.frameworkId, null);
            assert.ok(result.skipReason?.includes("no `## Framework` field"));
            assert.strictEqual(result.ran, false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("skips cleanly when the manifest records `none`", async () => {
        const cwd = makeProject({});
        try {
            writePlan(cwd, NONE_PLAN);
            const result = await checkFrameworkRules(cwd, RUN_ID, noopExec);
            assert.strictEqual(result.skipped, true);
            assert.strictEqual(result.frameworkId, "none");
            assert.ok(result.skipReason?.includes("`none`"));
            assert.strictEqual(result.ran, false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("derives rules and emits a config, but warns when dependency-cruiser is not installed", async () => {
        const cwd = makeProject({});
        try {
            writePlan(cwd, EXPRESS_PLAN);
            const result = await checkFrameworkRules(cwd, RUN_ID, noopExec);
            assert.strictEqual(result.skipped, false);
            assert.strictEqual(result.frameworkId, "express");
            assert.strictEqual(result.tool, "dependency-cruiser");
            assert.strictEqual(result.toolAvailable, false);
            assert.strictEqual(result.ran, false);
            assert.ok(result.rules.length >= 3, "express rules derived");
            assert.ok(result.configPath && fs.existsSync(path.join(cwd, result.configPath)), "emitted config exists in the implement dir");
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("passes when dependency-cruiser exits clean (mocked runner)", async () => {
        const cwd = makeProject({ "node_modules/.bin/depcruise": "#!/bin/sh\n" });
        try {
            writePlan(cwd, EXPRESS_PLAN);
            const result = await checkFrameworkRules(cwd, RUN_ID, noopExec);
            assert.strictEqual(result.toolAvailable, true);
            assert.strictEqual(result.ran, true);
            assert.deepStrictEqual(result.violations, []);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("collects violations when dependency-cruiser fails (mocked runner)", async () => {
        const cwd = makeProject({ "node_modules/.bin/depcruise": "#!/bin/sh\n" });
        const mockExec: FrameworkRulesExecFn = async () => ({
            code: 1,
            output: "error framework-express-routes-not-models: src/routes/a.ts → src/models/b.ts\n",
        });
        try {
            writePlan(cwd, EXPRESS_PLAN);
            const result = await checkFrameworkRules(cwd, RUN_ID, mockExec);
            assert.strictEqual(result.ran, true);
            assert.strictEqual(result.violations.length, 1);
            assert.ok(result.violations[0].includes("framework-express-routes-not-models"));
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("runs import-linter for python maps (mocked runner)", async () => {
        const cwd = makeProject({});
        const mockExec: FrameworkRulesExecFn = async (_cmd, args) => {
            if (args[0] === "--version") return { code: 0, output: "1.0" };
            return { code: 1, output: "Contracts: 1 kept, 1 broken.\n\nBROKEN: services must not import fastapi\n" };
        };
        try {
            writePlan(cwd, "# Plan\n\n## Framework\n\nfastapi\n\n## Verification\n\n- echo ok\n");
            const result = await checkFrameworkRules(cwd, RUN_ID, mockExec);
            assert.strictEqual(result.tool, "import-linter");
            assert.strictEqual(result.ran, true);
            assert.ok(result.violations.some((v) => v.includes("BROKEN")));
            assert.ok(result.configPath && fs.existsSync(path.join(cwd, result.configPath)), "emitted import-linter config exists");
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("warns when import-linter is not on PATH", async () => {
        const cwd = makeProject({});
        const missingExec: FrameworkRulesExecFn = async () => ({ code: -1, output: "" });
        try {
            writePlan(cwd, "# Plan\n\n## Framework\n\nfastapi\n\n## Verification\n\n- echo ok\n");
            const result = await checkFrameworkRules(cwd, RUN_ID, missingExec);
            assert.strictEqual(result.tool, "import-linter");
            assert.strictEqual(result.toolAvailable, false);
            assert.strictEqual(result.ran, false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("skips honestly when a map has neither ## Rules nor derivable prose", async () => {
        const cwd = makeProject({
            ".pi/framework-library/typescript/vague-fw.md": [
                "---",
                "id: vague-fw",
                "language: typescript",
                "framework: Vague",
                "officialDocs: https://example.com",
                "detectDeps:",
                "  - vague-fw",
                "---",
                "",
                "# Vague",
                "",
                "## Layout map",
                "```",
                "src/",
                "  routes/",
                "  services/",
                "```",
                "",
                "## Layer fit",
                "- monolith",
                "",
                "## Forbidden patterns",
                "1. Fat route files — keep logic in services.",
                "",
                "## Verification hints",
                "- npm test",
            ].join("\n"),
        });
        try {
            writePlan(cwd, "# Plan\n\n## Framework\n\nvague-fw\n\n## Verification\n\n- echo ok\n");
            const result = await checkFrameworkRules(cwd, RUN_ID, noopExec);
            assert.strictEqual(result.skipped, true);
            assert.ok(result.skipReason?.includes("no executable rules"));
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});

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

describe("signals wiring — framework rules", () => {
    it("blocks on framework-rules violations when the tool ran", () => {
        const signals = baseSignals();
        signals.frameworkRules = {
            frameworkId: "express",
            skipped: false,
            skipReason: null,
            rules: [{ source: "s", from: "routes", to: "models" }],
            configPath: "x/framework-rules.dependency-cruiser.json",
            tool: "dependency-cruiser",
            toolAvailable: true,
            ran: true,
            violations: ["error framework-express-routes-not-models: src/routes/a.ts → src/models/b.ts"],
        };
        const block = signalsBlockAdvance(signals);
        assert.strictEqual(block.blocked, true);
        assert.ok(block.reasons.some((r) => r.includes("Framework rule violation")));
    });

    it("does not block on a clean skip or a tool-absent run, and the summary says so", () => {
        const skipped = baseSignals();
        skipped.frameworkRules = {
            frameworkId: "none",
            skipped: true,
            skipReason: "manifest records `none` — no framework checks apply",
            rules: [],
            configPath: null,
            tool: null,
            toolAvailable: false,
            ran: false,
            violations: [],
        };
        assert.strictEqual(signalsBlockAdvance(skipped).blocked, false);
        assert.ok(formatImplementSignals(skipped).includes("Framework rules: skipped"));

        const toolAbsent = baseSignals();
        toolAbsent.frameworkRules = { ...skipped.frameworkRules, frameworkId: "express", skipped: false, skipReason: null, tool: "dependency-cruiser" };
        assert.strictEqual(signalsBlockAdvance(toolAbsent).blocked, false);
        assert.ok(formatImplementSignals(toolAbsent).includes("not installed"));
    });

    it("collectImplementSignals writes framework-rules-report.md into the run's implement dir", async () => {
        const cwd = makeProject({});
        try {
            writePlan(cwd, EXPRESS_PLAN);
            const ap = getArtifactPaths(cwd, RUN_ID);
            fs.mkdirSync(ap.implementDir, { recursive: true });
            const state = {
                ...defaultState(),
                runId: RUN_ID,
                currentStage: "implementing" as const,
                startedAt: new Date(Date.now() - 1000).toISOString(),
            };
            const signals = await collectImplementSignals(cwd, state);
            assert.ok(signals.frameworkRules, "framework rules result collected");
            assert.strictEqual(signals.frameworkRules!.frameworkId, "express");

            const report = fs.readFileSync(ap.frameworkRulesReport, "utf8");
            assert.ok(report.includes("# Framework rules report"));
            assert.ok(report.includes("Framework: express"));
            assert.ok(report.includes("not installed"), "tool absence recorded honestly");

            const noneCwd = makeProject({});
            try {
                writePlan(noneCwd, NONE_PLAN);
                const noneAp = getArtifactPaths(noneCwd, RUN_ID);
                fs.mkdirSync(noneAp.implementDir, { recursive: true });
                await collectImplementSignals(noneCwd, { ...state });
                const noneReport = fs.readFileSync(noneAp.frameworkRulesReport, "utf8");
                assert.ok(noneReport.includes("SKIPPED"));
                assert.ok(noneReport.includes("`none`"));
            } finally {
                fs.rmSync(noneCwd, { recursive: true, force: true });
            }
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});
