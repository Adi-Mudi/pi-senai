import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, distModuleUrl, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Tests the Phase-4 hard enforcement gates: the stage-order machine gate
// (out-of-order stage command rejected naming the exact command to run
// first) and the spawn-guard web tool lock (hard block at spawn time).
// Drives pure functions via a Node subprocess over the bash RPC channel —
// no slash commands, no LLM needed.
describe("e2e/33-hard-enforcement", () => {
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

	it("ensureStage rejects an out-of-order stage command naming the exact command to run first", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { ensureStage } from '${distModuleUrl("commands/_helpers.js")}'; const state = { currentStage: 'planning' }; const r = ensureStage('/tmp', state, 'implemented', '/senai-document'); process.stdout.write(JSON.stringify(r))"`,
		});
		assert.ok(result.success, "ensureStage subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const gate = JSON.parse(output);
		assert.strictEqual(gate.ok, false, "out-of-order must be rejected");
		assert.ok(gate.reason.includes("Out of order"), `reason must say Out of order; got: ${gate.reason}`);
		assert.ok(gate.reason.includes("can only run from stage 'implemented'"), `reason names the required stage; got: ${gate.reason}`);
		assert.ok(gate.reason.includes("Run /senai-approve first"), `reason names the exact command to run first; got: ${gate.reason}`);
	});

	it("ensureStage passes when the current stage matches the command's required stage", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { ensureStage } from '${distModuleUrl("commands/_helpers.js")}'; const state = { currentStage: 'implemented' }; const r = ensureStage('/tmp', state, 'implemented', '/senai-document'); process.stdout.write(JSON.stringify({ ok: r.ok }))"`,
		});
		assert.ok(result.success, "ensureStage subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		assert.strictEqual(JSON.parse(output).ok, true, "in-order invocation must pass");
	});

	it("guardSpawnCall hard-blocks a custom-mapped reviewer agent carrying WebSearch", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		// Fixture: active run + reviewer-tests custom-mapped to an agent whose
		// frontmatter carries WebSearch. All written into a temp project dir.
		const script = [
			`import * as fs from 'node:fs';`,
			`import * as os from 'node:os';`,
			`import * as path from 'node:path';`,
			`import { guardSpawnCall } from '${distModuleUrl("hooks/spawn-guard.js")}';`,
			`import { defaultState, saveState } from '${distModuleUrl("core/state.js")}';`,
			`import { saveAgentConfig } from '${distModuleUrl("core/agents-config/config.js")}';`,
			`const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e33-'));`,
			`saveState(cwd, { ...defaultState(), currentStage: 'planning', runId: 'r1' });`,
			`saveAgentConfig(cwd, { version: 1, agents: { 'reviewer-tests': 'proj-reviewer-tests' } });`,
			`fs.mkdirSync(path.join(cwd, '.pi', 'agents'), { recursive: true });`,
			`fs.writeFileSync(path.join(cwd, '.pi', 'agents', 'proj-reviewer-tests.md'), ['---','name: proj-reviewer-tests','description: t','tools: read, write, WebSearch','---','','# t'].join('\\\\n'));`,
			`const block = guardSpawnCall('subagent', { agent: 'proj-reviewer-tests' }, cwd);`,
			`fs.rmSync(cwd, { recursive: true, force: true });`,
			`process.stdout.write(JSON.stringify(block ?? null));`,
		].join(" ");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "${script}"`,
		});
		assert.ok(result.success, "guardSpawnCall subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const block = JSON.parse(output);
		assert.ok(block?.block, "spawn must be hard-blocked");
		assert.ok(block.reason.includes('"reviewer-tests"'), `reason names the role; got: ${block.reason}`);
		assert.ok(block.reason.includes("WebSearch"), `reason names the offending tool; got: ${block.reason}`);
	});

	it("guardSpawnCall allows the discussion role to carry web tools", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const script = [
			`import * as fs from 'node:fs';`,
			`import * as os from 'node:os';`,
			`import * as path from 'node:path';`,
			`import { guardSpawnCall } from '${distModuleUrl("hooks/spawn-guard.js")}';`,
			`import { defaultState, saveState } from '${distModuleUrl("core/state.js")}';`,
			`import { saveAgentConfig } from '${distModuleUrl("core/agents-config/config.js")}';`,
			`const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e33-'));`,
			`saveState(cwd, { ...defaultState(), currentStage: 'planning', runId: 'r1' });`,
			`saveAgentConfig(cwd, { version: 1, agents: { discussion: 'proj-discussion' } });`,
			`fs.mkdirSync(path.join(cwd, '.pi', 'agents'), { recursive: true });`,
			`fs.writeFileSync(path.join(cwd, '.pi', 'agents', 'proj-discussion.md'), ['---','name: proj-discussion','description: t','tools: read, write, WebSearch, FetchURL','---','','# t'].join('\\\\n'));`,
			`const block = guardSpawnCall('subagent', { agent: 'proj-discussion' }, cwd);`,
			`fs.rmSync(cwd, { recursive: true, force: true });`,
			`process.stdout.write(JSON.stringify({ allowed: block === undefined }));`,
		].join(" ");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "${script}"`,
		});
		assert.ok(result.success, "guardSpawnCall subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		assert.strictEqual(JSON.parse(output).allowed, true, "discussion role may carry web tools");
	});
});
