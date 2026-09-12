import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, distModuleUrl, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Fix B (generator v9): baseline verification steps derived from the
// project's own package.json always run before the plan's ## Verification
// steps, deduplicated. Drives the collector via a Node subprocess over the
// bash RPC channel — no slash commands, no LLM needed.
describe("e2e/29-baseline-verification", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({
			files: [
				...makeMinimalProjectFiles(),
				{
					path: "package.json",
					content: JSON.stringify({
						name: "pi-senai-e2e-fixture",
						version: "0.0.0",
						type: "module",
						private: true,
						scripts: { build: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" },
					}, null, 2) + "\n",
				},
			],
		});
		seedSenaiConfig(home);
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("deriveBaselineVerificationSteps maps build/test scripts to npm commands", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { deriveBaselineVerificationSteps } from '${distModuleUrl("implement/signals.js")}'; process.stdout.write(JSON.stringify(deriveBaselineVerificationSteps(process.cwd())))"`,
		});
		assert.ok(result.success, "subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const steps = JSON.parse(output);
		assert.deepStrictEqual(steps, ["npm run build", "npm test"], `baseline steps wrong; got ${JSON.stringify(steps)}`);
	});

	it("collectImplementSignals runs baseline steps first and dedups plan steps", { timeout: 120_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const fs = await import("node:fs");
		const path = await import("node:path");
		// A run with a plan that repeats one baseline step and adds a manual one.
		const runId = "2099-01-01-00-00-e2e";
		const planDir = path.join(home.cwd, ".IDE_Plans/pi-senai/runs", runId, "plan");
		fs.mkdirSync(planDir, { recursive: true });
		fs.writeFileSync(path.join(planDir, "plan.md"), "# Plan\n\n## Verification\n\n1. npm test\n2. eyeball the output\n");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { collectImplementSignals } from '${distModuleUrl("implement/signals.js")}'; import { defaultState } from '${distModuleUrl("core/state.js")}'; const state = { ...defaultState(), runId: '${runId}', currentStage: 'implementing' }; const s = await collectImplementSignals(process.cwd(), state); process.stdout.write(JSON.stringify(s.verificationSteps.map(v => ({ step: v.step, passed: v.passed }))))"`,
		});
		assert.ok(result.success, "subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const steps = JSON.parse(output);
		assert.deepStrictEqual(
			steps.map((s: { step: string }) => s.step),
			["npm run build", "npm test", "eyeball the output"],
			`expected baseline-first order with dedup; got ${JSON.stringify(steps)}`,
		);
		assert.strictEqual(steps[0].passed, true, "baseline build must pass in the fixture");
		assert.strictEqual(steps[1].passed, true, "baseline test must pass in the fixture");
		assert.strictEqual(steps[2].passed, null, "prose step must classify as manual (not run)");
	});

	it("a failing baseline step blocks the advance", { timeout: 120_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const fs = await import("node:fs");
		const path = await import("node:path");
		// Break the build script, then re-collect: the failure must block.
		const pkgPath = path.join(home.cwd, "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
		pkg.scripts.build = "node -e \"process.exit(1)\"";
		fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
		const runId = "2099-01-01-00-01-e2e";
		const planDir = path.join(home.cwd, ".IDE_Plans/pi-senai/runs", runId, "plan");
		fs.mkdirSync(planDir, { recursive: true });
		fs.writeFileSync(path.join(planDir, "plan.md"), "# Plan\n\n## Verification\n\n1. echo ok\n");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { collectImplementSignals, signalsBlockAdvance } from '${distModuleUrl("implement/signals.js")}'; import { defaultState } from '${distModuleUrl("core/state.js")}'; const state = { ...defaultState(), runId: '${runId}', currentStage: 'implementing' }; const s = await collectImplementSignals(process.cwd(), state); const block = signalsBlockAdvance(s); process.stdout.write(JSON.stringify(block))"`,
		});
		assert.ok(result.success, "subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const block = JSON.parse(output);
		assert.strictEqual(block.blocked, true, "failing baseline build must block");
		assert.ok(
			block.reasons.some((r: string) => r.includes("npm run build")),
			`block reason must name the baseline step; got ${JSON.stringify(block.reasons)}`,
		);
	});
});
