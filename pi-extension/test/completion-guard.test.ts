import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  completionWarning,
  extractArtifactPaths,
  recordSpawnArtifacts,
  resetCompletionGuard,
} from "../src/completion-guard.js";
import { defaultState, saveState } from "../src/state.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "completion-guard-"));
}

function setupActiveRun(cwd: string, runId = "r1"): void {
  saveState(cwd, { ...defaultState(), currentStage: "planning", runId });
}

const COMPLETED = 'Sub-agent "scout-2" completed (1m 12s).\n\nDone.';

describe("extractArtifactPaths", () => {
  it("pulls run-dir paths out of a task string and dedupes them", () => {
    const task =
      "Write to .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md. " +
      "Read .IDE_Plans/pi-senai/runs/r1/plan/plan.md and .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md.";
    const paths = extractArtifactPaths(task, "r1");
    assert.deepStrictEqual(paths, [
      ".IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md",
      ".IDE_Plans/pi-senai/runs/r1/plan/plan.md",
    ]);
  });

  it("returns an empty list when the task mentions no run paths", () => {
    assert.deepStrictEqual(extractArtifactPaths("Write README.md", "r1"), []);
  });
});

describe("recordSpawnArtifacts", () => {
  beforeEach(() => resetCompletionGuard());

  it("ignores non-spawn tools", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts(
      "write",
      { file_path: ".IDE_Plans/pi-senai/runs/r1/plan/plan.md" },
      cwd,
    );
    assert.strictEqual(completionWarning(COMPLETED, cwd), undefined);
  });

  it("ignores spawns when no run is active", () => {
    const cwd = makeTmp();
    recordSpawnArtifacts(
      "subagent",
      { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md" },
      cwd,
    );
    assert.strictEqual(completionWarning(COMPLETED, cwd), undefined);
  });
});

