import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, distModuleUrl, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig, seedCadenceState } from "./helpers/fixtures.js";
import { D_FLOOR_CLEAN } from "../../src/implement/cadence.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Runs the doctor against the project by shelling out to `node` over the
// `bash` RPC. This bypasses the prompt-bug on pi 0.84.3 because we never
// invoke a slash command — we import the doctor module directly into a
// Node subprocess and call runSenaiDiagnostic().
describe("e2e/12-doctor-cadence", () => {
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

	it("doctor renders the Spawn cadence section with tier A on a fresh project", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		// Drive the doctor via the bash RPC: invoke a Node subprocess
		// that imports the built doctor module and prints the report.
		// This works around the pi 0.84.3 prompt-handler bug.
		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { runSenaiDiagnostic } from '${distModuleUrl("doctor.js")}'; process.stdout.write(JSON.stringify(runSenaiDiagnostic(process.cwd())))"`,
		});
		assert.ok(result.success, "doctor subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const report = JSON.parse(output);
		const cadenceSection = (report.sections ?? []).find((s: any) => s.title === "Spawn cadence");
		assert.ok(cadenceSection, "Spawn cadence section should exist in doctor report");
		const tierItem = cadenceSection.items.find((i: any) => i.message.includes("A (parallel burst)"));
		assert.ok(tierItem, "should report tier A (parallel burst) on a fresh project");
	});

	it("doctor warns when tier D has been stuck long enough to escape", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		// Seed a tier-D state with 7 clean runs (the escape threshold).
		seedCadenceState(home.cwd, {
			tier: "D",
			consecutiveCleanRuns: D_FLOOR_CLEAN,
			last429At: "2026-09-01T00:00:00.000Z",
			lastPromotableAt: "2026-09-02T00:00:00.000Z",
		});

		const result = await client.request<any>("bash", {
			command: `node --input-type=module -e "import { runSenaiDiagnostic } from '${distModuleUrl("doctor.js")}'; process.stdout.write(JSON.stringify(runSenaiDiagnostic(process.cwd())))"`,
		});
		assert.ok(result.success, "doctor subprocess must succeed");
		const output = result.data?.output ?? result.output ?? "";
		const report = JSON.parse(output);
		const cadenceSection = (report.sections ?? []).find((s: any) => s.title === "Spawn cadence");
		assert.ok(cadenceSection, "Spawn cadence section should exist");
		const warnItem = cadenceSection.items.find(
			(i: any) => i.status === "warning" && i.message.includes("eligible to escape"),
		);
		assert.ok(warnItem, "should warn that tier D is eligible to escape to C");
	});
});
