import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, distModuleUrl, type TestHome } from "./helpers/test-home.js";
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
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { previewRegeneration, planAgentGeneration, GENERATED_ROLES } from '${distModuleUrl("agents/generator.js")}'; const cwd = process.cwd(); const plan = planAgentGeneration(cwd, GENERATED_ROLES, [], null); const preview = previewRegeneration(cwd, plan.map(p => p.agentName)); process.stdout.write(JSON.stringify({ planCount: plan.length, preview }))"`,
		});
		assert.ok(result.success, "sub-agent preview subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const { planCount, preview } = JSON.parse(output);
		assert.ok(planCount > 0, "planAgentGeneration should produce at least one agent plan");
		// On a fresh project no .pi/agents/*.md exists, so every planned agent
		// lands in `recreate` and the other three buckets stay empty.
		assert.strictEqual(preview.recreate.length, planCount, "every planned agent should be a recreate on a fresh project");
		assert.strictEqual(preview.overwrite.length, 0, "nothing to overwrite on a fresh project");
		assert.strictEqual(preview.keptDrifted.length, 0, "nothing drifted on a fresh project");
		assert.strictEqual(preview.unknown.length, 0, "no unknown agent files on a fresh project");
	});

	it("agent-generator preview does not write any files (it is preview-only)", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { previewRegeneration, planAgentGeneration, GENERATED_ROLES } from '${distModuleUrl("agents/generator.js")}'; const cwd = process.cwd(); const plan = planAgentGeneration(cwd, GENERATED_ROLES, [], null); previewRegeneration(cwd, plan.map(p => p.agentName)); process.stdout.write('ok')"`,
		});
		assert.ok(result.success, "preview subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		assert.ok(output === "ok", `preview must not write (got: ${output})`);
		// No .pi/agents/<name>.md should exist yet — preview is read-only.
		const agentsDir = path.join(home.cwd, ".pi", "agents");
		const written = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md")) : [];
		assert.strictEqual(written.length, 0, `preview must not write agent files (found: ${written.join(", ")})`);
	});
});
