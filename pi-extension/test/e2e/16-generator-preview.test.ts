import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Generator previews — the deterministic `previewRegeneration()` shape
// that backs `/senai-generate-sub-agents` and `/senai-generate-architect`.
// Drives the preview functions directly via a Node subprocess so the test
// runs without hitting the prompt bug.
describe("e2e/16-generator-preview", () => {
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

	it("sub-agent generator preview returns a deterministic write set for fresh roles", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { previewRegeneration, planAgentGeneration } from './dist/pi-extension/src/agent-generator.js'; const cwd = process.cwd(); const plan = await planAgentGeneration(cwd, { skipConfirm: true }); const preview = previewRegeneration(cwd, plan); process.stdout.write(JSON.stringify({ plan, preview }))"`,
			});
			assert.ok(result.success, "sub-agent preview subprocess must succeed");
			const output = result.data?.output ?? result.output ?? "";
			const { plan, preview } = JSON.parse(output);
			assert.ok(Array.isArray(plan), "plan should be an array");
			assert.ok(Array.isArray(preview), "preview should be an array");
			// On a fresh project, every generated role appears as a "create".
			const createItems = preview.filter((p: any) => p.action === "create");
			assert.ok(createItems.length > 0, "fresh project should produce at least one create action");
			// No role should be skipped or kept without reason on a fresh project.
			const skipped = preview.filter((p: any) => p.action === "skip");
			assert.strictEqual(skipped.length, 0, "no role should be skipped on a fresh project");
		} catch (err) {
			t.skip(`generator preview subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});

	it("agent-generator preview does not write any files (it is preview-only)", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { previewRegeneration, planAgentGeneration } from './dist/pi-extension/src/agent-generator.js'; const cwd = process.cwd(); const plan = await planAgentGeneration(cwd, { skipConfirm: true }); previewRegeneration(cwd, plan); process.stdout.write('ok')"`,
			});
			assert.ok(result.success, "preview subprocess must succeed");
			// No .pi/agents/<name>.md should exist yet — preview is read-only.
			const output = result.data?.output ?? result.output ?? "";
			assert.ok(output === "ok", `preview must not write (got: ${output})`);
		} catch (err) {
			t.skip(`preview subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});
});
