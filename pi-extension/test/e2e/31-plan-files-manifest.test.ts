import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, hasRealLlmKey, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

const VALID_MANIFEST =
	"## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/index.js | src | edit | implement mission |\n";

// Phase 2: /senai-approve at `planning` HARD BLOCKS when the plan's mandatory
// `## Files` manifest is missing or invalid — same hard gate as the
// `## Verification` check (e2e/28), no confirm dialog can bypass it.
describe("e2e/31-plan-files-manifest", () => {
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

	function writePlan(cwd: string, runId: string, planBody: string): void {
		const planDir = path.join(cwd, ".IDE_Plans/pi-senai/runs", runId, "plan");
		fs.mkdirSync(path.join(planDir, "scouts"), { recursive: true });
		fs.mkdirSync(path.join(planDir, "reviews"), { recursive: true });
		fs.writeFileSync(path.join(planDir, "plan.md"), planBody);
		fs.writeFileSync(path.join(planDir, "plan-overview.md"), "# Overview\n");
		fs.writeFileSync(path.join(planDir, "discussion-notes.md"), "# Discussion\n");
		for (let i = 1; i <= 4; i++) {
			fs.writeFileSync(path.join(planDir, "scouts", `scout-angle_${i}.md`), `# Scout ${i}\n`);
		}
		fs.writeFileSync(path.join(planDir, "reviews", "review-correctness.md"), "# Correctness\n");
		fs.writeFileSync(path.join(planDir, "reviews", "review-security.md"), "# Security\n");
		fs.writeFileSync(path.join(planDir, "reviews", "review-tests.md"), "# Tests\n");
	}

	it("blocks when the plan has no ## Files section, advances once a valid manifest is added", { timeout: 120_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan manifest gate test mission" });
			await client.waitForIdle();
			const initial = await client.getState();
			assert.strictEqual(initial.currentStage, "planning");
			const runId = initial.runId;
			assert.ok(runId, "runId missing after /senai-plan");

			// 1. Executable verification but no ## Files → hard block.
			writePlan(home.cwd, runId, "# Plan\n\n## Verification\n\n- echo ok\n");
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			const blocked = await client.getState();
			assert.strictEqual(blocked.currentStage, "planning", "plan without ## Files must NOT advance");
			assert.strictEqual(blocked.runId, runId, "blocked approve must not mutate the run");

			// 2. Add a valid manifest → approve advances.
			writePlan(home.cwd, runId, `# Plan\n\n${VALID_MANIFEST}\n## Verification\n\n- echo ok\n`);
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			const advanced = await client.getState();
			assert.strictEqual(advanced.currentStage, "implementing", "plan with a valid ## Files manifest must advance");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});

	it("blocks when the ## Files manifest has invalid rows", { timeout: 120_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		if (!hasRealLlmKey()) return t.skip("this test needs a real LLM API key (no dummy/local key found)");
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan manifest gate test mission" });
			await client.waitForIdle();
			const initial = await client.getState();
			assert.strictEqual(initial.currentStage, "planning");
			writePlan(
				home.cwd,
				initial.runId,
				"# Plan\n\n## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| ../escape.js | src | create | bad path |\n\n## Verification\n\n- echo ok\n",
			);
			await client.request("prompt", { text: "/senai-approve" });
			await client.waitForIdle();
			const blocked = await client.getState();
			assert.strictEqual(blocked.currentStage, "planning", "plan with an invalid ## Files manifest must NOT advance");
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});
});
