import { describe, it } from "node:test";
import assert from "node:assert";
import * as path from "node:path";
import { loadSkill, buildStagePrompt } from "../src/prompt.js";
import type { OrchestraState } from "../src/state.js";

describe("prompt", () => {
  const cwd = "/fake/project";

  it("loadSkill reads the plan skill file", () => {
    const skill = loadSkill("plan");
    assert.ok(skill.includes("Plan Stage"));
    assert.ok(skill.includes("scout-1"));
  });

  it("loadSkill returns fallback when skill file is missing", () => {
    const skill = loadSkill("nonexistent");
    assert.ok(skill.includes("No detailed skill file found"));
  });

  it("buildStagePrompt includes mission and artifact paths", () => {
    const state: OrchestraState = {
      version: 1,
      mission: "Build CLI",
      runId: "run-1",
      currentStage: "planning",
      startedAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
      stageResults: {},
    };

    const { prompt, context } = buildStagePrompt(cwd, state, "plan");

    assert.strictEqual(context.mission, "Build CLI");
    assert.strictEqual(context.runId, "run-1");
    assert.strictEqual(context.stage, "plan");
    assert.strictEqual(
      context.artifacts.plan,
      path.join(cwd, ".IDE_Plans/orchestra/runs/run-1/plan/plan.md"),
    );
    assert.strictEqual(
      context.artifacts.planOverview,
      path.join(cwd, ".IDE_Plans/orchestra/runs/run-1/plan/plan-overview.md"),
    );
    assert.ok(prompt.includes("plan-overview.md"));

    assert.ok(prompt.includes('<pi-orchestra stage="plan">'));
    assert.ok(prompt.includes("Mission: Build CLI"));
    assert.ok(prompt.includes("Run ID: run-1"));
    assert.ok(prompt.includes("Plan Stage"));
  });

  it("buildStagePrompt uses default artifact paths when runId is empty", () => {
    const state: OrchestraState = {
      version: 1,
      mission: "",
      runId: "",
      currentStage: "none",
      startedAt: "",
      updatedAt: "",
      stageResults: {},
    };

    const { context } = buildStagePrompt(cwd, state, "implement");
    assert.ok(context.artifacts.plan.includes("<run-id>"));
  });
});
