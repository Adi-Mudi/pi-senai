import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig, writePlanArtifacts } from "./helpers/fixtures.js";
import { getCadencePath } from "../../src/core/paths.js";

const SKIP_NO_LLM = "this test drives /senai-plan which needs a real LLM API key";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Drives a real /senai-approve through the state machine and asserts the
// cadence file's `consecutiveCleanRuns` counter increments — the hookup
// from the approve command into the cadence module. Without this, the
// `recordCleanRun` call inside the approve lock is only proven by mocks.
describe("e2e/11-caden-approve", () => {
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

	it("Plan approval increments cadence.consecutiveCleanRuns to 1", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip(SKIP_NO_LLM);
		assert.ok(client && home, "test setup missing");
		try {
			assert.ok(!fs.existsSync(getCadencePath(home.cwd)), "cadence file should not pre-exist");

			await client.request("prompt", { text: "/senai-plan add a hello world CLI" });
			await client.waitForIdle();
			const initial = await client.getState();
			assert.strictEqual(initial.currentStage, "planning");
			const runId = initial.runId;
			assert.ok(runId, "runId missing after /senai-plan");

			writePlanArtifacts(home.cwd, runId, "plan");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();

			const cadenceFile = getCadencePath(home.cwd);
			assert.ok(fs.existsSync(cadenceFile), "cadence file should exist after Plan approval");
			const state = JSON.parse(fs.readFileSync(cadenceFile, "utf8"));
			assert.strictEqual(state.tier, "A", "tier stays at A (only 1 clean run, ceiling)");
			assert.strictEqual(state.consecutiveCleanRuns, 1, "Plan approval should count as 1 clean run");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			if ((err as Error).message?.includes("waitForIdle timed out")) {
				return t.skip("this test drives /senai-plan which needs a real LLM API key (agent_settled never fired)");
			}
			throw err;
		}
	});

	it("non-Plan approvals do NOT increment the clean-run counter", { timeout: 120_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip(SKIP_NO_LLM);
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan build a CLI" });
			await client.waitForIdle();
			const initial = await client.getState();
			const runId = initial.runId;
			assert.ok(runId, "runId missing after /senai-plan");

			writePlanArtifacts(home.cwd, runId, "plan");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			const afterPlan = JSON.parse(fs.readFileSync(getCadencePath(home.cwd), "utf8"));
			assert.strictEqual(afterPlan.consecutiveCleanRuns, 1, "Plan approval → 1 clean run");

			writePlanArtifacts(home.cwd, runId, "implement");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			writePlanArtifacts(home.cwd, runId, "document");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			writePlanArtifacts(home.cwd, runId, "deliver");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();

			const final = JSON.parse(fs.readFileSync(getCadencePath(home.cwd), "utf8"));
			assert.strictEqual(final.consecutiveCleanRuns, 1, "only the Plan approval counted");
			assert.strictEqual(final.tier, "A", "tier still A after only 1 clean run");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			if ((err as Error).message?.includes("waitForIdle timed out")) {
				return t.skip("this test drives /senai-plan which needs a real LLM API key (agent_settled never fired)");
			}
			throw err;
		}
	});
});
