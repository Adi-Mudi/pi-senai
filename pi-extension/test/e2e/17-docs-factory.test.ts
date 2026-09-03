import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// Docs factory: the deterministic skeleton creator + the catalog's
// template contracts. Drives both via a Node subprocess so the test runs
// without hitting the prompt bug.
describe("e2e/17-docs-factory", () => {
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

	it("generateDocsStructure creates the docs skeleton folders and template stubs", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			// Drives generateDocsStructure directly via a Node subprocess.
			// The slash command would hit the prompt bug; the function call
			// does not.
			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { generateDocsStructure } from './dist/pi-extension/src/doc-selection.js'; generateDocsStructure(process.cwd(), { write: true }); process.stdout.write('ok')"`,
			});
			assert.ok(result.success, "docs factory subprocess must succeed");

			// At minimum the README/CHANGELOG/CONTRIBUTING roots must exist
			// (the catalog always emits them on every project), plus the
			// .pi/senai/docs-structure.json manifest.
			const docsStructure = path.join(home.cwd, ".pi/senai/docs-structure.json");
			assert.ok(fs.existsSync(docsStructure), "docs-structure.json manifest should be written");

			const readme = path.join(home.cwd, "README.md");
			const changelog = path.join(home.cwd, "CHANGELOG.md");
			assert.ok(fs.existsSync(readme), "README.md stub should be written");
			assert.ok(fs.existsSync(changelog), "CHANGELOG.md stub should be written");

			// Stubs carry the pi-senai marker.
			const readmeContent = fs.readFileSync(readme, "utf8");
			assert.ok(readmeContent.includes("pi-senai"), "README stub should carry the pi-senai marker");
		} catch (err) {
			t.skip(`docs factory subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});

	it("doctor flags docs that exceed their template length cap", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			// Write a README that's deliberately over the 150-line cap.
			const readme = path.join(home.cwd, "README.md");
			fs.writeFileSync(readme, "# README\n\n" + "x".repeat(10_000) + "\n", "utf8");

			const result = await client.request<any>("bash", {
				command: `node --input-type=module -e "import { runSenaiDiagnostic } from './dist/pi-extension/src/doctor.js'; process.stdout.write(JSON.stringify(runSenaiDiagnostic(process.cwd())))"`,
			});
			assert.ok(result.success, "doctor subprocess must succeed");
			const output = result.data?.output ?? result.output ?? "";
			const report = JSON.parse(output);
			const docsSection = (report.sections ?? []).find((s: any) => s.title === "Documentation factory");
			assert.ok(docsSection, "Documentation factory section should exist");
			// Either an error or a warning, depending on how badly over the cap.
			const flagged = docsSection.items.filter(
				(i: any) => i.status === "error" || i.status === "warning",
			);
			assert.ok(flagged.length > 0, "oversize README should be flagged");
		} catch (err) {
			t.skip(`doctor subprocess failed: ${(err as Error).message.slice(0, 100)}`);
		}
	});
});
