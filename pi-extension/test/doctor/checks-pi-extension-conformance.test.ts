import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkPiExtensionConformance } from "../../src/doctor/checks-pi-extension-conformance.js";

function makeProject(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "doc-pi-conform-"));
}

describe("checkPiExtensionConformance", () => {
	it("returns info message when project is not detected as Pi extension", () => {
		const tmp = makeProject();
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({ name: "generic", version: "1.0.0" }),
		);
		const section = checkPiExtensionConformance(tmp);
		assert.strictEqual(section.title, "Pi Extension Conformance");
		assert.ok(section.items.some((i) => i.message.includes("not detected")));
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("returns ok when Pi extension project has correct frontmatter and peerDeps", () => {
		const tmp = makeProject();
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({
				name: "@scope/pi-ext",
				version: "1.0.0",
				keywords: ["pi-package"],
				peerDependencies: {
					"@mariozechner/pi-coding-agent": "*",
					"@sinclair/typebox": "*",
				},
			}),
		);
		fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, "src", "index.ts"),
			'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";\nexport default function (pi: ExtensionAPI) {}',
		);
		fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, ".pi", "agents", "my-agent.md"),
			"---\nname: my-agent\ndescription: test agent\ntools: read\n---\n# My Agent",
		);
		const section = checkPiExtensionConformance(tmp);
		const okItems = section.items.filter((i) => i.status === "ok");
		assert.ok(okItems.length >= 2, `expected >=2 ok items, got ${okItems.length}`);
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("returns error when Pi extension project imports Pi packages but has no peerDependencies", () => {
		const tmp = makeProject();
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({
				name: "@scope/pi-ext",
				version: "1.0.0",
				keywords: ["pi-package"],
				dependencies: { "@mariozechner/pi-coding-agent": "*" },
			}),
		);
		fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, "src", "index.ts"),
			'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";\nexport default function (pi: ExtensionAPI) {}',
		);
		const section = checkPiExtensionConformance(tmp);
		const errItems = section.items.filter((i) => i.status === "error");
		assert.ok(errItems.length >= 1, `expected >=1 error item, got ${errItems.length}`);
		assert.ok(errItems.some((i) => i.message.includes("peerDependencies")));
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("handles missing package.json gracefully", () => {
		const tmp = makeProject();
		const section = checkPiExtensionConformance(tmp);
		assert.strictEqual(section.title, "Pi Extension Conformance");
		assert.ok(Array.isArray(section.items));
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("returns error when an agent file is missing frontmatter", () => {
		const tmp = makeProject();
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({
				name: "@scope/pi-ext",
				version: "1.0.0",
				keywords: ["pi-package"],
				peerDependencies: {
					"@mariozechner/pi-coding-agent": "*",
					"@sinclair/typebox": "*",
				},
			}),
		);
		fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, "src", "index.ts"),
			'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";\nexport default function (pi: ExtensionAPI) {}',
		);
		fs.mkdirSync(path.join(tmp, ".pi", "agents"), { recursive: true });
		fs.writeFileSync(path.join(tmp, ".pi", "agents", "broken.md"), "# No frontmatter\n");
		const section = checkPiExtensionConformance(tmp);
		const errItems = section.items.filter((i) => i.status === "error");
		assert.ok(errItems.some((i) => i.message.includes("agent")));
		fs.rmSync(tmp, { recursive: true, force: true });
	});
});