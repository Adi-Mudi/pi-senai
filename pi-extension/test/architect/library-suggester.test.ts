import { describe, it } from "node:test";
import assert from "node:assert";
import {
	PI_EXTENSION_PRESET,
	isPiExtensionPreset,
	suggestArchitectures,
} from "../../src/architect/library-suggester.js";
import type { ArchitectureLibraryEntry } from "../../src/architect/index.js";

function makeEntry(overrides: Partial<ArchitectureLibraryEntry>): ArchitectureLibraryEntry {
	return {
		id: overrides.id ?? overrides.name ?? "test",
		name: overrides.name ?? "test",
		filePath: "",
		domain: overrides.domain ?? [],
		teamSize: "",
		complexity: "",
		bestForDrivers: overrides.bestForDrivers ?? [],
		notForDrivers: overrides.notForDrivers ?? [],
		content: "",
	};
}

describe("library suggester", () => {
	it("returns empty array when library is empty", () => {
		const result = suggestArchitectures(
			{ purpose: "extension", scale: "small-team", deployment: "local", realtime: "no" },
			[],
		);
		assert.deepStrictEqual(result, []);
	});

	it("returns top 3 by default and respects topN override", () => {
		const library = [
			makeEntry({ id: "a", name: "a", bestForDrivers: ["extension"], domain: ["pi-extension"] }),
			makeEntry({ id: "b", name: "b", bestForDrivers: ["extension"], domain: ["pi-extension"] }),
			makeEntry({ id: "c", name: "c", bestForDrivers: ["extension"], domain: ["pi-extension"] }),
			makeEntry({ id: "d", name: "d", bestForDrivers: ["extension"], domain: ["pi-extension"] }),
		];
		const def = suggestArchitectures(
			{ purpose: "extension", scale: "small-team", deployment: "local", realtime: "no" },
			library,
		);
		assert.strictEqual(def.length, 3);
		const two = suggestArchitectures(
			{ purpose: "extension", scale: "small-team", deployment: "local", realtime: "no" },
			library,
			2,
		);
		assert.strictEqual(two.length, 2);
	});

	it("scores entries with matching purpose keywords above non-matching", () => {
		const library = [
			makeEntry({ id: "match", name: "match", bestForDrivers: ["extension", "skill"], domain: ["pi-extension"] }),
			makeEntry({ id: "miss", name: "miss", bestForDrivers: ["web", "browser"], domain: ["web"] }),
		];
		const result = suggestArchitectures(
			{ purpose: "extension", scale: "small-team", deployment: "local", realtime: "no" },
			library,
		);
		assert.strictEqual(result[0].entry.id, "match");
		assert.ok(result[0].score > result[1].score);
	});

	it("applies negative-keyword penalty when notForDrivers match the answer-derived text", () => {
		const library = [
			makeEntry({
				id: "negative",
				name: "negative",
				bestForDrivers: ["extension"],
				notForDrivers: ["extension"],
				domain: ["pi-extension"],
			}),
			makeEntry({
				id: "neutral",
				name: "neutral",
				bestForDrivers: ["extension"],
				domain: ["pi-extension"],
			}),
		];
		const result = suggestArchitectures(
			{ purpose: "extension", scale: "small-team", deployment: "local", realtime: "no" },
			library,
		);
		assert.ok(result[0].entry.id === "neutral");
		assert.ok(result[1].entry.id === "negative");
		assert.ok(result[0].score > result[1].score);
	});

	it("applies +3 domain bonus when purpose aligns with entry domain", () => {
		const library = [
			makeEntry({ id: "pi-dom", name: "pi-dom", bestForDrivers: [], domain: ["pi-extension"] }),
			makeEntry({ id: "web-dom", name: "web-dom", bestForDrivers: [], domain: ["web"] }),
		];
		const result = suggestArchitectures(
			{ purpose: "extension", scale: "small-team", deployment: "local", realtime: "no" },
			library,
		);
		assert.strictEqual(result[0].entry.id, "pi-dom");
	});

	it("produces deterministic ordering across calls", () => {
		const library = [
			makeEntry({ id: "x1", name: "x1", bestForDrivers: ["extension"], domain: ["pi-extension"] }),
			makeEntry({ id: "x2", name: "x2", bestForDrivers: ["extension"], domain: ["pi-extension"] }),
			makeEntry({ id: "x3", name: "x3", bestForDrivers: ["extension"], domain: ["pi-extension"] }),
		];
		const first = suggestArchitectures(
			{ purpose: "extension", scale: "small-team", deployment: "local", realtime: "no" },
			library,
		);
		const second = suggestArchitectures(
			{ purpose: "extension", scale: "small-team", deployment: "local", realtime: "no" },
			library,
		);
		assert.deepStrictEqual(
			first.map((s) => s.entry.id),
			second.map((s) => s.entry.id),
		);
	});

	it("PI_EXTENSION_PRESET is the canonical Pi extension answer set", () => {
		assert.deepStrictEqual(PI_EXTENSION_PRESET, {
			purpose: "extension",
			scale: "small-team",
			deployment: "local",
			realtime: "no",
		});
		assert.ok(isPiExtensionPreset(PI_EXTENSION_PRESET));
	});

	it("isPiExtensionPreset returns false when any field differs", () => {
		assert.strictEqual(isPiExtensionPreset(PI_EXTENSION_PRESET), true);
		assert.strictEqual(
			isPiExtensionPreset({ ...PI_EXTENSION_PRESET, purpose: "web-app" }),
			false,
		);
		assert.strictEqual(
			isPiExtensionPreset({ ...PI_EXTENSION_PRESET, scale: "single-user" }),
			false,
		);
		assert.strictEqual(
			isPiExtensionPreset({ ...PI_EXTENSION_PRESET, deployment: "cloud" }),
			false,
		);
		assert.strictEqual(
			isPiExtensionPreset({ ...PI_EXTENSION_PRESET, realtime: "yes" }),
			false,
		);
	});
});