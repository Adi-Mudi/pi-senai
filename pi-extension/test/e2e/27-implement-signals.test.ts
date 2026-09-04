import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, distModuleUrl, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Tests the implement-stage signal collector and the strict-mode block
// logic added in the testing-discipline feature. Drives pure functions
// via a Node subprocess over the bash RPC channel — no slash commands,
// no LLM needed.
describe("e2e/27-implement-signals", () => {
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

	it("parseVerificationSteps extracts numbered and bulleted steps from a plan", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { parseVerificationSteps } from '${distModuleUrl("implement-signals.js")}'; const plan = '# Plan\\n\\n## Verification\\n\\n1. Run npm test\\n2. Run npm run lint\\n- Open the app and check the dashboard\\n'; const steps = parseVerificationSteps(plan); process.stdout.write(JSON.stringify({ count: steps.length, has1: steps.some(s => s.includes('npm test')), has2: steps.some(s => s.includes('npm run lint')), has3: steps.some(s => s.includes('dashboard')) }))"`,
		});
		assert.ok(result.success, "parseVerificationSteps subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const summary = JSON.parse(output);
		assert.strictEqual(summary.count, 3, `expected 3 steps; got ${summary.count}`);
		assert.ok(summary.has1 && summary.has2 && summary.has3, `steps missing content; got ${JSON.stringify(summary)}`);
	});

	it("signalsBlockAdvance returns blocked=true when a verification step fails (regardless of strict mode)", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { signalsBlockAdvance } from '${distModuleUrl("implement-signals.js")}'; const signals = { implementArtifactsPresent: true, testSmellScan: null, coveragePct: null, coverageFloor: 80, criticalPathCoveragePct: null, verificationSteps: [{ step: 'npm test', passed: false, output: '1 failed' }], blockingFindings: [], actionableFindings: [], informationalFindings: [], strictMode: false }; const block = signalsBlockAdvance(signals); process.stdout.write(JSON.stringify(block))"`,
		});
		assert.ok(result.success, "signalsBlockAdvance subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const block = JSON.parse(output);
		assert.strictEqual(block.blocked, true, "verification failure must block in non-strict mode too");
		assert.ok(block.reasons.some((r: string) => /Verification step failed/i.test(r)), `reasons missing verification failure; got: ${JSON.stringify(block.reasons)}`);
	});

	it("signalsBlockAdvance returns blocked=false when signals are clean and strict mode is off", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { signalsBlockAdvance } from '${distModuleUrl("implement-signals.js")}'; const signals = { implementArtifactsPresent: true, testSmellScan: null, coveragePct: null, coverageFloor: 80, criticalPathCoveragePct: null, verificationSteps: [], blockingFindings: [], actionableFindings: [], informationalFindings: [], strictMode: false }; const block = signalsBlockAdvance(signals); process.stdout.write(JSON.stringify(block))"`,
		});
		assert.ok(result.success, "signalsBlockAdvance subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const block = JSON.parse(output);
		assert.strictEqual(block.blocked, false, "clean signals must not block in non-strict mode");
	});

	it("formatImplementSignals renders the strict-mode info line", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { formatImplementSignals } from '${distModuleUrl("implement-signals.js")}'; const signals = { implementArtifactsPresent: true, testSmellScan: null, coveragePct: null, coverageFloor: 80, criticalPathCoveragePct: null, verificationSteps: [], blockingFindings: [], actionableFindings: [], informationalFindings: [], strictMode: false }; const out = formatImplementSignals(signals); process.stdout.write(JSON.stringify({ hasStrictOff: out.includes('Strict mode: off'), hasFloor: /Coverage:/.test(out) || /Coverage floor/.test(out) || /not measured/.test(out) }))"`,
		});
		assert.ok(result.success, "formatImplementSignals subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const summary = JSON.parse(output);
		assert.ok(summary.hasStrictOff, `output missing 'Strict mode: off' line; got summary: ${JSON.stringify(summary)}`);
	});
});
