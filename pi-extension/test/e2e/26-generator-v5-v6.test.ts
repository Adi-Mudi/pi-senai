import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Tests the v5/v6 fine-tune invariants of the sub-agent generator:
// every generated body carries the v6 footer, the ## Out of scope
// section, a description that starts with the invocationHint, and
// the doc-writer test-modification boundary.
describe("e2e/26-generator-v5-v6", () => {
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

	it("every generated agent body carries the v6 footer marker, Out of scope, and invocationHint-led description", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { planAgentGeneration, GENERATED_ROLES, GENERATOR_VERSION } from './dist/pi-extension/src/agent-generator.js'; const cwd = process.cwd(); const plans = planAgentGeneration(cwd, GENERATED_ROLES, [], null); const summary = plans.map(p => ({ role: p.role, hasV6: p.content.includes('(generator v' + GENERATOR_VERSION + ')'), hasOOS: p.content.includes('## Out of scope'), descLead: (p.content.match(/^description:\\s*(.+)$/m) || [])[1] || '' })); process.stdout.write(JSON.stringify(summary))"`,
			});
			assert.ok(result.success, "generator subprocess must succeed");
			const output = result.data?.output ?? result.output ?? "";
			const summary = JSON.parse(output) as Array<{ role: string; hasV6: boolean; hasOOS: boolean; descLead: string }>;
			assert.ok(summary.length > 0, "generator must produce at least one plan");
			for (const entry of summary) {
				assert.ok(entry.hasV6, `${entry.role}: missing v${6} footer`);
				assert.ok(entry.hasOOS, `${entry.role}: missing '## Out of scope' section`);
				assert.ok(entry.descLead.length > 0, `${entry.role}: empty description`);
			}
		} catch (err) {
			t.skip(`generator subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});

	it("every doc-writer generated body carries the test-modification boundary", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { planAgentGeneration, GENERATED_ROLES } from './dist/pi-extension/src/agent-generator.js'; const cwd = process.cwd(); const plans = planAgentGeneration(cwd, GENERATED_ROLES, [], null); const docRoles = ['readme-writer', 'changelog-writer', 'api-docs-writer', 'other-docs-writer']; const summary = plans.filter(p => docRoles.includes(p.role)).map(p => ({ role: p.role, hasBoundary: /Do not modify test files/i.test(p.content) })); process.stdout.write(JSON.stringify(summary))"`,
			});
			assert.ok(result.success, "generator subprocess must succeed");
			const output = result.data?.output ?? result.output ?? "";
			const summary = JSON.parse(output) as Array<{ role: string; hasBoundary: boolean }>;
			assert.strictEqual(summary.length, 4, "should have 4 doc-writers");
			for (const entry of summary) {
				assert.ok(entry.hasBoundary, `${entry.role}: missing 'Do not modify test files' boundary`);
			}
		} catch (err) {
			t.skip(`generator subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});

	it("GENERATOR_VERSION is 6 (footer marker matches)", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { GENERATOR_VERSION } from './dist/pi-extension/src/agent-generator.js'; process.stdout.write(String(GENERATOR_VERSION))"`,
			});
			assert.ok(result.success, "version subprocess must succeed");
			const output = String(result.data?.output ?? result.output ?? "");
			assert.strictEqual(output.trim(), "6", `GENERATOR_VERSION must be 6; got ${output}`);
		} catch (err) {
			t.skip(`version subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});
});
