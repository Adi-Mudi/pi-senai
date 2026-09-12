import { describe, it } from "node:test";
import assert from "node:assert";
import * as path from "node:path";
import {
	getBrainstormDir,
	getBrainstormDispatchLogPath,
	getBrainstormDiscussionDir,
	getBrainstormMissionBriefPath,
} from "../../src/core/paths.js";

describe("paths — brainstorm folder (Phase 1)", () => {
	const cwd = "/tmp/fake";
	const id = "2026-09-06-19-30-brainstorm-refactor-lock";

	it("getBrainstormDir joins SENAI_DIR + Brainstorm + brainstorm-run-id", () => {
		const got = getBrainstormDir(cwd, id);
		assert.strictEqual(got, path.join(cwd, ".IDE_Plans/pi-senai/Brainstorm", id));
	});

	it("getBrainstormMissionBriefPath ends at mission-brief.md under the brainstorm dir", () => {
		const got = getBrainstormMissionBriefPath(cwd, id);
		assert.strictEqual(got, path.join(getBrainstormDir(cwd, id), "mission-brief.md"));
	});

	it("getBrainstormDiscussionDir ends at discussions/ under the brainstorm dir", () => {
		const got = getBrainstormDiscussionDir(cwd, id);
		assert.strictEqual(got, path.join(getBrainstormDir(cwd, id), "discussions"));
	});

	it("getBrainstormDispatchLogPath ends at brainstorm-dispatch.md under the brainstorm dir", () => {
		const got = getBrainstormDispatchLogPath(cwd, id);
		assert.strictEqual(got, path.join(getBrainstormDir(cwd, id), "brainstorm-dispatch.md"));
	});

	it("each brainstorm run id yields a unique folder (no shared state)", () => {
		const id2 = "2026-09-06-19-35-brainstorm-other";
		assert.notStrictEqual(getBrainstormDir(cwd, id), getBrainstormDir(cwd, id2));
		assert.notStrictEqual(getBrainstormMissionBriefPath(cwd, id), getBrainstormMissionBriefPath(cwd, id2));
	});
});
