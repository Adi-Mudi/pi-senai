import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildSenaiCompactionSummary } from "../src/compaction.js";
import { startRun, advanceStage } from "../src/state.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("compaction", () => {
  it("returns null when no senai run is active", () => {
    const tmpDir = makeTmpDir("pi-senai-compaction-none-");
    assert.strictEqual(buildSenaiCompactionSummary(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null while a fresh run has not entered a stage yet", () => {
    const tmpDir = makeTmpDir("pi-senai-compaction-fresh-");
    startRun(tmpDir, "Build CLI");
    assert.strictEqual(buildSenaiCompactionSummary(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("summarizes run id, stage, and artifact paths when a run is active", () => {
    const tmpDir = makeTmpDir("pi-senai-compaction-run-");
    const state = startRun(tmpDir, "Build CLI");
    const advance = advanceStage(tmpDir, state, "planning");
    assert.ok(advance.ok);

    const summary = buildSenaiCompactionSummary(tmpDir);

    assert.ok(summary);
    assert.ok(summary.includes(`Run ID: ${state.runId}`));
    assert.ok(summary.includes("Current stage: planning"));
    assert.ok(summary.includes("plan.md"));
    assert.ok(summary.includes("security-report.md"));
    assert.ok(summary.includes("/senai-status"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("truncates long missions with an ellipsis", () => {
    const tmpDir = makeTmpDir("pi-senai-compaction-long-");
    const state = startRun(tmpDir, "A".repeat(500));
    const advance = advanceStage(tmpDir, state, "planning");
    assert.ok(advance.ok);

    const summary = buildSenaiCompactionSummary(tmpDir);

    assert.ok(summary);
    assert.ok(summary.includes("…"));
    assert.ok(!summary.includes("A".repeat(500)));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("omits the Mission line when the mission is empty", () => {
    const tmpDir = makeTmpDir("pi-senai-compaction-nomission-");
    writeState(tmpDir, { mission: "", currentStage: "planning" });

    const summary = buildSenaiCompactionSummary(tmpDir);

    assert.ok(summary);
    assert.ok(!summary.includes("Mission:"));
    assert.ok(summary.includes("plan.md"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports late stages correctly", () => {
    const tmpDir = makeTmpDir("pi-senai-compaction-late-");
    writeState(tmpDir, { currentStage: "delivering" });

    const summary = buildSenaiCompactionSummary(tmpDir);

    assert.ok(summary);
    assert.ok(summary.includes("Current stage: delivering"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws on a corrupted state.json (pinned behavior)", () => {
    // NOTE: possible bug — see Doc/test-plan.md known issues. A corrupted
    // state.json makes loadState throw, which would propagate into pi's
    // compaction pipeline via the session_before_compact hook.
    const tmpDir = makeTmpDir("pi-senai-compaction-corrupt-");
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans", "senai", "state.json"), "{ not valid json");

    assert.throws(() => buildSenaiCompactionSummary(tmpDir));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps a 300-char mission whole but truncates 301 chars", () => {
    const tmpDir = makeTmpDir("pi-senai-compaction-boundary-");
    writeState(tmpDir, { mission: "B".repeat(300) });
    const atLimit = buildSenaiCompactionSummary(tmpDir);
    assert.ok(atLimit);
    assert.ok(atLimit.includes("B".repeat(300)));
    assert.ok(!atLimit.includes("…"));

    writeState(tmpDir, { mission: "C".repeat(301) });
    const overLimit = buildSenaiCompactionSummary(tmpDir);
    assert.ok(overLimit);
    assert.ok(overLimit.includes("…"));
    assert.ok(!overLimit.includes("C".repeat(301)));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps all artifact paths inside the project directory", () => {
    const tmpDir = makeTmpDir("pi-senai-compaction-paths-");
    writeState(tmpDir, {});

    const summary = buildSenaiCompactionSummary(tmpDir);

    assert.ok(summary);
    const pathLines = summary.split("\n").filter((l) => l.startsWith("  "));
    assert.ok(pathLines.length > 0);
    for (const line of pathLines) {
      if (line.includes("/")) {
        assert.ok(line.includes(tmpDir), `path line escapes the project: ${line}`);
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

function writeState(
  tmpDir: string,
  overrides: Partial<{
    mission: string;
    runId: string;
    currentStage: string;
  }>,
): void {
  const state = {
    version: 1,
    mission: overrides.mission ?? "Build CLI",
    runId: overrides.runId ?? "run-1",
    currentStage: overrides.currentStage ?? "planning",
    startedAt: "2026-08-12T00:00:00Z",
    updatedAt: "2026-08-12T00:00:00Z",
    stageResults: {},
  };
  fs.mkdirSync(path.join(tmpDir, ".IDE_Plans", "senai"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, ".IDE_Plans", "senai", "state.json"), JSON.stringify(state));
}
