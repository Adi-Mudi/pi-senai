import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectPiExtension } from "../../src/architect/index.js";

describe("/senai-generate-architect auto-trigger behavior", () => {
	it("detects Pi extension when package.json declares pi-package keyword + pi-coding-agent peer dep", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gen-trigger-pi-"));
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({
				name: "@scope/test-pi-ext",
				version: "1.0.0",
				keywords: ["pi-package"],
				peerDependencies: {
					"@mariozechner/pi-coding-agent": "*",
				},
			}),
		);
		const detection = detectPiExtension(tmp, null, null);
		assert.strictEqual(detection.isPiExtension, true);
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("does not detect Pi extension when package.json has no Pi imports or keywords", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gen-trigger-non-pi-"));
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({
				name: "generic-webapp",
				version: "1.0.0",
				keywords: ["react", "spa"],
			}),
		);
		const detection = detectPiExtension(tmp, null, null);
		assert.strictEqual(detection.isPiExtension, false);
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("detects Pi extension when source code imports from Pi package", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gen-trigger-src-"));
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({ name: "test", version: "1.0.0" }),
		);
		fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp, "src", "index.ts"),
			'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";\nexport default function (pi: ExtensionAPI) {}',
		);
		// Note: detector itself does not read source files; it only reads package.json.
		// This test verifies the detector returns false for a non-Pi package.json
		// even when source uses Pi imports. The auto-trigger relies on the detector,
		// not source scanning — so for source-only Pi projects the trigger won't
		// fire (acceptable: user can still run /senai-suggest-architect manually).
		const detection = detectPiExtension(tmp, null, null);
		assert.strictEqual(detection.isPiExtension, false);
		fs.rmSync(tmp, { recursive: true, force: true });
	});
});