describe("completionWarning", () => {
  beforeEach(() => resetCompletionGuard());

  it("returns undefined for non-completion text", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    assert.strictEqual(completionWarning("hello world", cwd), undefined);
  });

  it("returns undefined for failed outcomes", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts(
      "subagent",
      { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md" },
      cwd,
    );
    assert.strictEqual(
      completionWarning('Sub-agent "scout-2" failed (exit code 1).', cwd),
      undefined,
    );
  });

  it("returns undefined when the artifact exists and is non-empty", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts(
      "subagent",
      { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md" },
      cwd,
    );
    const artifact = path.join(cwd, ".IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md");
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, "# report\n", "utf8");
    assert.strictEqual(completionWarning(COMPLETED, cwd), undefined);
  });

  it("warns when the artifact file does not exist", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts(
      "subagent",
      { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md" },
      cwd,
    );
    const warning = completionWarning(COMPLETED, cwd);
    assert.ok(warning, "warning returned");
    assert.ok(warning.includes("scout-angle_2.md"), "names the missing artifact");
    assert.ok(warning.includes("subagent_resume"), "tells the parent to resume");
  });

  it("warns when the artifact file is empty", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts(
      "subagent",
      { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md" },
      cwd,
    );
    const artifact = path.join(cwd, ".IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md");
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, "", "utf8");
    assert.ok(completionWarning(COMPLETED, cwd), "empty file counts as missing");
  });

  it("returns undefined for completions of unknown subagents", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    assert.strictEqual(
      completionWarning('Sub-agent "unknown-agent" completed (5s).', cwd),
      undefined,
    );
  });

  it("never throws on corrupt state", () => {
    const cwd = makeTmp();
    fs.mkdirSync(path.join(cwd, ".IDE_Plans/pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".IDE_Plans/pi-senai/state.json"), "{not json", "utf8");
    recordSpawnArtifacts("subagent", { name: "x", task: ".IDE_Plans/pi-senai/runs/r1/plan/plan.md" }, cwd);
    assert.strictEqual(completionWarning(COMPLETED, cwd), undefined);
  });
});

describe("recordSpawnArtifacts edge cases", () => {
  beforeEach(() => resetCompletionGuard());

  it("records spawns via subagent_resume too", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts(
      "subagent_resume",
      { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md" },
      cwd,
    );
    const warning = completionWarning(COMPLETED, cwd);
    assert.ok(warning, "resume-spawned agent with missing artifact must warn");
    assert.ok(warning.includes("scout-angle_2.md"));
  });

  it("records nothing when the name is empty", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts(
      "subagent",
      { name: "", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md" },
      cwd,
    );
    assert.strictEqual(completionWarning(COMPLETED, cwd), undefined);
  });

  it("records nothing when the task is empty", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts("subagent", { name: "scout-2", task: "" }, cwd);
    assert.strictEqual(completionWarning(COMPLETED, cwd), undefined);
  });

  it("does not record spawns during the delivered stage", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    saveState(cwd, { ...defaultState(), currentStage: "delivered", runId: "r1" });
    recordSpawnArtifacts(
      "subagent",
      { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md" },
      cwd,
    );
    assert.strictEqual(completionWarning(COMPLETED, cwd), undefined);
  });

  it("warns listing only the missing artifact when a multi-artifact spawn partially completes", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts(
      "subagent",
      {
        name: "scout-2",
        task:
          "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md " +
          "and .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_3.md",
      },
      cwd,
    );
    const written = path.join(cwd, ".IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md");
    fs.mkdirSync(path.dirname(written), { recursive: true });
    fs.writeFileSync(written, "# report\n", "utf8");
    const warning = completionWarning(COMPLETED, cwd);
    assert.ok(warning, "partial completion must warn");
    assert.ok(warning.includes("scout-angle_3.md"), "names the missing artifact");
    assert.ok(!warning.includes("scout-angle_2.md"), "does not name the written artifact");
  });

  it("re-spawning the same name overwrites the earlier record", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    recordSpawnArtifacts(
      "subagent",
      { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md" },
      cwd,
    );
    recordSpawnArtifacts(
      "subagent",
      { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_3.md" },
      cwd,
    );
    // The old path is written; only the re-recorded path is missing.
    const oldArtifact = path.join(cwd, ".IDE_Plans/pi-senai/runs/r1/plan/scouts/scout-angle_2.md");
    fs.mkdirSync(path.dirname(oldArtifact), { recursive: true });
    fs.writeFileSync(oldArtifact, "# old\n", "utf8");
    const warning = completionWarning(COMPLETED, cwd);
    assert.ok(warning, "latest record is checked");
    assert.ok(warning.includes("scout-angle_3.md"), "checks the re-recorded path");
    assert.ok(!warning.includes("scout-angle_2.md"), "the overwritten record is gone");
  });
});

describe("extractArtifactPaths edge cases", () => {
  it("handles a runId containing regex characters", () => {
    const runId = "r1.x+";
    const task = "Write .IDE_Plans/pi-senai/runs/r1.x+/plan/plan.md now.";
    assert.deepStrictEqual(extractArtifactPaths(task, runId), [
      ".IDE_Plans/pi-senai/runs/r1.x+/plan/plan.md",
    ]);
    // A lookalike path that an unescaped `.`/`+` pattern would also match is
    // NOT extracted — proves the run dir is regex-escaped.
    const lookalike = "Write .IDE_Plans/pi-senai/runs/r1Xx+/plan/plan.md now.";
    assert.deepStrictEqual(extractArtifactPaths(lookalike, runId), []);
  });

  // The run-dir normalization (`.replace(/\\/g, "/")` in extractArtifactPaths)
  // covers Windows path.join output; on Linux path.join never emits "\\", so
  // only the forward-slash form is exercisable here.
  it("extracts forward-slash task paths with a regex-char runId", () => {
    const runId = "r1.x+";
    const paths = extractArtifactPaths(
      "Read .IDE_Plans/pi-senai/runs/r1.x+/plan/plan.md and write .IDE_Plans/pi-senai/runs/r1.x+/plan/plan-overview.md.",
      runId,
    );
    assert.deepStrictEqual(paths, [
      ".IDE_Plans/pi-senai/runs/r1.x+/plan/plan.md",
      ".IDE_Plans/pi-senai/runs/r1.x+/plan/plan-overview.md",
    ]);
  });
});
