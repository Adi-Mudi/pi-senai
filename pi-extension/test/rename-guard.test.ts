import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Rename-guard: this test fails if `/senai-discussion` (the pre-rename
// slash command) reappears anywhere in the source tree after the
// /senai-discussion → /senai-brainstorm rename. Locked commands, transcripts,
// and internal role names (e.g. `discussion` in agents.json) are allowed to
// use the word "discussion" in non-command contexts; this test only guards
// against resurrection of the user-facing slash command name and the
// pre-rename file paths that would re-import the old registration.

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist layout: dist/pi-extension/test/rename-guard.test.js → repo root is ../../../
// src layout: pi-extension/test/rename-guard.test.ts → repo root is ../../
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

const GUARD_TARGETS = [
	"pi-extension/src",
	"skills",
] as const;

const GUARD_EXCEPTIONS: ReadonlyArray<{ path: string; reason: string }> = [
	// This test file is allowed to reference the old name (it is the guard).
	{
		path: "pi-extension/test/rename-guard.test.ts",
		reason: "the guard test itself references the old name by design",
	},
];

function walk(dir: string): string[] {
	const out: string[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walk(full));
		} else if (entry.isFile()) {
			out.push(full);
		}
	}
	return out;
}

describe("rename-guard /senai-discussion residue", () => {
	it("no source file under pi-extension/src or skills references /senai-discussion", () => {
		const exceptions = new Set(
			GUARD_EXCEPTIONS.map((e) => path.resolve(REPO_ROOT, e.path)),
		);
		const offenders: Array<{ file: string; line: number; text: string }> = [];
		for (const target of GUARD_TARGETS) {
			const abs = path.resolve(REPO_ROOT, target);
			for (const file of walk(abs)) {
				if (exceptions.has(file)) continue;
				const rel = path.relative(REPO_ROOT, file);
				let content: string;
				try {
					content = fs.readFileSync(file, "utf8");
				} catch {
					continue;
				}
				const lines = content.split(/\r?\n/);
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (line.includes("senai-discussion")) {
						offenders.push({ file: rel, line: i + 1, text: line.trim() });
					}
				}
			}
		}
		if (offenders.length > 0) {
			const report = offenders
				.map((o) => `  ${o.file}:${o.line}: ${o.text}`)
				.join("\n");
			assert.fail(
				`Found /senai-discussion residue in source tree. The rename is hard; remove these references or update the guard if intentional.\n${report}`,
			);
		}
	});

	it("the brainstorm slash commands are registered and the old ones are not", async () => {
		// Dynamic import of the commands module via the dist layout. We avoid
		// importing from "../src/" because the test runner executes against
		// dist/pi-extension/test/. The compile step already enforces that
		// commands/brainstorm.ts compiles, which is the strongest static
		// proof. We additionally check that the registered command names
		// match the rename by exercising registerBrainstormCommands against
		// a mock ExtensionAPI.
		const { registerBrainstormCommands } = await import(
			"../src/commands/index.js"
		);
		const registered: Record<string, unknown> = {};
		const mockApi = {
			registerCommand(name: string, def: unknown) {
				registered[name] = def;
			},
		} as unknown as Parameters<typeof registerBrainstormCommands>[0];
		registerBrainstormCommands(mockApi);
		assert.ok(registered["senai-brainstorm"], "senai-brainstorm must be registered");
		assert.ok(
			registered["senai-brainstorm-approve"],
			"senai-brainstorm-approve must be registered",
		);
		assert.strictEqual(
			registered["senai-discussion"],
			undefined,
			"senai-discussion must NOT be registered (hard rename)",
		);
		assert.strictEqual(
			registered["senai-discussion-approve"],
			undefined,
			"senai-discussion-approve must NOT be registered (hard rename)",
		);
	});
});
