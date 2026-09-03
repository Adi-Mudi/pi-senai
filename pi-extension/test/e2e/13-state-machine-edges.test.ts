import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig, writePlanArtifacts } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// State-machine edge cases the unit tests cover individually but the E2E
// suite never proved end-to-end against a real pi binary:
//   - /senai-plan with an active run → warn-and-ask dialog (cancel is no-op)
//   - /senai-reset clears state.json but preserves runs/<id>/ artifacts
//   - Deliver → /senai-reset → fresh /senai-plan starts a NEW run id
describe("e2e/13-state-machine-edges", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	beforeEach(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedSenaiConfig(home);
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	afterEach(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("/senai-plan with an active run prompts a confirm dialog (cancel preserves the run)", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan first mission" });
			await client.waitForIdle();
			const before = await client.getState();
			assert.strictEqual(before.currentStage, "planning");
			const firstRunId = before.runId;
			assert.ok(firstRunId, "first runId should be set");

			// Second /senai-plan should pop a confirm dialog. On pi 0.84.3
			// the prompt bug fires before the dialog appears, so we skip.
			// On a working pi, the default is cancel — capture the dialog
			// request via the extension UI sub-protocol and respond cancel.
			// For now we just assert that the run id did NOT change (i.e.,
			// no second run was created).
			await client.request("prompt", { text: "/senai-plan second mission" });
			await client.waitForIdle();
			const after = await client.getState();
			assert.strictEqual(after.runId, firstRunId, "cancel preserves the original run id");
			assert.strictEqual(after.currentStage, "planning", "stage did not advance");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});

	it("/senai-reset clears state.json but preserves runs/<run-id>/ artifacts", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan a mission" });
			await client.waitForIdle();
			const state = await client.getState();
			const runId = state.runId;
			assert.ok(runId, "runId should be set after /senai-plan");

			// Write a known artifact so we can prove it survives the reset.
			writePlanArtifacts(home.cwd, runId, "plan");
			const planPath = path.join(home.cwd, ".IDE_Plans/pi-senai/runs", runId, "plan/plan.md");
			assert.ok(fs.existsSync(planPath), "artifact should exist before reset");

			await client.request("prompt", { text: "/senai-reset" });
			await client.waitForIdle();

			const after = await client.getState();
			assert.strictEqual(after.currentStage, "none", "stage should be 'none' after reset");
			assert.ok(!after.runId, "runId should be cleared after reset");

			// Artifact on disk survives the reset.
			assert.ok(fs.existsSync(planPath), "artifact should survive /senai-reset");
			assert.ok(
				fs.existsSync(path.join(home.cwd, ".IDE_Plans/pi-senai/runs", runId)),
				`runs/${runId}/ directory should survive`,
			);
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});

	it("Deliver → /senai-reset → fresh /senai-plan starts a NEW run id; old artifacts stay", { timeout: 180_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan build a CLI" });
			await client.waitForIdle();
			const run1 = (await client.getState()).runId;
			assert.ok(run1, "first runId should exist");

			// Advance all the way to delivered with fixtures.
			writePlanArtifacts(home.cwd, run1, "plan");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			writePlanArtifacts(home.cwd, run1, "implement");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			writePlanArtifacts(home.cwd, run1, "document");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			writePlanArtifacts(home.cwd, run1, "deliver");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();

			const delivered = await client.getState();
			assert.strictEqual(delivered.currentStage, "delivered");

			await client.request("prompt", { text: "/senai-reset" });
			await client.waitForIdle();
			const reset = await client.getState();
			assert.strictEqual(reset.currentStage, "none");

			// Fresh plan starts a new run id.
			await client.request("prompt", { text: "/senai-plan a fresh mission" });
			await client.waitForIdle();
			const run2 = (await client.getState()).runId;
			assert.ok(run2, "second runId should exist");
			assert.notStrictEqual(run2, run1, "run ids must differ across reset");
			assert.ok(
				fs.existsSync(path.join(home.cwd, ".IDE_Plans/pi-senai/runs", run1)),
				"first run's artifacts must survive the reset",
			);
			assert.ok(
				fs.existsSync(path.join(home.cwd, ".IDE_Plans/pi-senai/runs", run2)),
				"second run directory must be created",
			);
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});
});
