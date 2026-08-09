import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkill, buildStagePrompt, resolveSkillPath } from "../src/prompt.js";
import { saveAgentConfig } from "../src/agent-config.js";
import { saveFilesConfig } from "../src/files-config.js";
import { saveAgentsFilesConfig } from "../src/agents-files-config.js";
import type { SenaiState } from "../src/state.js";

describe("prompt", () => {
  const cwd = "/fake/project";
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-prompt-test-"));
  });

  function makeState(stage: string, runId: string): SenaiState {
    return {
      version: 1,
      mission: "Build CLI",
      runId,
      currentStage: stage as SenaiState["currentStage"],
      startedAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
      stageResults: {},
    };
  }

  it("loadSkill reads the plan skill file", () => {
    const skill = loadSkill("plan");
    assert.ok(skill.includes("Plan Stage"));
    assert.ok(skill.includes("scout-1"));
    assert.ok(skill.includes("scout-4"));
  });

  it("loadSkill reads the implement skill file", () => {
    const skill = loadSkill("implement");
    assert.ok(skill.includes("Implement Stage"));
    assert.ok(skill.includes("implementer"));
  });

  it("loadSkill reads the document skill file", () => {
    const skill = loadSkill("document");
    assert.ok(skill.includes("Document Stage"));
    assert.ok(skill.includes("readme-writer"));
  });

  it("loadSkill reads the deliver skill file", () => {
    const skill = loadSkill("deliver");
    assert.ok(skill.includes("Deliver Stage"));
    assert.ok(skill.includes("security-gate"));
  });

  it("loadSkill returns fallback when skill file is missing", () => {
    const skill = loadSkill("nonexistent");
    assert.ok(skill.includes("No detailed skill file found"));
  });

  it("loadSkill strips YAML frontmatter", () => {
    const skill = loadSkill("plan");
    assert.ok(!skill.startsWith("---"));
    assert.ok(skill.includes("# Plan Stage"));
  });

  it("buildStagePrompt includes mission and artifact paths", () => {
    const state = makeState("planning", "run-1");

    const { prompt, context } = buildStagePrompt(cwd, state, "plan");

    assert.strictEqual(context.mission, "Build CLI");
    assert.strictEqual(context.runId, "run-1");
    assert.strictEqual(context.stage, "plan");
    assert.strictEqual(
      context.artifacts.plan,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/plan.md"),
    );
    assert.strictEqual(
      context.artifacts.planOverview,
      path.join(cwd, ".IDE_Plans/senai/runs/run-1/plan/plan-overview.md"),
    );
    assert.ok(prompt.includes("plan-overview.md"));

    assert.ok(prompt.includes('<pi-senai stage="plan">'));
    assert.ok(prompt.includes("Mission: Build CLI"));
    assert.ok(prompt.includes("Run ID: run-1"));
    assert.ok(prompt.includes("Plan Stage"));
    assert.ok(prompt.includes("scout-angle_4.md"));
  });

  it("buildStagePrompt includes the agent registry block with defaults", () => {
    const state = makeState("planning", "run-1");
    const { prompt } = buildStagePrompt(cwd, state, "plan");

    assert.ok(prompt.includes("## Agent Registry"));
    assert.ok(prompt.includes("For this project, use these agent names when spawning subagents:"));
    assert.ok(prompt.includes("- Planner (planner) (default) → planner"));
    assert.ok(prompt.includes("- Implementer (implementer) (default) → worker"));
    assert.ok(prompt.includes("If a role is not listed above, use the default agent name."));
  });

  it("buildStagePrompt uses custom agents from config", () => {
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { planner: "custom-planner", implementer: "custom-coder" },
    });
    const state = makeState("planning", "run-1");
    const { prompt } = buildStagePrompt(tmpDir, state, "plan");

    assert.ok(prompt.includes("- Planner (planner) → custom-planner"));
    assert.ok(prompt.includes("- Implementer (implementer) → custom-coder"));
    assert.ok(prompt.includes("- Scout 1 — Architecture / big-picture (scout-1) (default) → scout"));
  });

  it("buildStagePrompt uses default artifact paths when runId is empty", () => {
    const state: SenaiState = {
      version: 1,
      mission: "",
      runId: "",
      currentStage: "none",
      startedAt: "",
      updatedAt: "",
      stageResults: {},
    };

    const { context, prompt } = buildStagePrompt(cwd, state, "implement");
    assert.ok(context.artifacts.plan.includes("<run-id>"));
    assert.ok(prompt.includes("Mission: (none)"));
    assert.ok(prompt.includes("Run ID: (none)"));
  });

  it("buildStagePrompt constructs prompts for every stage", () => {
    const stages = ["plan", "implement", "document", "deliver"];
    for (const stage of stages) {
      const state = makeState("planning", `run-${stage}`);
      const { prompt, context } = buildStagePrompt(cwd, state, stage);
      assert.ok(prompt.includes(`<pi-senai stage="${stage}">`));
      assert.strictEqual(context.stage, stage);
      assert.ok(context.artifacts.runDir.includes(`.IDE_Plans/senai/runs/run-${stage}`));
    }
  });

  it("buildStagePrompt includes Document Scope block when configured", () => {
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: ["README.md"],
      testPaths: [],
      excludedPaths: [],
    });
    saveAgentsFilesConfig(tmpDir, {
      version: 1,
      documents: { planner: { primary: "Doc/planner.md", reads: ["Doc/plan.md"] } },
    });

    const state = makeState("planning", "run-scope");
    const { prompt } = buildStagePrompt(tmpDir, state, "plan");
    assert.ok(prompt.includes("## Document Scope"));
    assert.ok(prompt.includes("Doc/planner.md"));
    assert.ok(prompt.includes("Doc/plan.md"));
    assert.ok(prompt.includes("README.md"));
    assert.ok(prompt.includes("Verification rule"));
  });

  it("buildStagePrompt shows fallback when only files config exists", () => {
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: ["README.md"],
      testPaths: [],
      excludedPaths: [],
    });

    const state = makeState("planning", "run-scope");
    const { prompt } = buildStagePrompt(tmpDir, state, "plan");
    assert.ok(prompt.includes("## Document Scope"));
    assert.ok(prompt.includes("Default project context"));
    assert.ok(!prompt.includes("Per-agent document assignments"));
  });

  it("buildStagePrompt handles missing configs gracefully", () => {
    saveAgentConfig(tmpDir, { version: 1, agents: {} });

    const state = makeState("planning", "run-scope");
    const { prompt } = buildStagePrompt(tmpDir, state, "plan");
    assert.ok(prompt.includes("## Document Scope"));
    assert.ok(prompt.includes("No default project files configured"));
  });

  it("buildStagePrompt shows comparison reads for a role without a truth document", () => {
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: ["README.md"],
      testPaths: [],
      excludedPaths: [],
    });
    saveAgentsFilesConfig(tmpDir, {
      version: 1,
      documents: { planner: { reads: ["Doc/plan.md"] } },
    });

    const state = makeState("planning", "run-scope");
    const { prompt } = buildStagePrompt(tmpDir, state, "plan");
    assert.ok(prompt.includes('reads="Doc/plan.md"'));
    assert.ok(!prompt.includes("truth="));
  });

  it("buildStagePrompt for the deliver stage includes deliver artifact paths", () => {
    const state = makeState("delivering", "run-deliver");
    const { prompt } = buildStagePrompt(tmpDir, state, "deliver");
    assert.ok(prompt.includes("security-report.md"));
    assert.ok(prompt.includes("deliver-summary.md"));
  });

  it("buildStagePrompt shows the no-files fallback when all files config arrays are empty", () => {
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: [],
      testPaths: [],
      excludedPaths: [],
    });

    const state = makeState("planning", "run-empty");
    const { prompt } = buildStagePrompt(tmpDir, state, "plan");
    assert.ok(prompt.includes("## Document Scope"));
    assert.ok(prompt.includes("No default project files configured"));
    assert.ok(!prompt.includes("Default project context"));
  });

  it("buildStagePrompt skips the per-agent section when documents are empty", () => {
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: ["README.md"],
      testPaths: [],
      excludedPaths: [],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    const state = makeState("planning", "run-scope");
    const { prompt } = buildStagePrompt(tmpDir, state, "plan");
    assert.ok(!prompt.includes("Per-agent document assignments"));
    assert.ok(prompt.includes("Default project context"));
    assert.ok(prompt.includes("README.md"));
  });

  it("buildStagePrompt shows truth without reads when reads is an empty array", () => {
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { planner: { primary: "Doc/planner.md", reads: [] } },
    });

    const state = makeState("planning", "run-scope");
    const { prompt } = buildStagePrompt(tmpDir, state, "plan");
    assert.ok(prompt.includes('truth="Doc/planner.md"'));
    assert.ok(!prompt.includes("reads="));
  });

  it("buildStagePrompt falls back to placeholder skill text for an unknown stage", () => {
    const state = makeState("planning", "run-bogus");
    const { prompt, skill } = buildStagePrompt(cwd, state, "bogus");
    assert.ok(skill.includes("# Senai bogus stage"));
    assert.ok(skill.includes("No detailed skill file found"));
    assert.ok(prompt.includes('<pi-senai stage="bogus">'));
    assert.ok(prompt.includes("No detailed skill file found"));
  });
});

describe("coverage audit gaps", () => {
  it("resolveSkillPath returns the first candidate when no candidate file exists", () => {
    // The compiled prompt.js sits at dist/pi-extension/src, so the first
    // candidate is <repo-root>/skills/senai-<stage>.md — same depth as this
    // compiled test file at dist/pi-extension/test.
    const expected = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
      "skills",
      "senai-no-such-stage.md",
    );
    const resolved = resolveSkillPath("no-such-stage");
    assert.strictEqual(resolved, expected);
    assert.ok(!fs.existsSync(resolved), "no candidate should exist for a made-up stage");
  });

  it("loadSkill re-throws non-ENOENT read errors", () => {
    // A directory at the skill path makes readFileSync fail with EISDIR,
    // which must propagate instead of producing the fallback text.
    const skillPath = resolveSkillPath("eisdir-probe");
    fs.mkdirSync(skillPath, { recursive: true });
    try {
      assert.throws(
        () => loadSkill("eisdir-probe"),
        (err: any) => err.code === "EISDIR",
      );
    } finally {
      fs.rmSync(skillPath, { recursive: true, force: true });
    }
  });
});
