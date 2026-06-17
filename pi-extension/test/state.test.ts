import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  defaultState,
  loadState,
  saveState,
  startRun,
  advanceStage,
  resetState,
} from "../src/state.js";

describe("state", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orchestra-test-"));
  });

  it("defaultState returns a fresh none state", () => {
    const state = defaultState();
    assert.strictEqual(state.currentStage, "none");
    assert.strictEqual(state.mission, "");
    assert.strictEqual(state.runId, "");
    assert.strictEqual(state.version, 1);
  });

  it("loadState returns default when state file does not exist", () => {
    const state = loadState(tmpDir);
    assert.strictEqual(state.currentStage, "none");
  });

  it("saveState writes state to disk and loadState reads it back", () => {
    const state = defaultState();
    state.mission = "test";
    state.runId = "run-1";
    state.currentStage = "planning";
    saveState(tmpDir, state);

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.mission, "test");
    assert.strictEqual(loaded.runId, "run-1");
    assert.strictEqual(loaded.currentStage, "planning");
  });

  it("startRun creates all stage subdirectories and saves state", () => {
    const state = startRun(tmpDir, "Build a thing");
    assert.strictEqual(state.mission, "Build a thing");
    assert.strictEqual(state.currentStage, "none");
    assert.ok(state.runId.length > 0);

    const runDir = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId);
    assert.ok(fs.existsSync(runDir));
    assert.ok(fs.existsSync(path.join(runDir, "plan/scouts")));
    assert.ok(fs.existsSync(path.join(runDir, "plan/reviews")));
    assert.ok(fs.existsSync(path.join(runDir, "implement")));
    assert.ok(fs.existsSync(path.join(runDir, "document")));
    assert.ok(fs.existsSync(path.join(runDir, "deliver")));

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.mission, "Build a thing");
  });

  it("advanceStage moves through the workflow", () => {
    let state = startRun(tmpDir, "Mission");
    const planning = advanceStage(tmpDir, state, "planning");
    assert.strictEqual(planning.ok, true);
    state = (planning as { ok: true; state: ReturnType<typeof loadState> }).state;
    assert.strictEqual(state.currentStage, "planning");

    const planned = advanceStage(tmpDir, state, "planned");
    assert.strictEqual(planned.ok, true);
    state = (planned as { ok: true; state: ReturnType<typeof loadState> }).state;
    assert.strictEqual(state.currentStage, "planned");
  });

  it("advanceStage rejects invalid transitions", () => {
    const state = startRun(tmpDir, "Mission");
    const result = advanceStage(tmpDir, state, "implemented");
    assert.strictEqual(result.ok, false);
    assert.ok((result as { ok: false; reason: string }).reason.includes("Cannot move"));
  });

  it("advanceStage returns a new state object and does not mutate the input", () => {
    const state = startRun(tmpDir, "Mission");
    const planning = advanceStage(tmpDir, state, "planning");
    assert.strictEqual(planning.ok, true);
    assert.notStrictEqual(
      (planning as { ok: true; state: ReturnType<typeof loadState> }).state,
      state,
    );
    assert.strictEqual(state.currentStage, "none");
    assert.strictEqual(
      (planning as { ok: true; state: ReturnType<typeof loadState> }).state
        .currentStage,
      "planning",
    );
  });

  it("resetState removes the state file", () => {
    const state = startRun(tmpDir, "Mission");
    advanceStage(tmpDir, state, "planning");
    assert.strictEqual(loadState(tmpDir).currentStage, "planning");

    resetState(tmpDir);
    assert.strictEqual(loadState(tmpDir).currentStage, "none");
  });

  it("loadState migrates old state versions", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 0,
        mission: "legacy",
        runId: "legacy-run",
        currentStage: "planned",
        startedAt: "",
        updatedAt: "",
        stageResults: {},
      }),
    );

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.mission, "legacy");
    assert.strictEqual(loaded.currentStage, "planned");
    assert.strictEqual(loaded.version, 1);
  });

  it("loadState throws on corrupted JSON", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "{ not valid json");

    assert.throws(() => loadState(tmpDir), /Unexpected token|Expected property name/);
  });

  it("loadState migrates partial legacy state safely", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ version: 0, mission: "partial" }));

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.mission, "partial");
    assert.strictEqual(loaded.currentStage, "none");
    assert.strictEqual(loaded.version, 1);
  });
});
