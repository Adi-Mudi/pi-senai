import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, distModuleUrl, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Tests the Phase-3 hard gates on the implement-stage signal collector:
// manifest diff (planned create-files vs disk) and arch-rules violations.
// Drives pure functions via a Node subprocess over the bash RPC channel —
// no slash commands, no LLM needed.
describe("e2e/32-arch-rules-manifest", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedSenaiConfig(home);
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("signalsBlockAdvance blocks on an inline manifestDiff with missing + unexpected files", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { signalsBlockAdvance } from '${distModuleUrl("implement/signals.js")}'; const signals = { implementArtifactsPresent: true, testSmellScan: null, coveragePct: null, coverageFloor: 80, criticalPathCoveragePct: null, verificationSteps: [], blockingFindings: [], actionableFindings: [], informationalFindings: [], manifestDiff: { missing: ['src/new-module.ts'], unexpected: ['src/stray.ts'] }, archRules: null, strictMode: false }; const block = signalsBlockAdvance(signals); process.stdout.write(JSON.stringify(block))"`,
		});
		assert.ok(result.success, "signalsBlockAdvance subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const block = JSON.parse(output);
		assert.strictEqual(block.blocked, true, "manifest diff violations must block even in non-strict mode");
		assert.ok(
			block.reasons.some((r: string) => r.includes("Planned file was not created: src/new-module.ts")),
			`missing-file reason absent; got: ${JSON.stringify(block.reasons)}`,
		);
		assert.ok(
			block.reasons.some((r: string) => r.includes("Unplanned file in a manifest folder: src/stray.ts")),
			`unexpected-file reason absent; got: ${JSON.stringify(block.reasons)}`,
		);
	});

	it("signalsBlockAdvance blocks on arch-rules violations when the tool ran", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { signalsBlockAdvance } from '${distModuleUrl("implement/signals.js")}'; const signals = { implementArtifactsPresent: true, testSmellScan: null, coveragePct: null, coverageFloor: 80, criticalPathCoveragePct: null, verificationSteps: [], blockingFindings: [], actionableFindings: [], informationalFindings: [], manifestDiff: { missing: [], unexpected: [] }, archRules: { configFound: true, tool: 'dependency-cruiser', configPath: '.dependency-cruiser.json', toolAvailable: true, ran: true, violations: ['error presentation-not-to-data: src/a.ts -> src/data/b.ts'] }, strictMode: false }; const block = signalsBlockAdvance(signals); process.stdout.write(JSON.stringify(block))"`,
		});
		assert.ok(result.success, "signalsBlockAdvance subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const block = JSON.parse(output);
		assert.strictEqual(block.blocked, true, "arch-rules violations must block");
		assert.ok(
			block.reasons.some((r: string) => r.includes("Architecture rule violation")),
			`violation reason absent; got: ${JSON.stringify(block.reasons)}`,
		);
	});

	it("signalsBlockAdvance does NOT block when the arch tool is absent, and formatImplementSignals warns honestly", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { signalsBlockAdvance, formatImplementSignals } from '${distModuleUrl("implement/signals.js")}'; const signals = { implementArtifactsPresent: true, testSmellScan: null, coveragePct: null, coverageFloor: 80, criticalPathCoveragePct: null, verificationSteps: [], blockingFindings: [], actionableFindings: [], informationalFindings: [], manifestDiff: { missing: [], unexpected: [] }, archRules: { configFound: true, tool: 'dependency-cruiser', configPath: '.dependency-cruiser.json', toolAvailable: false, ran: false, violations: [] }, strictMode: false }; const block = signalsBlockAdvance(signals); const out = formatImplementSignals(signals); process.stdout.write(JSON.stringify({ blocked: block.blocked, warns: out.includes('not installed') }))"`,
		});
		assert.ok(result.success, "subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const summary = JSON.parse(output);
		assert.strictEqual(summary.blocked, false, "tool-absent must be warn-and-continue, never a block");
		assert.ok(summary.warns, `skip must be an honest 'not installed' message; got: ${JSON.stringify(summary)}`);
	});

	it("signalsBlockAdvance passes with a clean manifest diff and zero violations", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { signalsBlockAdvance } from '${distModuleUrl("implement/signals.js")}'; const signals = { implementArtifactsPresent: true, testSmellScan: null, coveragePct: null, coverageFloor: 80, criticalPathCoveragePct: null, verificationSteps: [], blockingFindings: [], actionableFindings: [], informationalFindings: [], manifestDiff: { missing: [], unexpected: [] }, archRules: { configFound: true, tool: 'dependency-cruiser', configPath: '.dependency-cruiser.json', toolAvailable: true, ran: true, violations: [] }, strictMode: false }; const block = signalsBlockAdvance(signals); process.stdout.write(JSON.stringify(block))"`,
		});
		assert.ok(result.success, "signalsBlockAdvance subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const block = JSON.parse(output);
		assert.strictEqual(block.blocked, false, "clean manifest diff + zero violations must not block");
	});
});
