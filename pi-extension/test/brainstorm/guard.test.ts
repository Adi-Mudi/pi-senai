import { describe, it } from "node:test";
import assert from "node:assert";
import * as path from "node:path";
import {
	BRAINSTORM_DISPATCH_CAP,
	guardArtifactPath,
	guardBriefContent,
	guardDispatchCount,
	guardSeedInput,
} from "../../src/brainstorm/guard.js";
import { BRIEF_DRAFT_MARKER } from "../../src/core/mission-brief.js";

/** Build a minimal valid brief (all sections filled, not _TBD_). */
function validBrief(): string {
	return [
		BRIEF_DRAFT_MARKER,
		"## Problem statement",
		"The retry path deadlocks under load when two clients share a key.",
		"",
		"## Mission type",
		"bugfix",
		"",
		"## Success criteria",
		"- No deadlock under 100 concurrent clients",
		"- p99 retry latency below 50ms",
		"",
		"## Out-of-scope",
		"- Switching to a different lock library",
		"",
		"## Open questions",
		"- Should we add jitter to retries?",
		"",
		"## Refined mission",
		"Fix the deadlock in the retry path without changing the lock library.",
	].join("\n");
}

/** Build a brief where every section is _TBD_ placeholder. */
function placeholderBrief(): string {
	return [
		BRIEF_DRAFT_MARKER,
		"## Problem statement\n\n_TBD_\n",
		"## Mission type\n\n_TBD_\n",
		"## Success criteria\n\n_TBD_\n",
		"## Out-of-scope\n\n_TBD_\n",
		"## Open questions\n\n_TBD_\n",
		"## Refined mission\n\n_TBD_\n",
	].join("");
}

describe("guard — seed input", () => {
	it("rejects empty seed", () => {
		const result = guardSeedInput("");
		assert.strictEqual(result.ok, false);
		assert.ok(result.reason?.includes("seed topic"));
	});

	it("rejects whitespace-only seed", () => {
		const result = guardSeedInput("   \t  \n  ");
		assert.strictEqual(result.ok, false);
		assert.ok(result.reason?.includes("seed topic"));
	});

	it("accepts a real seed", () => {
		const result = guardSeedInput("refactor the lock module");
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.reason, undefined);
	});

	it("accepts a single-char seed (minimum signal)", () => {
		const result = guardSeedInput("x");
		assert.strictEqual(result.ok, true);
	});

	it("trims surrounding whitespace before accepting", () => {
		const result = guardSeedInput("  refactor  ");
		assert.strictEqual(result.ok, true);
	});
});

describe("guard — brief content", () => {
	it("rejects a brief where every section is _TBD_", () => {
		const result = guardBriefContent(placeholderBrief());
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.details?.length, 6, "all 6 sections should be flagged");
		assert.ok(result.reason?.includes("Mission brief is not ready"));
	});

	it("rejects a brief where ONE section is _TBD_ and others are real", () => {
		const brief = validBrief().replace(
			"## Success criteria\n- No deadlock under 100 concurrent clients\n- p99 retry latency below 50ms",
			"## Success criteria\n\n_TBD_\n",
		);
		const result = guardBriefContent(brief);
		assert.strictEqual(result.ok, false);
		assert.deepStrictEqual(result.details, ["## Success criteria"]);
	});

	it("rejects a brief where a section body is empty", () => {
		const brief = validBrief().replace(
			"## Open questions\n- Should we add jitter to retries?",
			"## Open questions\n\n",
		);
		const result = guardBriefContent(brief);
		assert.strictEqual(result.ok, false);
		assert.deepStrictEqual(result.details, ["## Open questions"]);
	});

	it("rejects a brief where a required section heading is missing", () => {
		const brief = validBrief().replace("## Refined mission", "## (skipped)");
		const result = guardBriefContent(brief);
		assert.strictEqual(result.ok, false);
		assert.ok(result.details?.includes("## Refined mission"));
	});

	it("accepts a fully filled brief", () => {
		const result = guardBriefContent(validBrief());
		assert.strictEqual(result.ok, true, result.reason);
		assert.strictEqual(result.details, undefined);
	});

	it("accepts a brief with multi-line section bodies", () => {
		const brief = validBrief().replace(
			"## Problem statement\nThe retry path deadlocks under load when two clients share a key.",
			"## Problem statement\nLine one of the problem.\nLine two of the problem.\nLine three.",
		);
		const result = guardBriefContent(brief);
		assert.strictEqual(result.ok, true, result.reason);
	});
});

