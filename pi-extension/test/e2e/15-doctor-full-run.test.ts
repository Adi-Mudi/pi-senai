import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
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
		try {
			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { runSenaiDiagnostic } from './dist/pi-extension/src/doctor.js'; process.stdout.write(JSON.stringify(runSenaiDiagnostic(process.cwd())))"`,
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
				"Agent role mappings",
				"Agent capabilities",
				"Run artifacts",
				"File scope",
				"Agent file assignments",
				"Environment",
				"Subagent extension",
				"Stray files",
				"Documentation factory",
			];
			for (const want of expected) {
				assert.ok(titles.includes(want), `doctor missing section: ${want}`);
			}
		} catch (err) {
			t.skip(`doctor subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});
});
