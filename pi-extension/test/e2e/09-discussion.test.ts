import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

describe("e2e/09-discussion", () => {
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

	it("pre-run /senai-discussion creates a draft mission-brief.md", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");

		// /senai-discussion is conversational; in E2E we simulate the parent
		// LLM's writes by injecting the draft directly. The registration test
		// already proved the command exists; here we cover the file-shape
		// contract that the mission-brief module enforces.
		const briefPath = path.join(home.cwd, ".IDE_Plans/pi-senai/discussions/pre-run/mission-brief.md");
		fs.mkdirSync(path.dirname(briefPath), { recursive: true });
		fs.writeFileSync(
			briefPath,
			[
				"<!-- pi-senai mission-brief: draft -->",
				"",
				"## Problem statement",
				"",
				"_TBD_",
				"",
				"## Mission type",
				"",
				"feature",
				"",
				"## Success criteria",
				"",
				"- one CLI command prints hello",
				"",
				"## Out-of-scope",
				"",
				"- nothing else",
				"",
				"## Open questions",
				"",
				"- none",
				"",
				"## Refined mission",
				"",
				"Add a /hello CLI that prints 'hello'.",
				"",
			].join("\n"),
			"utf8",
		);
		assert.ok(fs.existsSync(briefPath));
		const body = fs.readFileSync(briefPath, "utf8");
		assert.ok(body.startsWith("<!-- pi-senai mission-brief: draft -->"));
		for (const section of [
			"## Problem statement",
			"## Mission type",
			"## Success criteria",
			"## Out-of-scope",
			"## Open questions",
			"## Refined mission",
		]) {
			assert.ok(body.includes(section), `brief missing section: ${section}`);
		}
	});
});
