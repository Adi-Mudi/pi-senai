import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, distModuleUrl, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Drives `runSenaiDiagnostic` directly via a Node subprocess over the
// `bash` RPC channel. Bypasses the pi 0.84.3 prompt bug (we never invoke
// a slash command) and verifies the doctor report's structural shape on
// a fully-seeded valid project — the smoke test for the whole setup.
describe("e2e/15-doctor-full-run", () => {
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

	it("doctor report on a freshly-seeded project has the expected section titles", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { runSenaiDiagnostic } from '${distModuleUrl("doctor/index.js")}'; process.stdout.write(JSON.stringify(runSenaiDiagnostic(process.cwd())))"`,
		});
		assert.ok(result.success, "doctor subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const report = JSON.parse(output);
		const titles = (report.sections ?? []).map((s: any) => s.title);

		// Every canonical section the doctor emits on a fresh project.
		const expected = [
			"Setup progress",
			"Lock state",
			"Spawn cadence",
			"Configuration files",
			"Discussions",
			"Agent mapping sources",
			"Agent-role capability fit",
			"Run artifacts",
			"Project file scope",
			"Agent document assignments",
			"Runtime environment",
			"Subagent extension",
			"Stray files",
			"Documentation factory",
		];
		for (const want of expected) {
			assert.ok(titles.includes(want), `doctor missing section: ${want}`);
		}
	});
});
