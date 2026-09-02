import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig, writePlanArtifacts } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Mirror of STAGE_TRANSITIONS (constants.ts:33-43). Each entry pairs a
// starting stage with the next one approval should reach.
const FORWARD: Array<[string, string]> = [
	["planning", "planned"],
	["implementing", "implemented"],
	["documenting", "documented"],
	["delivering", "delivered"],
];

describe("e2e/03-state-machine", () => {
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

	async function driveToStage(target: string): Promise<string | undefined> {
		assert.ok(client && home, "test setup missing");
		await client.request("prompt", { text: "/senai-plan state-machine test" });
		await client.waitForIdle();
		const state0 = await client.getState();
		const runId = state0.runId;
		assert.ok(runId, "runId missing");

		// Walk forward one transition at a time, writing fixtures between
		// approvals so each stage has its expected artifacts.
		const kinds: Array<"plan" | "implement" | "document" | "deliver"> = ["plan", "implement", "document", "deliver"];
		let state = state0;
		while (state.currentStage !== target && state.currentStage !== "delivered") {
			const idx = kinds.findIndex((_, i) => ["planning", "implementing", "documenting", "delivering"][i] === state.currentStage);
			if (idx === -1) break;
			writePlanArtifacts(home.cwd, runId, kinds[idx]);
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			state = await client.getState();
			if (state.currentStage === target) break;
		}
		return runId;
	}

	for (const [from, expected] of FORWARD) {
		it(`approve from '${from}' with missing artifacts warns-and-asks (run id stays the same)`, { timeout: 60_000 }, async (t) => {
			if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
			try {
				const runId = await driveToStage(from);
				assert.ok(runId, "test setup failed to drive to target stage");
				assert.strictEqual((await client!.getState()).currentStage, from, `could not reach ${from}`);

				// Do NOT write the artifacts for the next stage: approve must
				// surface a warn-and-ask and the run id must not change.
				await client!.request("prompt", { text: "/senai-approve" });
				await client!.waitForIdle();
				const state = await client!.getState();
				assert.strictEqual(state.runId, runId, `approve from ${from} advanced despite missing artifacts (runId changed)`);
				assert.notStrictEqual(state.currentStage, expected, `approve from ${from} should not auto-advance when artifacts missing`);
			} catch (err) {
				if (isPiRpcPromptBug(err)) {
					return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)})`);
				}
				throw err;
			}
		});
	}
});
