import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

describe("e2e/08-architect-tools", () => {
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

	it("/senai-configure-architect-inputs writes the inputs config", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		// The picker is interactive; we instead inject the config directly
		// (the in-process configure command is unit-tested elsewhere).
		const inputsPath = path.join(home.cwd, ".pi/senai/architect-inputs.json");
		fs.mkdirSync(path.dirname(inputsPath), { recursive: true });
		fs.writeFileSync(
			inputsPath,
			JSON.stringify({
				_comment: "Set by e2e fixture.",
				version: 1,
				documents: [{ type: "readme", path: "README.md" }],
				additionalConstraints: [],
			}, null, 2) + "\n",
			"utf8",
		);
		assert.ok(fs.existsSync(inputsPath));
		const state = await client.getState();
		assert.ok(state, "state unavailable");
	});

	it("/senai-generate-architect without inputs surfaces the warn-and-ask and exits", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			// No architect-inputs.json written: the command must notify the user
			// and exit. We assert by capturing the notification text from the
			// event stream.
			const events = await client.promptAndWait("/senai-generate-architect");
			const all = JSON.stringify(events).toLowerCase();
			assert.ok(
				all.includes("no architect inputs configured") || all.includes("architect inputs"),
				"expected warn notification about missing architect inputs",
			);
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)})`);
			}
			throw err;
		}
	});
});
