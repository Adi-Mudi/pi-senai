import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, shouldRunLLME2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig, seedCadenceState } from "./helpers/fixtures.js";
import { getCadencePath } from "../../src/constants.js";

const SKIP_NO_LLM = "Tier 2 E2E requires RUN_LLM_E2E=1 plus a provider API key";

// Tier 2: real rate-limit → cadence demotion. The Plan stage runs four
// scouts in parallel against a real provider. With a deliberately tight
// TPM/RPM budget (or simply a low-quota provider), at least one scout
// fails with a 429 and the input hook must demote the cadence file
// from A → B.
//
// Note: this test depends on the provider returning 429 for the burst.
// On a generous quota provider (Claude Sonnet, GPT-5), the burst often
// succeeds and the cadence stays at A — the test then asserts that the
// file is still valid (didn't get corrupted by the hook) rather than
// that it demoted.
describe("e2e/22-real-llm-caden-demote", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		if (!shouldRunLLME2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedSenaiConfig(home);
		client = new RpcClient({ env: home.env, cwd: home.cwd, timeoutMs: 120_000 });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("a real Plan-stage burst produces a valid cadence file (demoted on 429, untouched on success)", { timeout: 180_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip("E2E gate off");
		if (!shouldRunLLME2E()) return t.skip(SKIP_NO_LLM);
		assert.ok(client && home, "test setup missing");
		try {
			seedCadenceState(home.cwd, { tier: "A" });

			await client.request("prompt", { text: "/senai-plan a tiny CLI" });
			await client.waitForIdle();

			// Whether or not the provider returned 429s, the cadence file
			// must be valid v1 schema (the input hook must not corrupt it).
			const cadenceFile = getCadencePath(home.cwd);
			if (fs.existsSync(cadenceFile)) {
				const state = JSON.parse(fs.readFileSync(cadenceFile, "utf8"));
				assert.ok(["A", "B", "C", "D"].includes(state.tier), `tier must be valid: ${state.tier}`);
				assert.ok(Array.isArray(state.history), "history must be an array");
				if (state.tier !== "A") {
					// Demoted — the last history entry must be a rate-limit demotion.
					const last = state.history[state.history.length - 1];
					assert.strictEqual(last.reason, "demote:rate_limit", "demotion reason must be rate_limit");
				}
			}
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)})`);
			}
			throw err;
		}
	});
});
