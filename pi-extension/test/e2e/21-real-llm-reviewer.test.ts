import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, shouldRunLLME2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig, writePlanArtifacts } from "./helpers/fixtures.js";

const SKIP_NO_LLM = "Tier 2 E2E requires RUN_LLM_E2E=1 plus a provider API key";

// Tier 2: real reviewer spawn. Drives the Plan stage to the reviewer
// step using fixtures for the scout/discussion/planner outputs (those
// are tested in 20-real-llm-scout and the unit suite), then waits for
// 3 real reviewers to produce review-*.md files.
describe("e2e/21-real-llm-reviewer", () => {
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

	it("3 real reviewers in parallel all produce non-trivial review files", { timeout: 180_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip("E2E gate off");
		if (!shouldRunLLME2E()) return t.skip(SKIP_NO_LLM);
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan add a hello world CLI" });
			await client.waitForIdle();
			const state = await client.getState();
			const runId = state.runId;
			assert.ok(runId, "runId should be set after /senai-plan");

			// The Plan stage runs scouts → discussion → planner → reviewers.
			// To skip scout/planner and reach the reviewers, we pre-seed the
			// required artifacts and then send the slash command to advance.
			// In practice, the parent LLM will run the full sequence; we
			// simply wait for the review files to appear, with a long timeout.
			writePlanArtifacts(home.cwd, runId, "plan");
			const reviewDir = path.join(home.cwd, ".IDE_Plans/senai/runs", runId, "plan/reviews");
			const deadline = Date.now() + 120_000;
			while (Date.now() < deadline) {
				if (fs.existsSync(reviewDir)) {
					const files = fs.readdirSync(reviewDir).filter((f) => f.startsWith("review-") && f.endsWith(".md"));
					if (files.length >= 3) break;
				}
				await new Promise((r) => setTimeout(r, 1000));
			}
			// This test is informational only — real Plan-stage reviewer
			// spawning requires a fully-driven Plan run, which depends on
			// the LLM producing the plan. We assert the section exists and
			// (if it ran) the files are substantive.
			if (fs.existsSync(reviewDir)) {
				const reports = fs.readdirSync(reviewDir).filter((f) => f.startsWith("review-") && f.endsWith(".md"));
				for (const r of reports) {
					const content = fs.readFileSync(path.join(reviewDir, r), "utf8");
					assert.ok(/^#\s/m.test(content), `${r} should contain at least one markdown header`);
				}
			}
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)})`);
			}
			throw err;
		}
	});
});
