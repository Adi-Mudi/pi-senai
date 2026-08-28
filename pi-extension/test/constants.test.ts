import { describe, it } from "node:test";
import assert from "node:assert";
import * as path from "node:path";
import {
  getSenaiDir,
  getStatePath,
  getRunDir,
  getArtifactPaths,
  getDefaultArtifactPaths,
  makeRunId,
  STAGES,
  STAGE_TRANSITIONS,
  formatStageStatus,
  getArchitectStateDir,
  getArchitectMapDir,
} from "../src/constants.js";

describe("constants", () => {
  const cwd = "/fake/project";

  it("getSenaiDir returns .IDE_Plans/senai under cwd", () => {
    assert.strictEqual(getSenaiDir(cwd), path.join(cwd, ".IDE_Plans/senai"));
  });

  it("getArchitectStateDir returns .pi/architect under cwd", () => {
    assert.strictEqual(getArchitectStateDir(cwd), path.join(cwd, ".pi/architect"));
  });

  it("getArchitectMapDir returns .IDE_Plans/architect-map under cwd", () => {
    assert.strictEqual(getArchitectMapDir(cwd), path.join(cwd, ".IDE_Plans/architect-map"));
  });

  it("getStatePath returns state.json under senai dir", () => {
    assert.strictEqual(
      getStatePath(cwd),
      path.join(cwd, ".IDE_Plans/senai/state.json"),
    );
  });

  it("getRunDir returns run-specific directory", () => {
    assert.strictEqual(
      getRunDir(cwd, "2026-06-12-hello"),
      path.join(cwd, ".IDE_Plans/senai/runs/2026-06-12-hello"),
    );
  });

  it("getArtifactPaths returns all artifact paths for a run", () => {
    const artifacts = getArtifactPaths(cwd, "run-1");

    assert.strictEqual(artifacts.runDir, path.join(cwd, ".IDE_Plans/senai/runs/run-1"));
    assert.strictEqual(artifacts.planDir, path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan"));
    assert.strictEqual(
      artifacts.planScoutsDir,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/scouts"),
    );
    assert.strictEqual(
      artifacts.planReviewsDir,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/reviews"),
    );
    assert.strictEqual(
      artifacts.implementDir,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/implement"),
    );
    assert.strictEqual(
      artifacts.documentDir,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/document"),
    );
    assert.strictEqual(
      artifacts.deliverDir,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/deliver"),
    );

    assert.strictEqual(artifacts.plan, path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/plan.md"));
    assert.strictEqual(
      artifacts.planOverview,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/plan-overview.md"),
    );
    assert.strictEqual(
      artifacts.discussionNotes,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/discussion-notes.md"),
    );
    assert.strictEqual(
      artifacts.scoutAngle1,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/scouts/scout-angle_1.md"),
    );
    assert.strictEqual(
      artifacts.scoutAngle4,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/scouts/scout-angle_4.md"),
    );
    assert.strictEqual(
      artifacts.reviewCorrectness,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/reviews/review-correctness.md"),
    );
    assert.strictEqual(
      artifacts.securityReport,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/deliver/security-report.md"),
    );
  });

  it("getDefaultArtifactPaths returns placeholder paths", () => {
    const artifacts = getDefaultArtifactPaths();
    assert.ok(artifacts.runDir.includes("<run-id>"));
    assert.ok(artifacts.plan.includes("<run-id>/plan/plan.md"));
  });

  it("makeRunId creates a slug from mission and date", () => {
    const runId = makeRunId("Build a hello world CLI");
    assert.match(runId, /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-build-a-hello-world-cli$/);
  });

  it("makeRunId falls back to run when mission is empty", () => {
    const runId = makeRunId("");
    assert.match(runId, /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-run$/);
  });

  it("makeRunId strips special characters", () => {
    const runId = makeRunId("Feature @ #1: API & Auth!!!");
    assert.match(runId, /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-feature-1-api-auth$/);
  });

  it("makeRunId truncates very long missions", () => {
    const runId = makeRunId("a".repeat(200));
    const slug = runId.split("-").slice(5).join("-");
    assert.strictEqual(slug.length, 40);
  });

  it("STAGE_TRANSITIONS defines a linear workflow", () => {
    assert.deepStrictEqual(STAGE_TRANSITIONS.none, ["planning"]);
    assert.deepStrictEqual(STAGE_TRANSITIONS.planning, ["planned"]);
    assert.deepStrictEqual(STAGE_TRANSITIONS.planned, ["implementing"]);
    assert.deepStrictEqual(STAGE_TRANSITIONS.implementing, ["implemented"]);
    assert.deepStrictEqual(STAGE_TRANSITIONS.implemented, ["documenting"]);
    assert.deepStrictEqual(STAGE_TRANSITIONS.documenting, ["documented"]);
    assert.deepStrictEqual(STAGE_TRANSITIONS.documented, ["delivering"]);
    assert.deepStrictEqual(STAGE_TRANSITIONS.delivering, ["delivered"]);
    assert.deepStrictEqual(STAGE_TRANSITIONS.delivered, []);
  });

  it("formatStageStatus includes stage, mission, and runId", () => {
    const status = formatStageStatus({
      currentStage: "planning",
      mission: "test mission",
      runId: "run-1",
    });
    assert.ok(status.includes("Active stage: planning"));
    assert.ok(status.includes("Mission: test mission"));
    assert.ok(status.includes("Run ID: run-1"));
    assert.ok(status.includes("/senai-plan"));
  });

  it("formatStageStatus omits missing mission and runId", () => {
    const status = formatStageStatus({ currentStage: "none" });
    assert.ok(status.includes("Active stage: none"));
    assert.ok(!status.includes("Mission:"));
    assert.ok(!status.includes("Run ID:"));
  });

  it("makeRunId strips unicode and emoji from the mission slug", () => {
    const runId = makeRunId("Fix the 🚀 login बग");
    assert.match(runId, /^[a-z0-9-]+$/);
  });

  it("formatStageStatus shows runId when mission is missing", () => {
    const status = formatStageStatus({ currentStage: "planning", runId: "run-1" });
    assert.ok(status.includes("Run ID: run-1"));
    assert.ok(!status.includes("Mission:"));
  });

  it("STAGE_TRANSITIONS has an entry for every stage", () => {
    for (const stage of STAGES) {
      assert.ok(Array.isArray(STAGE_TRANSITIONS[stage]), `Missing transitions for ${stage}`);
    }
  });

  it("makeRunId falls back to run when the mission has no slug characters", () => {
    const runId = makeRunId("!!!");
    assert.match(runId, /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-run$/);
  });

  it("makeRunId cuts the slug at exactly 40 characters", () => {
    // A 40-character slug stays whole.
    const exact = makeRunId("a".repeat(40));
    const exactSlug = exact.split("-").slice(5).join("-");
    assert.strictEqual(exactSlug, "a".repeat(40));

    // A 41-character slug is cut at 40.
    const longer = makeRunId("a".repeat(41));
    const longerSlug = longer.split("-").slice(5).join("-");
    assert.strictEqual(longerSlug, "a".repeat(40));

    // A cut that lands on a dash leaves a trailing "-", which the final
    // cleanup strips — a truncated slug never ends in a dash.
    const dashed = makeRunId(`${"a".repeat(39)}!bbbb`);
    const dashedSlug = dashed.split("-").slice(5).join("-");
    assert.strictEqual(dashedSlug, "a".repeat(39));
  });

  it("makeRunId strips pasted temp paths and UUID/hex noise from the slug", () => {
    const runId = makeRunId("q1 /tmp/pi-clipboard-cbcbf548-849e-4918-a927-x/y fix");
    const slug = runId.split("-").slice(5).join("-");
    assert.ok(!slug.includes("tmp"), `slug should not contain tmp: ${slug}`);
    assert.ok(!slug.includes("clipboard"), `slug should not contain clipboard: ${slug}`);
    assert.ok(!/[0-9a-f]{8}/.test(slug.replace(/^[0-9]+-/g, "")), `slug should not contain hex noise: ${slug}`);
    assert.ok(slug.startsWith("q1"), `slug should keep the real words: ${slug}`);
    assert.ok(slug.endsWith("fix"), `slug should keep the real words: ${slug}`);
  });

  it("makeRunId falls back to run when the mission is only a uuid", () => {
    // Note: a mission that is only a "/tmp/..." path leaves a short "tm"
    // remnant (the path regex starts at the first letter before a slash);
    // the slug is still short and free of path/uuid noise.
    const runId = makeRunId("cbcbf548-849e-4918-a927-2f9e0c1d3b4a");
    assert.match(runId, /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-run$/);
  });

  it("makeRunId keeps long plain words that only use hex letters", () => {
    // The hex-noise rule must not eat legitimate words like "deadbeef..."
    // when they contain no digit — an all-"a" mission keeps its full slug.
    const runId = makeRunId("a".repeat(30));
    const slug = runId.split("-").slice(5).join("-");
    assert.strictEqual(slug, "a".repeat(30));
  });

  it("getArtifactPaths returns all 19 fields", () => {
    const artifacts = getArtifactPaths(cwd, "run-1");
    const keys = Object.keys(artifacts).sort();
    assert.deepStrictEqual(keys, [
      "deliverDir",
      "deliverSummary",
      "discussionNotes",
      "documentDir",
      "implementDir",
      "plan",
      "planDir",
      "planOverview",
      "planReviewsDir",
      "planScoutsDir",
      "reviewCorrectness",
      "reviewSecurity",
      "reviewTests",
      "runDir",
      "scoutAngle1",
      "scoutAngle2",
      "scoutAngle3",
      "scoutAngle4",
      "securityReport",
    ]);
    const runDir = path.join(cwd, ".IDE_Plans/senai/runs/run-1");
    assert.strictEqual(artifacts.scoutAngle2, path.join(runDir, "plan/scouts/scout-angle_2.md"));
    assert.strictEqual(artifacts.scoutAngle3, path.join(runDir, "plan/scouts/scout-angle_3.md"));
    assert.strictEqual(artifacts.reviewSecurity, path.join(runDir, "plan/reviews/review-security.md"));
    assert.strictEqual(artifacts.reviewTests, path.join(runDir, "plan/reviews/review-tests.md"));
    assert.strictEqual(artifacts.deliverSummary, path.join(runDir, "deliver/deliver-summary.md"));
  });

  it("formatStageStatus shows the mission line without a runId line", () => {
    const status = formatStageStatus({ currentStage: "planning", mission: "test mission" });
    assert.ok(status.includes("Mission: test mission"));
    assert.ok(!status.includes("Run ID:"));
  });

  it("makeRunId strips Windows paths from the mission slug", () => {
    const runId = makeRunId("C:\\Users\\foo\\bar fix");
    const slug = runId.split("-").slice(5).join("-");
    assert.strictEqual(slug, "fix", "Windows path token must be stripped, real words kept");
  });

  it("makeRunId drops the './' prefix of a relative path but keeps the name", () => {
    // NOTE: the gap analysis expected a "run" fallback here, but the path-token
    // regex only fires on a letter before the slash; "./" is dropped by the
    // generic non-alphanumeric stripper instead. Verified against dist on
    // 2026-08-28 — this pins the actual behavior.
    const runId = makeRunId("./relative");
    const slug = runId.split("-").slice(5).join("-");
    assert.strictEqual(slug, "relative");
  });

  it("makeRunId falls back to run for a unicode-only mission", () => {
    const runId = makeRunId("日本語のみ");
    const slug = runId.split("-").slice(5).join("-");
    assert.strictEqual(slug, "run");
  });
});
