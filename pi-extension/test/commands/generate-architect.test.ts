import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { maybeAutoCreatePiExtensionInputs } from "../../src/commands/generate-architect.js";
import { loadArchitectInputsConfig } from "../../src/architect/inputs-config.js";

describe("maybeAutoCreatePiExtensionInputs", () => {
	let tmpDir: string;
	before(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "senai-genarch-"));
		// Make a minimal Pi extension project: package.json with pi-package
		// keyword + pi: manifest + peer deps with "*" range. This is enough
		// to satisfy detectPiExtension's pattern checks.
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify(
				{
					name: "test-pi-ext",
					version: "0.0.1",
					keywords: ["pi-package"],
					pi: { extensions: ["./dist/index.js"] },
					peerDependencies: { "@mariozechner/pi-coding-agent": "*" },
				},
				null,
				2,
			),
		);
	});
	after(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("auto-creates architect-inputs.json for a Pi extension project when missing", () => {
		const inputsPath = path.join(tmpDir, ".pi", "senai", "architect-inputs.json");
		assert.strictEqual(fs.existsSync(inputsPath), false, "precondition: no inputs file");

		const result = maybeAutoCreatePiExtensionInputs(tmpDir);
		assert.ok(result, "helper should return the created config");
		assert.ok(Array.isArray(result!.documents));
		assert.strictEqual(result!.documents.length, 0);
		assert.ok(Array.isArray(result!.additionalConstraints));

		assert.strictEqual(fs.existsSync(inputsPath), true, "inputs file must be written");
		const loaded = loadArchitectInputsConfig(tmpDir);
		assert.ok(loaded, "file must be loadable");
		assert.ok(Array.isArray(loaded!.documents));
	});

	it("is a no-op when architect-inputs.json already exists", () => {
		// The first test already created the file. Call again and verify the
		// helper does not overwrite it.
		const before = loadArchitectInputsConfig(tmpDir);
		const result = maybeAutoCreatePiExtensionInputs(tmpDir);
		assert.strictEqual(result, null, "helper must return null when file exists");
		const after = loadArchitectInputsConfig(tmpDir);
		assert.deepStrictEqual(after, before, "file content must be unchanged");
	});

	it("returns null for a non-Pi project (empty directory)", () => {
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "senai-empty-"));
		try {
			const result = maybeAutoCreatePiExtensionInputs(emptyDir);
			assert.strictEqual(result, null, "helper must return null for non-Pi projects");
			// Also verify no inputs file was created
			const inputsPath = path.join(emptyDir, ".pi", "senai", "architect-inputs.json");
			assert.strictEqual(fs.existsSync(inputsPath), false);
		} finally {
			fs.rmSync(emptyDir, { recursive: true, force: true });
		}
	});
});
