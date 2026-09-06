import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig, writePlanArtifacts } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

describe("e2e/06-spawn-guard", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedSenaiConfig(home);
		// Wire a project-local agent so a typed spawn has a target.
		const agentDir = path.join(home.cwd, ".pi/agents");
		fs.mkdirSync(agentDir, { recursive: true });
		fs.writeFileSync(
			path.join(agentDir, "scout-1.md"),
			[
				"---",
				"name: scout-1",
				"description: Architecture / big-picture scout for the e2e fixture.",
				"tools: [read]",
				"---",
				"",
				"# scout-1",
				"",
				"Reads the project root and returns a one-paragraph summary.",
			].join("\n"),
			"utf8",
		);
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("blocks an untyped subagent call and accepts one with agent: scout-1", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan spawn guard test" });
			await client.waitForIdle();
			const state = await client.getState();
			const runId = state.runId;
			assert.ok(runId);
			writePlanArtifacts(home.cwd, runId, "plan");

			// 1) Untyped spawn → guard must block. We send a prompt that asks the
			//    parent to call subagent without `agent:`; the response event
			//    stream should contain a tool-block notice.
			const blockedEvents = await client.promptAndWait(
				"Use the subagent tool now. Call it as `subagent({ task: 'look at /tmp' })` (no agent field).",
			);
			const blocked = blockedEvents.some((e) => {
				const json = JSON.stringify(e).toLowerCase();
				return json.includes("missing 'agent'") || json.includes("bare role/built-in name");
			});
			assert.ok(blocked, "expected spawn guard to block untyped subagent call");

			// 2) Typed spawn → guard passes. We don't actually have to succeed at
			//    the subagent — only that the guard does NOT block the call.
			const allowedEvents = await client.promptAndWait(
				"Use the subagent tool now with `agent: 'scout-1'`. Just make the call, you do not need a result.",
			);
			const blockedAgain = allowedEvents.some((e) => {
				const json = JSON.stringify(e).toLowerCase();
				return json.includes("bare role/built-in name") || json.includes("missing 'agent'");
			});
			assert.ok(!blockedAgain, "spawn guard incorrectly blocked typed call to scout-1");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)})`);
			}
			throw err;
		}
	});
});
