import { describe, it } from "node:test";
import assert from "node:assert";
import { buildNewEntryGuide } from "../../src/commands/suggest-architect.js";

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