import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// `/senai-discussion-approve` is documented as idempotent: a second call
// on an already-finalized brief must not bump the discussions counter or
// append a duplicate transcript. The unit test in mission-brief.test.ts
// proves the in-process function; this E2E proves the slash command
// handler honors it against a real pi binary.
describe("e2e/14-discussion-idempotent", () => {
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

	it("a second /senai-discussion-approve on the same brief is a no-op (skips on pi 0.84.3 prompt bug)", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			// Pre-run brief path (no active run).
			const briefPath = path.join(home.cwd, ".IDE_Plans/pi-senai/discussions/pre-run/mission-brief.md");
			const transcriptDir = path.join(home.cwd, ".IDE_Plans/pi-senai/discussions/pre-run");

			// First discussion + approve.
			await client.request("prompt", { text: "/senai-discussion pick the best stack" });
			await client.waitForIdle();
			await client.request("prompt", { text: "/senai-discussion-approve" });
			await client.waitForIdle();

			assert.ok(fs.existsSync(briefPath), "brief should be created after first approve");
			const briefBefore = fs.readFileSync(briefPath, "utf8");
			const transcriptsBefore = fs.readdirSync(transcriptDir).filter((f) => f.startsWith("discussion-"));
			assert.strictEqual(transcriptsBefore.length, 1, "exactly one transcript after first approve");

			// Second approve with no intervening change — should be a no-op.
			await client.request("prompt", { text: "/senai-discussion-approve" });
			await client.waitForIdle();

			const briefAfter = fs.readFileSync(briefPath, "utf8");
			const transcriptsAfter = fs.readdirSync(transcriptDir).filter((f) => f.startsWith("discussion-"));
			assert.strictEqual(transcriptsAfter.length, 1, "second approve must not create a duplicate transcript");
			assert.strictEqual(briefAfter, briefBefore, "brief content must be byte-identical");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});
});
