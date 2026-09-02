import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Verified against commands.ts (lines 126, 189, 220, 251, 282, 326, 437,
// 463, 493, 796, 825, 927, 955, 1245, 1274, 1500, 1514, 1536, 1743, 2066).
const EXPECTED_COMMANDS = [
	"senai-plan",
	"senai-implement",
	"senai-document",
	"senai-deliver",
	"senai-status",
	"senai-approve",
	"senai-reset",
	"senai-discussion",
	"senai-discussion-approve",
	"senai-agents",
	"senai-configure-agents",
	"senai-files",
	"senai-configure-files",
	"senai-agents-files",
	"senai-configure-agents-files",
	"senai-doctor",
	"senai-generate-docs-structure",
	"senai-configure-architect-inputs",
	"senai-generate-architect",
	"senai-generate-sub-agents",
];

describe("e2e/01-registration", () => {
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

	it("get_commands returns every slash command registered by pi-senai", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.getCommands();
		const names = (result.commands ?? []).map((c: any) => String(c.name).replace(/^\//, ""));
		for (const expected of EXPECTED_COMMANDS) {
			assert.ok(names.includes(expected), `missing command: /${expected}`);
		}
	});
});
