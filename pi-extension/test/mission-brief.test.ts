import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  recordDiscussion,
  finalizeMissionBrief,
  amendBullet,
  validateBriefSections,
  slugifyLabel,
  slugifyStamp,
  BRIEF_DRAFT_MARKER,
  REQUIRED_BRIEF_SECTIONS,
} from "../src/mission-brief.js";
import {
  getPreRunMissionBriefPath,
  getRunMissionBriefPath,
  getRunDiscussionsDir,
} from "../src/constants.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-mb-"));
}

describe("mission-brief", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeTmp();
  });

  it("recordDiscussion with no active run creates the brief with all required sections and a draft marker", () => {
    const loc = recordDiscussion({
      cwd,
      label: "refine mission",
      transcript: "# Q&A\n\n> q?\n> a\n",
      discussionSection: "Refined the problem statement.",
    });
    assert.strictEqual(loc.briefPath, getPreRunMissionBriefPath(cwd));
    assert.strictEqual(loc.sequence, "01");

    const brief = fs.readFileSync(loc.briefPath, "utf8");
    assert.ok(brief.startsWith(BRIEF_DRAFT_MARKER));
    for (const section of REQUIRED_BRIEF_SECTIONS) {
      assert.ok(brief.includes(section), `brief should contain section ${section}`);
    }
    assert.ok(brief.includes("## Discussions"));
    assert.ok(brief.includes("Refined the problem statement."));
  });

  it("recordDiscussion called twice produces monotonic sequence numbers", () => {
    const first = recordDiscussion({
      cwd,
      label: "first",
      transcript: "t1",
      discussionSection: "d1",
    });
    const second = recordDiscussion({
      cwd,
      label: "second",
      transcript: "t2",
      discussionSection: "d2",
    });
    assert.strictEqual(first.sequence, "01");
    assert.strictEqual(second.sequence, "02");

    const brief = fs.readFileSync(second.briefPath, "utf8");
    const matches = brief.match(/## Discussion — /g) ?? [];
    assert.strictEqual(matches.length, 2, "two ## Discussion — sections");
  });

  it("recordDiscussion with a runId writes under the run directory", () => {
    const runId = "2026-09-01-1244-test-run";
    const loc = recordDiscussion({
      cwd,
      runId,
      label: "run-discussion",
      transcript: "t",
      discussionSection: "d",
    });
    assert.strictEqual(loc.briefPath, getRunMissionBriefPath(cwd, runId));
    assert.ok(loc.transcriptPath.startsWith(getRunDiscussionsDir(cwd, runId)));
  });

  it("finalizeMissionBrief removes the first-line marker", () => {
    const briefPath = path.join(cwd, "mission-brief.md");
    fs.writeFileSync(briefPath, `${BRIEF_DRAFT_MARKER}body`, "utf8");
    finalizeMissionBrief(briefPath);
    const after = fs.readFileSync(briefPath, "utf8");
    assert.ok(!after.startsWith(BRIEF_DRAFT_MARKER));
    assert.ok(after.endsWith("body"));
  });

  it("finalizeMissionBrief is a no-op when the file is missing", () => {
    assert.doesNotThrow(() => finalizeMissionBrief(path.join(cwd, "missing.md")));
  });

  it("amendBullet crosses out the first matching bullet and appends a replacement", () => {
    const brief = "## Success criteria\n- ship feature\n- keep tests green\n";
    const amended = amendBullet(brief, "ship feature", "ship feature, with tests");
    assert.ok(amended.includes("~~ship feature~~"));
    assert.ok(amended.includes("- ship feature, with tests"));
    assert.ok(amended.includes("- keep tests green"));
  });

  it("amendBullet appends without crossing out when no match exists", () => {
    const brief = "## Success criteria\n- ship feature\n";
    const amended = amendBullet(brief, "absent bullet", "new bullet");
    assert.ok(!amended.includes("~~absent bullet~~"));
    assert.ok(amended.includes("- new bullet"));
  });

  it("validateBriefSections returns missing sections for a stub file", () => {
    const brief = `${BRIEF_DRAFT_MARKER}## Problem statement\n\n_TBD_\n`;
    const missing = validateBriefSections(brief);
    assert.ok(missing.length === REQUIRED_BRIEF_SECTIONS.length - 1);
    assert.ok(missing.includes("## Mission type"));
  });

  it("validateBriefSections returns [] for a fully populated brief", () => {
    let brief = BRIEF_DRAFT_MARKER;
    for (const s of REQUIRED_BRIEF_SECTIONS) brief += `${s}\n\ncontent\n`;
    assert.deepStrictEqual(validateBriefSections(brief), []);
  });

  it("validateBriefSections enforces order", () => {
    // Sections present but out of order → "## Mission type" appears before
    // "## Problem statement". The cursor advances after the first section,
    // so when we look for "## Mission type" at the later cursor it's gone.
    const reordered = [
      "## Mission type",
      "## Problem statement",
      ...REQUIRED_BRIEF_SECTIONS.slice(2),
    ].join("\n\n");
    const missing = validateBriefSections(reordered);
    assert.ok(missing.includes("## Mission type"), "out-of-order section flagged as missing");
  });

  it("slugifyLabel falls back to 'discussion' for empty/punctuation-only input", () => {
    assert.strictEqual(slugifyLabel(""), "discussion");
    assert.strictEqual(slugifyLabel("///"), "discussion");
  });

  it("slugifyLabel normalizes case and dashes", () => {
    assert.strictEqual(slugifyLabel("Refine Mission!"), "refine-mission");
    assert.strictEqual(slugifyLabel("  multi  word  "), "multi-word");
  });

  it("slugifyLabel truncates at 40 chars and never ends with a dash", () => {
    const long = "a".repeat(60);
    const out = slugifyLabel(long);
    assert.ok(out.length <= 40);
    assert.ok(!out.endsWith("-"), `slug ends with dash: '${out}'`);
  });

  it("slugifyStamp produces zero-padded YYYY-MM-DD-HH-MM", () => {
    const stamp = slugifyStamp(new Date(2026, 8, 1, 9, 5)); // 0-indexed month
    assert.strictEqual(stamp, "2026-09-01-09-05");
  });

  it("per-run transcripts never spill between runs", () => {
    const runA = "run-aaa";
    const runB = "run-bbb";
    recordDiscussion({ cwd, runId: runA, label: "a", transcript: "ta", discussionSection: "da" });
    recordDiscussion({ cwd, runId: runB, label: "b", transcript: "tb", discussionSection: "db" });
    const aDir = getRunDiscussionsDir(cwd, runA);
    const bDir = getRunDiscussionsDir(cwd, runB);
    assert.ok(fs.readdirSync(aDir).some((n) => /^discussion-01-/.test(n)));
    assert.ok(fs.readdirSync(bDir).some((n) => /^discussion-01-/.test(n)));
    // No cross-contamination.
    assert.ok(!fs.readdirSync(aDir).some((n) => /-b\.md$/.test(n)));
    assert.ok(!fs.readdirSync(bDir).some((n) => /-a\.md$/.test(n)));
  });
});