import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectPiExtension } from "../../src/architect/pi-extension-detector.js";
import { createEmptyDrivers } from "../../src/architect/drivers.js";
import type { ArchitectInputsConfig } from "../../src/architect/inputs-config.js";

function makeProject(dir: string, packageJson?: object): void {
	fs.mkdirSync(dir, { recursive: true });
	if (packageJson) {
		fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson, null, 2), "utf8");
	}
}

describe("detectPiExtension", () => {
	it("returns isPiExtension=false when no signals are present", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-det-neg-"));
		makeProject(tmpDir, { name: "generic-app", version: "1.0.0" });
		const result = detectPiExtension(tmpDir, createEmptyDrivers(), null);
		assert.strictEqual(result.isPiExtension, false);
		assert.strictEqual(result.confidence, 0);
		assert.deepStrictEqual(result.matchedPatterns, []);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects Pi extension via package.json peerDependencies", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-det-peer-"));
		makeProject(tmpDir, {
			name: "@scope/my-pi-extension",
			version: "1.0.0",
			keywords: ["pi-package"],
			peerDependencies: {
				"@mariozechner/pi-coding-agent": "*",
				"@sinclair/typebox": "*",
			},
			pi: { extensions: ["./dist/index.js"] },
		});
		const result = detectPiExtension(tmpDir, createEmptyDrivers(), null);
		assert.strictEqual(result.isPiExtension, true);
		assert.ok(result.confidence > 0.5);
		assert.ok(result.matchedPatterns.includes("@mariozechner/pi-coding-agent"));
		assert.ok(result.matchedPatterns.includes("pi-package"));
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects Pi extension via driver text mentioning pi-coding-agent", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-det-driver-"));
		makeProject(tmpDir, { name: "x", version: "1.0.0" });
		const drivers = createEmptyDrivers();
		drivers.technicalConcerns.push({
			id: "TC-1",
			description: "Build a pi-coding-agent extension",
		});
		const result = detectPiExtension(tmpDir, drivers, null);
		assert.strictEqual(result.isPiExtension, true);
		assert.ok(result.confidence > 0.5);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects Pi extension via inputsConfig document paths", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-det-cfg-"));
		makeProject(tmpDir, { name: "x", version: "1.0.0" });
		const inputsConfig: ArchitectInputsConfig = {
			version: 1,
			documents: [{ type: "readme", path: "README.md" }],
			additionalConstraints: ["Build a registerTool-only extension"],
		};
		const result = detectPiExtension(tmpDir, createEmptyDrivers(), inputsConfig);
		assert.strictEqual(result.isPiExtension, true);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns negative signals can reduce confidence", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-det-mixed-"));
		makeProject(tmpDir, { name: "x", version: "1.0.0" });
		const drivers = createEmptyDrivers();
		drivers.technicalConcerns.push({
			id: "TC-1",
			description: "Build a pi-coding-agent extension",
		});
		drivers.constraints.push({
			id: "C-1",
			category: "scope",
			description: "Sealed product, no extension system",
		});
		const result = detectPiExtension(tmpDir, drivers, null);
		assert.ok(result.confidence < 0.5, `expected reduced confidence, got ${result.confidence}`);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("handles missing package.json without crashing", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-det-nopkg-"));
		const result = detectPiExtension(tmpDir, null, null);
		assert.strictEqual(result.isPiExtension, false);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("handles malformed package.json without crashing", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-det-badpkg-"));
		makeProject(tmpDir);
		fs.writeFileSync(path.join(tmpDir, "package.json"), "{ not json", "utf8");
		const result = detectPiExtension(tmpDir, null, null);
		assert.strictEqual(result.isPiExtension, false);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns matchedPatterns sorted uniquely", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-det-unique-"));
		makeProject(tmpDir, {
			name: "@scope/test",
			version: "1.0.0",
			dependencies: { "@mariozechner/pi-coding-agent": "*" },
			peerDependencies: { "@mariozechner/pi-coding-agent": "*" },
		});
		const result = detectPiExtension(tmpDir, createEmptyDrivers(), null);
		const unique = new Set(result.matchedPatterns);
		assert.strictEqual(unique.size, result.matchedPatterns.length);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});
});