import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

describe("e2e/05-compaction", () => {
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

	it("session_before_compact summary mentions run id, stage, and artifact paths", { timeout: 120_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan compaction test" });
			await client.waitForIdle();
			const state = await client.getState();
			assert.ok(state.runId, "runId missing");

			// First try: ask Pi to compact explicitly. If the RPC supports it,
			// the input hook fires session_before_compact and our summary lands
			// in the message stream. If Pi does not expose `compact`, we fall
			// back to the long-context trigger.
			let compacted = false;
			try {
				await client.request("compact", {});
				await client.waitForIdle();
				compacted = true;
			} catch {
				compacted = false;
			}

			if (!compacted) {
				// Fallback: push a long context so pi's auto-compact fires the
				// session_before_compact hook with our deterministic summary.
				const filler = "Repeat the word 'lorem' until told to stop. ".repeat(50);
				await client.request("prompt", { text: filler });
				await client.waitForIdle();
			}

			const { messages } = await client.getMessages();
			const hit = messages.find((m: any) => {
				const body = typeof m?.content === "string"
					? m.content
					: Array.isArray(m?.content)
						? m.content.map((c: any) => c?.text ?? "").join("\n")
						: "";
				return body.includes("Pi Senai run state") && body.includes("Artifact paths");
			});
			assert.ok(hit, "no deterministic compaction summary found in message stream");
			const body = typeof hit.content === "string"
				? hit.content
				: hit.content.map((c: any) => c.text ?? "").join("\n");
			assert.ok(body.includes(state.runId), "summary missing runId");
			assert.ok(body.includes("planning"), "summary missing current stage");
			assert.ok(body.includes("plan/plan.md"), "summary missing artifact path");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)})`);
			}
			throw err;
		}
	});
});