describe("guard — artifact path", () => {
	const id = "2026-09-06-19-30-brainstorm-test";

	it("rejects paths outside the brainstorm folder", () => {
		const result = guardArtifactPath("/etc/passwd", id);
		assert.strictEqual(result.ok, false);
		assert.ok(result.reason?.includes("escapes the brainstorm folder"));
	});

	it("rejects path traversal via ..", () => {
		const evil = path.resolve(".", ".IDE_Plans/pi-senai/Brainstorm", id, "..", "..", "..", "etc", "passwd");
		const result = guardArtifactPath(evil, id);
		assert.strictEqual(result.ok, false);
	});

	it("rejects paths in SENAI_DIR but outside Brainstorm/<id>", () => {
		const result = guardArtifactPath(".IDE_Plans/pi-senai/state.json", id);
		assert.strictEqual(result.ok, false);
	});

	it("rejects paths in runs/ folder (state-machine area)", () => {
		const result = guardArtifactPath(`.IDE_Plans/pi-senai/runs/${id}/plan.md`, id);
		assert.strictEqual(result.ok, false);
	});

	it("accepts the mission-brief.md inside the brainstorm folder", () => {
		const p = `.IDE_Plans/pi-senai/Brainstorm/${id}/mission-brief.md`;
		const result = guardArtifactPath(p, id);
		assert.strictEqual(result.ok, true, result.reason);
	});

	it("accepts files nested under discussions/", () => {
		const p = `.IDE_Plans/pi-senai/Brainstorm/${id}/discussions/discussion-01-test.md`;
		const result = guardArtifactPath(p, id);
		assert.strictEqual(result.ok, true, result.reason);
	});

	it("accepts the dispatch log path", () => {
		const p = `.IDE_Plans/pi-senai/Brainstorm/${id}/brainstorm-dispatch.md`;
		const result = guardArtifactPath(p, id);
		assert.strictEqual(result.ok, true, result.reason);
	});

	it("rejects when brainstorm run id is missing", () => {
		const result = guardArtifactPath(".IDE_Plans/pi-senai/Brainstorm/x/mission-brief.md", "");
		assert.strictEqual(result.ok, false);
	});

	it("rejects paths with NUL bytes", () => {
		const result = guardArtifactPath("foo\0bar", id);
		assert.strictEqual(result.ok, false);
	});

	it("refuses cross-id writes (same root, different brainstorm id)", () => {
		const p = `.IDE_Plans/pi-senai/Brainstorm/other-id/mission-brief.md`;
		const result = guardArtifactPath(p, id);
		assert.strictEqual(result.ok, false);
	});
});

describe("guard — dispatch count", () => {
	it("rejects negative count", () => {
		const result = guardDispatchCount(-1);
		assert.strictEqual(result.ok, false);
		assert.ok(result.reason?.includes("non-negative"));
	});

	it("rejects count equal to cap (would exceed)", () => {
		const result = guardDispatchCount(BRAINSTORM_DISPATCH_CAP);
		assert.strictEqual(result.ok, false);
		assert.ok(result.reason?.includes("dispatch cap"));
	});

	it("rejects count above cap", () => {
		const result = guardDispatchCount(BRAINSTORM_DISPATCH_CAP + 1);
		assert.strictEqual(result.ok, false);
	});

	it("accepts zero dispatches", () => {
		const result = guardDispatchCount(0);
		assert.strictEqual(result.ok, true);
	});

	it("accepts one dispatch", () => {
		const result = guardDispatchCount(1);
		assert.strictEqual(result.ok, true);
	});

	it("accepts count below cap (cap - 1)", () => {
		const result = guardDispatchCount(BRAINSTORM_DISPATCH_CAP - 1);
		assert.strictEqual(result.ok, true);
	});

	it("cap is 3 (locked value from design doc)", () => {
		assert.strictEqual(BRAINSTORM_DISPATCH_CAP, 3);
	});
});
