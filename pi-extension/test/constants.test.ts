import { describe, it } from "node:test";
import assert from "node:assert";
import * as path from "node:path";
import {
  getOrchestraDir,
  getStatePath,
  getRunDir,
  getArtifactPaths,
  makeRunId,
  STAGE_TRANSITIONS,
  formatStageStatus,
} from "../src/constants.js";

describe("constants", () => {
  const cwd = "/fake/project";

  it("getOrchestraDir returns .pi/orchestra under cwd", () => {
    assert.strictEqual(getOrchestraDir(cwd), path.join(cwd, ".pi/orchestra"));
  });

  it("getStatePath returns state.json under orchestra dir", () => {
    assert.strictEqual(
      getStatePath(cwd),
      path.join(cwd, ".pi/orchestra/state.json"),
    );
  });

  it("getRunDir returns run-specific directory", () => {
    assert.strictEqual(
      getRunDir(cwd, "2026-06-12-hello"),
      path.join(cwd, ".pi/orchestra/runs/2026-06-12-hello"),
    );
  });

  it("getArtifactPaths returns all artifact paths for a run", () => {
    const artifacts = getArtifactPaths(cwd, "run-1");
    assert.strictEqual(artifacts.plan, path.join(cwd, ".pi/orchestra/runs/run-1/plan.md"));
    assert.strictEqual(
      artifacts.discussionNotes,
      path.join(cwd, ".pi/orchestra/runs/run-1/discussion-notes.md"),
    );
    assert.strictEqual(
      artifacts.scoutAngle1,
      path.join(cwd, ".pi/orchestra/runs/run-1/scout-angle_1.md"),
    );
    assert.strictEqual(
      artifacts.reviewCorrectness,
      path.join(cwd, ".pi/orchestra/runs/run-1/review-correctness.md"),
    );
    assert.strictEqual(
      artifacts.securityReport,
      path.join(cwd, ".pi/orchestra/runs/run-1/security-report.md"),
    );
  });

  it("makeRunId creates a slug from mission and date", () => {
    const runId = makeRunId("Build a hello world CLI");
    assert.match(runId, /^\d{4}-\d{2}-\d{2}-build-a-hello-world-cli$/);
  });

  it("makeRunId falls back to run when mission is empty", () => {
    const runId = makeRunId("");
    assert.match(runId, /^\d{4}-\d{2}-\d{2}-run$/);
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
    assert.ok(status.includes("/orchestra-plan"));
  });
});
