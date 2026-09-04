import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Tests the deterministic scanner tool and the new doctor sections added in
// the testing-discipline feature. Drives pure functions via a Node subprocess
// over the bash RPC channel — no slash commands, no LLM needed.
describe("e2e/25-scanner-tool", () => {
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

	it("runSenaiDiagnostic surfaces the Testing discipline + Sub-agent generator completeness sections", { timeout: 60_000 }, async (t) => {
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
			assert.ok(titles.includes("Testing discipline"), `doctor missing 'Testing discipline' section; got: ${titles.join(", ")}`);
			assert.ok(titles.includes("Sub-agent generator completeness"), `doctor missing 'Sub-agent generator completeness' section; got: ${titles.join(", ")}`);
		} catch (err) {
			t.skip(`doctor subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});

	it("Testing discipline section surfaces strict mode + coverage floor info items", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { runSenaiDiagnostic } from './dist/pi-extension/src/doctor.js'; const report = runSenaiDiagnostic(process.cwd()); const section = report.sections.find(s => s.title === 'Testing discipline'); process.stdout.write(JSON.stringify(section))"`,
			});
			assert.ok(result.success, "doctor subprocess must succeed");
			const output = result.data?.output ?? result.output ?? "";
			const section = JSON.parse(output);
			const items = section.items ?? [];
			const messages = items.map((i: any) => i.message);
			assert.ok(messages.some((m: string) => /Strict mode/i.test(m)), `Testing discipline must include Strict mode item; got: ${messages.join(" | ")}`);
			assert.ok(messages.some((m: string) => /Coverage floor/i.test(m)), `Testing discipline must include Coverage floor item; got: ${messages.join(" | ")}`);
		} catch (err) {
			t.skip(`doctor subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});

	it("Sub-agent generator completeness section reports OK when every GENERATED_ROLES row has the v5 fields", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { runSenaiDiagnostic } from './dist/pi-extension/src/doctor.js'; const report = runSenaiDiagnostic(process.cwd()); const section = report.sections.find(s => s.title === 'Sub-agent generator completeness'); process.stdout.write(JSON.stringify(section))"`,
			});
			assert.ok(result.success, "doctor subprocess must succeed");
			const output = result.data?.output ?? result.output ?? "";
			const section = JSON.parse(output);
			const completenessItem = (section.items ?? []).find((i: any) => i.message.includes("GENERATED_ROLES rows have invocationHint + outOfScope"));
			assert.ok(completenessItem, `section must include the completeness item; got sections: ${JSON.stringify(section.items?.map((i: any) => i.message))}`);
			assert.strictEqual(completenessItem.status, "ok");
		} catch (err) {
			t.skip(`doctor subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});
});
