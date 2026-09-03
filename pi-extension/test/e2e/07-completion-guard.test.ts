import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

describe("e2e/07-completion-guard", () => {
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

	it("a 'completed' steer message appends the resume warning when the artifact is missing", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan completion guard test" });
			await client.waitForIdle();
			const state = await client.getState();
			const runId = state.runId;
			assert.ok(runId);

			// Plant a partial artifacts dir: scouts + reviews, but NO plan.md.
			// The completion notice for `subagent("scout-1")` must trigger the
			// guard because the artifact path listed in the spawn task is missing.
			const runDir = path.join(home.cwd, ".IDE_Plans/senai/runs", runId);
			fs.mkdirSync(path.join(runDir, "plan/scouts"), { recursive: true });
			fs.mkdirSync(path.join(runDir, "plan/reviews"), { recursive: true });
			fs.writeFileSync(path.join(runDir, "plan/scouts/scout-angle_1.md"), "# Scout 1\n");
			fs.writeFileSync(path.join(runDir, "plan/scouts/scout-angle_2.md"), "# Scout 2\n");
			fs.writeFileSync(path.join(runDir, "plan/scouts/scout-angle_3.md"), "# Scout 3\n");
			fs.writeFileSync(path.join(runDir, "plan/scouts/scout-angle_4.md"), "# Scout 4\n");

			// Drive the guard via a steer message that matches completion-guard's regex.
			await client.steer('Sub-agent "scout-1" completed (5s).');
			await client.waitForIdle();

			const { messages } = await client.getMessages();
			const hit = messages.find((m: any) => {
				const body = typeof m?.content === "string"
					? m.content
					: Array.isArray(m?.content)
						? m.content.map((c: any) => c?.text ?? "").join("\n")
						: "";
				return body.includes("[pi-senai artifact guard]");
			});
			assert.ok(hit, "completion guard did not append a resume warning");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt/steer handler is broken on this version (${(err as Error).message.slice(0, 80)})`);
			}
			throw err;
		}
	});
});
