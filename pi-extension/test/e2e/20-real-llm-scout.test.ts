import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, shouldRunLLME2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_NO_LLM = "Tier 2 E2E requires RUN_LLM_E2E=1 plus a provider API key";

// Tier 2: real scout spawn. Verifies that 4 subagents running in parallel
// against a real LLM each produce a non-trivial scout-angle_*.md report.
// Only meaningful when RUN_LLM_E2E=1 AND a provider key is set.
describe("e2e/20-real-llm-scout", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		if (!shouldRunLLME2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedSenaiConfig(home);
		client = new RpcClient({ env: home.env, cwd: home.cwd, timeoutMs: 120_000 });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("4 real scouts in parallel all produce non-trivial reports", { timeout: 180_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip("E2E gate off");
		if (!shouldRunLLME2E()) return t.skip(SKIP_NO_LLM);
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan add a hello world CLI" });
			await client.waitForIdle();
			const state = await client.getState();
			const runId = state.runId;
			assert.ok(runId, "runId should be set after /senai-plan");

			// Wait up to 120s for all 4 scouts to finish. The Plan stage
			// skill file requires all 4 scout files before continuing.
			const scoutDir = path.join(home.cwd, ".IDE_Plans/senai/runs", runId, "plan/scouts");
			const deadline = Date.now() + 120_000;
			while (Date.now() < deadline) {
				if (fs.existsSync(scoutDir)) {
					const files = fs.readdirSync(scoutDir).filter((f) => f.startsWith("scout-angle_"));
					if (files.length >= 4) break;
				}
				await new Promise((r) => setTimeout(r, 1000));
			}
			assert.ok(fs.existsSync(scoutDir), "scout directory should exist");
			const reports = fs.readdirSync(scoutDir).filter((f) => f.startsWith("scout-angle_") && f.endsWith(".md"));
			assert.strictEqual(reports.length, 4, "all 4 scout reports should be written");
			for (const r of reports) {
				const content = fs.readFileSync(path.join(scoutDir, r), "utf8");
				// Real LLM scouts don't write 50-byte stubs — they produce
				// substantive reports with section headers.
				assert.ok(content.length > 500, `${r} should be a non-trivial report (got ${content.length} bytes)`);
				assert.ok(/^#\s/m.test(content), `${r} should contain at least one markdown header`);
			}
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)})`);
			}
			throw err;
		}
	});
});
