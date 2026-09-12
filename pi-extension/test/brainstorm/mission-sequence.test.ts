import { describe, it } from "node:test";
import assert from "node:assert";
import {
	MISSION_SEQUENCE,
	missionUsesPlanRoad,
	SCAN_TYPE_ROLES,
} from "../../src/brainstorm/registry.js";
import { MISSION_PACKS } from "../../src/core/mission-packs.js";
import { MISSION_TYPES, type ScanType } from "../../src/core/state.js";

const SCAN_TYPES: readonly ScanType[] = ["code", "doc", "community"];
const TRUNK = ["understand", "confirm", "scans", "discuss"] as const;

describe("MISSION_SEQUENCE", () => {
	it("every mission type has a sequence — map and MISSION_TYPES stay in sync", () => {
		assert.deepStrictEqual(
			Object.keys(MISSION_SEQUENCE).sort(),
			[...MISSION_TYPES].sort(),
			"every MissionType must have exactly one sequence entry",
		);
	});

	it("every sequence starts with the shared trunk: understand → confirm → scans → discuss", () => {
		for (const type of MISSION_TYPES) {
			const { stages } = MISSION_SEQUENCE[type];
			assert.deepStrictEqual(
				stages.slice(0, TRUNK.length),
				[...TRUNK],
				`${type} must start with the shared trunk`,
			);
		}
	});

	it("explore ends at the decide door and never plans or implements", () => {
		const { stages } = MISSION_SEQUENCE.explore;
		assert.ok(stages.includes("decide"));
		assert.ok(!stages.includes("approve"), "explore skips the approve road");
		assert.ok(!stages.includes("plan"));
		assert.ok(!stages.includes("implement"));
		assert.strictEqual(missionUsesPlanRoad("explore"), false);
	});

	it("docs and test skip the document stage but keep the plan road", () => {
		for (const type of ["docs", "test"] as const) {
			const { stages } = MISSION_SEQUENCE[type];
			assert.ok(stages.includes("plan"), `${type} keeps plan`);
			assert.ok(stages.includes("implement"), `${type} keeps implement`);
			assert.ok(!stages.includes("document"), `${type} skips document`);
			assert.strictEqual(missionUsesPlanRoad(type), true);
		}
	});

	it("feature, bugfix, upgrade walk the full road", () => {
		for (const type of ["feature", "bugfix", "upgrade"] as const) {
			assert.deepStrictEqual(MISSION_SEQUENCE[type].stages, [
				"understand", "confirm", "scans", "discuss",
				"approve", "plan", "implement", "document", "deliver",
			]);
			assert.strictEqual(missionUsesPlanRoad(type), true);
		}
	});

	it("defaultScans only contain valid scan types with known roles", () => {
		for (const type of MISSION_TYPES) {
			for (const scan of MISSION_SEQUENCE[type].defaultScans) {
				assert.ok(SCAN_TYPES.includes(scan), `${type}: ${scan} must be a valid ScanType`);
				assert.ok(SCAN_TYPE_ROLES[scan].length > 0, `${type}: ${scan} must have roles`);
			}
		}
	});

	it("questionPack always points back at its own mission type", () => {
		for (const type of MISSION_TYPES) {
			assert.strictEqual(MISSION_SEQUENCE[type].questionPack, type);
		}
	});

	it("explore defaults to community+doc; the codebase is not the subject", () => {
		assert.deepStrictEqual([...MISSION_SEQUENCE.explore.defaultScans], ["community", "doc"]);
	});

	it("each entry's pack matches MISSION_PACKS[type]", () => {
		for (const type of MISSION_TYPES) {
			assert.strictEqual(MISSION_SEQUENCE[type].pack, MISSION_PACKS[type], `${type} pack wiring`);
		}
	});

	it("the bugfix pack has the 4 extra brief sections and the community conditional scan", () => {
		const pack = MISSION_SEQUENCE.bugfix.pack;
		assert.deepStrictEqual(pack.extraBriefSections, [
			"## Reproduction steps",
			"## Expected vs actual",
			"## Root cause",
			"## Regression test plan",
		]);
		assert.deepStrictEqual(
			pack.conditionalScans.map((c) => c.scan),
			["community"],
		);
	});

	it("every entry has a summary for the sealed prompt's type list", () => {
		for (const type of MISSION_TYPES) {
			assert.ok(MISSION_SEQUENCE[type].summary.length > 0, `${type} needs a summary`);
		}
	});
});
