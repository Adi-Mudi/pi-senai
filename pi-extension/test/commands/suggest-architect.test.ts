import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { buildNewEntryGuide, resolveProjectAnswers } from "../../src/commands/suggest-architect.js";

describe("/senai-suggest-architect", () => {
	it("buildNewEntryGuide produces a guide string with the new-entry template", () => {
		const guide = buildNewEntryGuide();
		assert.ok(guide.includes("No architecture in the library matches"));
		assert.ok(guide.includes("name: my-new-architecture"));
		assert.ok(guide.includes("best-for-drivers:"));
		assert.ok(guide.includes("## When to use"));
		assert.ok(guide.includes("## Core rules"));
		assert.ok(guide.includes("## Common pitfalls"));
		assert.ok(guide.includes("github.com/Adi-Mudi/pi-senai"));
	});

	it("buildNewEntryGuide mentions re-running the command after adding an entry", () => {
		const guide = buildNewEntryGuide();
		assert.ok(guide.includes("Re-run /senai-suggest-architect"));
		assert.ok(guide.includes("new entry will appear in the picker"));
	});

	it("buildNewEntryGuide mentions the standard 5 sections", () => {
		const guide = buildNewEntryGuide();
		const requiredSections = [
			"## When to use",
			"## When not to use",
			"## Core rules",
			"## Typical structure",
			"## Common pitfalls",
		];
		for (const section of requiredSections) {
			assert.ok(guide.includes(section), `guide missing section "${section}"`);
		}
	});
});

describe("resolveProjectAnswers", () => {
	it("skips all 4 questions when the project is a Pi extension (uses preset)", async () => {
		// Use the actual pi-senai project root — it is a Pi extension.
		const selectCalls: string[] = [];
		const ctx = {
			ui: {
				select: mock.fn(async (_title: string) => {
					selectCalls.push(_title);
					return undefined as unknown as string; // should never be called
				}),
			},
		};
		// The project root (this file lives inside it) is a Pi extension.
		const result = await resolveProjectAnswers(process.cwd(), ctx);
		assert.strictEqual(result.isPiExtension, true);
		assert.strictEqual(result.answers.purpose, "extension");
		assert.strictEqual(result.answers.scale, "small-team");
		assert.strictEqual(result.answers.deployment, "local");
		assert.strictEqual(result.answers.realtime, "no");
		assert.strictEqual(selectCalls.length, 0, "ui.select must not be called for Pi extension projects");
	});
});