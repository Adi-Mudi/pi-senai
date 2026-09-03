import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig, writePlanArtifacts } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Real subagent spawning needs an LLM API key, so this test drives the
// state machine with fixtures between approvals rather than real scout /
// implementer / writer runs. The state machine + artifact checks are the
// only parts of the lifecycle we cover in Tier 1.
describe("e2e/02-full-lifecycle", () => {
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

	it("Plan → Implement → Document → Deliver advances state and writes all artifacts", { timeout: 180_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			// /senai-plan moves currentStage from `none` to `planning`.
			await client.request("prompt", { text: "/senai-plan add a hello world CLI" });
			await client.waitForIdle();
			const initialState = await client.getState();
			assert.strictEqual(initialState.currentStage, "planning");
			const runId = initialState.runId;
			assert.ok(runId, "runId missing after /senai-plan");

			// Plan stage "completes" via fixtures; approve advances to `planned`
			// then auto-runs implement → `implementing`.
			writePlanArtifacts(home.cwd, runId, "plan");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			let state = await client.getState();
			assert.strictEqual(state.currentStage, "implementing");

			writePlanArtifacts(home.cwd, runId, "implement");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			state = await client.getState();
			assert.strictEqual(state.currentStage, "documenting");

			writePlanArtifacts(home.cwd, runId, "document");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			state = await client.getState();
			assert.strictEqual(state.currentStage, "delivering");

			writePlanArtifacts(home.cwd, runId, "deliver");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			state = await client.getState();
			assert.strictEqual(state.currentStage, "delivered");

			// Every artifact the doctor run-audit looks for is on disk.
			const runDir = path.join(home.cwd, ".IDE_Plans/senai/runs", runId);
			const required = [
				"plan/plan.md",
				"plan/plan-overview.md",
				"plan/discussion-notes.md",
				"plan/scouts/scout-angle_1.md",
				"plan/scouts/scout-angle_2.md",
				"plan/scouts/scout-angle_3.md",
				"plan/scouts/scout-angle_4.md",
				"plan/reviews/review-correctness.md",
				"plan/reviews/review-security.md",
				"plan/reviews/review-tests.md",
				"implement/src/index.js",
				"implement/test/index.test.js",
				"document/README.md",
				"document/CHANGELOG.md",
				"deliver/security-report.md",
				"deliver/deliver-summary.md",
			];
			for (const rel of required) {
				assert.ok(fs.existsSync(path.join(runDir, rel)), `missing artifact: ${rel}`);
			}
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});
});
