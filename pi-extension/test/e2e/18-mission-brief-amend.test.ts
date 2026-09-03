import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";
import { amendBullet, validateBriefSections } from "../../src/mission-brief.js";
import { getPreRunMissionBriefPath } from "../../src/constants.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Mission-brief amendment: a re-discussion that contradicts an earlier
// bullet must produce a strike-through cross-out of the old text AND
// the new text in the same section. The parser is unit-tested; this E2E
// proves `amendBullet` (the in-process helper the slash command calls)
// preserves the structure across an amendment.
describe("e2e/18-mission-brief-amend", () => {
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

	it("amendBullet strike-through preserves the old bullet and appends the new one", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			// First discussion + finalize — writes the initial brief.
			await client.request("prompt", { text: "/senai-discussion pick React for the frontend" });
			await client.waitForIdle();
			await client.request("prompt", { text: "/senai-discussion-approve" });
			await client.waitForIdle();

			const briefPath = getPreRunMissionBriefPath(home.cwd);
			assert.ok(fs.existsSync(briefPath), "brief should exist after first approve");
			const firstContent = fs.readFileSync(briefPath, "utf8");
			assert.ok(validateBriefSections(firstContent), "first brief must have valid sections");

			// Simulate a re-discussion amendment using amendBullet (the
			// helper the slash command invokes). The strike-through marker
			// must wrap the old bullet, and the new bullet must coexist.
			const amended = amendBullet(firstContent, "pick React for the frontend", "switch to Svelte");
			assert.ok(/~~.*React.*~~/s.test(amended), "old bullet must be wrapped in strike-through markers");
			assert.ok(amended.includes("Svelte"), "new bullet must be present");
			// Sections must still validate after the amendment.
			assert.ok(validateBriefSections(amended), "amended brief must still have valid sections");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});
});
