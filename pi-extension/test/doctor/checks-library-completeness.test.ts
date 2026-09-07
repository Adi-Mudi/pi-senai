import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkLibraryCompleteness } from "../../src/doctor/checks-library-completeness.js";

function makeProject(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "doc-lib-complete-"));
}

describe("checkLibraryCompleteness", () => {
	it("returns warning when library directory is missing", () => {
		const tmp = makeProject();
		const section = checkLibraryCompleteness(tmp);
		assert.ok(section.items.some((i) => i.status === "warning" && i.message.includes("does not exist")));
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("counts library entries", () => {
		const tmp = makeProject();
		const libDir = path.join(tmp, ".pi", "architecture-library");
		fs.mkdirSync(libDir, { recursive: true });
		fs.writeFileSync(
			path.join(libDir, "clean-architecture.md"),
			"---\nname: clean-architecture\ndomain: web\n---\n# Clean",
		);
		const section = checkLibraryCompleteness(tmp);
		const okCount = section.items.filter((i) => i.status === "ok").length;
		assert.ok(okCount >= 1);
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("reports missing pi-extension domain entries", () => {
		const tmp = makeProject();
		const libDir = path.join(tmp, ".pi", "architecture-library");
		fs.mkdirSync(libDir, { recursive: true });
		fs.writeFileSync(
			path.join(libDir, "clean-architecture.md"),
			"---\nname: clean-architecture\ndomain: web\n---\n# Clean",
		);
		const section = checkLibraryCompleteness(tmp);
		const warn = section.items.filter((i) => i.status === "warning");
		assert.ok(warn.some((i) => i.message.includes("pi-extension")));
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("reports malformed library entries", () => {
		const tmp = makeProject();
		const libDir = path.join(tmp, ".pi", "architecture-library");
		fs.mkdirSync(libDir, { recursive: true });
		fs.writeFileSync(path.join(libDir, "broken.md"), "no frontmatter here");
		const section = checkLibraryCompleteness(tmp);
		assert.ok(section.items.some((i) => i.status === "warning" && i.message.includes("malformed") || i.message.includes("frontmatter")));
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("suggests /senai-suggest-architect for Pi extension projects without architect-inputs.json", () => {
		const tmp = makeProject();
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({
				name: "@scope/test-pi-ext",
				version: "1.0.0",
				keywords: ["pi-package"],
				peerDependencies: { "@mariozechner/pi-coding-agent": "*" },
			}),
		);
		const libDir = path.join(tmp, ".pi", "architecture-library");
		fs.mkdirSync(libDir, { recursive: true });
		fs.writeFileSync(
			path.join(libDir, "test.md"),
			"---\nname: test\ndomain: web\n---\n# Test",
		);
		const section = checkLibraryCompleteness(tmp);
		const suggestHint = section.items.find(
			(i) => i.status === "info" && i.message.includes("/senai-suggest-architect"),
		);
		assert.ok(suggestHint, "expected suggest hint for Pi extension project");
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("does NOT suggest /senai-suggest-architect for non-Pi projects", () => {
		const tmp = makeProject();
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({
				name: "generic-webapp",
				version: "1.0.0",
				keywords: ["react"],
			}),
		);
		const libDir = path.join(tmp, ".pi", "architecture-library");
		fs.mkdirSync(libDir, { recursive: true });
		fs.writeFileSync(
			path.join(libDir, "test.md"),
			"---\nname: test\ndomain: web\n---\n# Test",
		);
		const section = checkLibraryCompleteness(tmp);
		const suggestHint = section.items.find(
			(i) => i.status === "info" && i.message.includes("/senai-suggest-architect"),
		);
		assert.strictEqual(suggestHint, undefined, "should not show hint for non-Pi project");
		fs.rmSync(tmp, { recursive: true, force: true });
	});
});