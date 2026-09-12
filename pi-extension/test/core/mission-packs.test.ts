import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BUGFIX_PACK,
  EMPTY_PACK,
  MISSION_PACKS,
  getMissionPack,
} from "../../src/core/mission-packs.js";
import { MISSION_TYPES, loadState, startRun } from "../../src/core/state.js";
import {
  BRIEF_CONTENT_PLACEHOLDER,
  REQUIRED_BRIEF_SECTIONS,
  recordDiscussion,
  requiredBriefSectionsFor,
  validateBriefContent,
  validateBriefContentForType,
} from "../../src/core/mission-brief.js";
import { getPreRunMissionBriefPath } from "../../src/core/paths.js";

function filledBrief(sections: readonly string[]): string {
  return sections.map((s) => `${s}\n\nFilled content for ${s.slice(3)}.\n`).join("\n");
}

describe("mission-packs", () => {
  it("MISSION_PACKS has an entry for every MISSION_TYPES member", () => {
    for (const type of MISSION_TYPES) {
      assert.ok(MISSION_PACKS[type], `MISSION_PACKS must cover ${type}`);
      assert.strictEqual(getMissionPack(type), MISSION_PACKS[type]);
    }
    assert.strictEqual(getMissionPack(undefined), EMPTY_PACK);
  });

  it("BUGFIX_PACK carries the 4 extra sections and the community conditional scan", () => {
    assert.deepStrictEqual(BUGFIX_PACK.extraBriefSections, [
      "## Reproduction steps",
      "## Expected vs actual",
      "## Root cause",
      "## Regression test plan",
    ]);
    assert.deepStrictEqual(
      BUGFIX_PACK.conditionalScans.map((c) => c.scan),
      ["community"],
    );
    assert.strictEqual(EMPTY_PACK.extraBriefSections.length, 0);
  });
});

describe("requiredBriefSectionsFor", () => {
  it("bugfix gets the base 6 plus the 4 pack sections, in order", () => {
    const sections = requiredBriefSectionsFor("bugfix");
    assert.strictEqual(sections.length, 10);
    assert.deepStrictEqual(sections, [
      ...REQUIRED_BRIEF_SECTIONS,
      ...BUGFIX_PACK.extraBriefSections,
    ]);
  });

  it("other types and undefined keep the base 6; the base list itself is unchanged", () => {
    assert.strictEqual(REQUIRED_BRIEF_SECTIONS.length, 6);
    for (const type of ["feature", "upgrade", "explore", "docs", "test"] as const) {
      assert.deepStrictEqual(requiredBriefSectionsFor(type), REQUIRED_BRIEF_SECTIONS);
    }
    assert.deepStrictEqual(requiredBriefSectionsFor(undefined), REQUIRED_BRIEF_SECTIONS);
  });
});

describe("validateBriefContentForType", () => {
  it("rejects a bugfix brief with a _TBD_ Reproduction steps section", () => {
    const brief = filledBrief(requiredBriefSectionsFor("bugfix")).replace(
      "Filled content for Reproduction steps.",
      BRIEF_CONTENT_PLACEHOLDER,
    );
    const result = validateBriefContentForType(brief, "bugfix");
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason?.includes("## Reproduction steps"));
  });

  it("rejects a bugfix brief that is missing the pack sections entirely", () => {
    const brief = filledBrief(REQUIRED_BRIEF_SECTIONS);
    const result = validateBriefContentForType(brief, "bugfix");
    assert.strictEqual(result.ok, false);
    for (const section of BUGFIX_PACK.extraBriefSections) {
      assert.ok(result.reason?.includes(section), `reason should name ${section}`);
    }
  });

  it("accepts a fully filled bugfix brief", () => {
    const brief = filledBrief(requiredBriefSectionsFor("bugfix"));
    assert.deepStrictEqual(validateBriefContentForType(brief, "bugfix"), { ok: true });
  });

  it("non-bugfix types and undefined only require the base 6 (backward compat)", () => {
    const brief = filledBrief(REQUIRED_BRIEF_SECTIONS);
    assert.deepStrictEqual(validateBriefContentForType(brief, "feature"), { ok: true });
    assert.deepStrictEqual(validateBriefContentForType(brief, undefined), { ok: true });
    assert.deepStrictEqual(validateBriefContent(brief), []);
  });
});

describe("brief skeleton + startRun carry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-packs-"));
  });

  it("recordDiscussion seeds the extra sections for bugfix briefs", () => {
    const loc = recordDiscussion({
      cwd: tmpDir,
      label: "bugfix brief",
      transcript: "t",
      discussionSection: "d",
      missionType: "bugfix",
    });
    assert.strictEqual(loc.briefPath, getPreRunMissionBriefPath(tmpDir));

    const brief = fs.readFileSync(loc.briefPath, "utf8");
    for (const section of requiredBriefSectionsFor("bugfix")) {
      assert.ok(brief.includes(`${section}\n\n${BRIEF_CONTENT_PLACEHOLDER}`), `seed ${section}`);
    }
    // Extra sections sit between the base 6 and the Discussions separator.
    const refinedIdx = brief.indexOf("## Refined mission");
    const extraIdx = brief.indexOf("## Reproduction steps");
    const discussionsIdx = brief.indexOf("## Discussions");
    assert.ok(refinedIdx < extraIdx && extraIdx < discussionsIdx);
  });

  it("recordDiscussion without a mission type keeps the base-6 skeleton", () => {
    const loc = recordDiscussion({
      cwd: tmpDir,
      label: "plain brief",
      transcript: "t",
      discussionSection: "d",
    });
    const brief = fs.readFileSync(loc.briefPath, "utf8");
    assert.ok(!brief.includes("## Reproduction steps"));
    for (const section of REQUIRED_BRIEF_SECTIONS) {
      assert.ok(brief.includes(section));
    }
  });

  it("startRun preserves missionType and brainstormRunId from the carry argument", () => {
    const state = startRun(tmpDir, "Fix the crash", {
      missionType: "bugfix",
      brainstormRunId: "2026-09-11-22-00-brainstorm-fix",
    });
    assert.strictEqual(state.missionType, "bugfix");
    assert.strictEqual(state.brainstormRunId, "2026-09-11-22-00-brainstorm-fix");

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.missionType, "bugfix");
    assert.strictEqual(loaded.brainstormRunId, "2026-09-11-22-00-brainstorm-fix");
  });

  it("startRun without a carry argument leaves the brainstorm fields unset", () => {
    const state = startRun(tmpDir, "Plain run");
    assert.strictEqual(state.missionType, undefined);
    assert.strictEqual(state.brainstormRunId, undefined);

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.missionType, undefined);
    assert.strictEqual(loaded.brainstormRunId, undefined);
  });
});
