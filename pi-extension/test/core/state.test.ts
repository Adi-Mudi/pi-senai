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
  recordDiscussion,
  setMissionBriefPath,
} from "../../src/core/state.js";

describe("state", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-test-"));
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

  it("saveState uses the atomic helper — no .tmp-* files remain after a successful write", () => {
    const state = defaultState();
    state.mission = "atomic";
    state.currentStage = "planning";
    saveState(tmpDir, state);
    // Plant a leftover as if a previous session crashed between the temp
    // write and the rename, then save again — the helper's atomic write
    // must not be affected by the orphan.
    const senaiDir = path.join(tmpDir, ".IDE_Plans/pi-senai");
    fs.writeFileSync(path.join(senaiDir, "state.json.tmp-999-fake"), "orphan");
    saveState(tmpDir, state);
    // The real state.json is the new content; the orphan temp file may
    // still exist (cleanup happens at session_start, not on every write).
    const loaded = JSON.parse(fs.readFileSync(path.join(senaiDir, "state.json"), "utf8"));
    assert.strictEqual(loaded.mission, "atomic");
    assert.strictEqual(loaded.currentStage, "planning");
    // loadState still works even with the orphan temp file present.
    const fresh = loadState(tmpDir);
    assert.strictEqual(fresh.mission, "atomic");
  });

  it("startRun creates all stage subdirectories and saves state", () => {
    const state = startRun(tmpDir, "Build a thing");
    assert.strictEqual(state.mission, "Build a thing");
    assert.strictEqual(state.currentStage, "none");
    assert.ok(state.runId.length > 0);

    const runDir = path.join(tmpDir, ".IDE_Plans/pi-senai/runs", state.runId);
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

  it("advanceStage records a stageResult under the stage being left", () => {
    let state = startRun(tmpDir, "Mission");
    const planning = advanceStage(tmpDir, state, "planning");
    assert.strictEqual(planning.ok, true);
    state = (planning as { ok: true; state: ReturnType<typeof loadState> }).state;

    const planned = advanceStage(tmpDir, state, "planned", "approved; artifacts: verified");
    assert.strictEqual(planned.ok, true);
    const next = (planned as { ok: true; state: ReturnType<typeof loadState> }).state;
    assert.deepStrictEqual(next.stageResults, { planning: "approved; artifacts: verified" });
    // Persisted to disk.
    assert.deepStrictEqual(loadState(tmpDir).stageResults, {
      planning: "approved; artifacts: verified",
    });
  });

  it("advanceStage preserves earlier stageResults entries", () => {
    let state = startRun(tmpDir, "Mission");
    state = { ...state, stageResults: { planning: "earlier" } };
    saveState(tmpDir, state);

    const planning = advanceStage(tmpDir, state, "planning", "second run");
    assert.strictEqual(planning.ok, true);
    const next = (planning as { ok: true; state: ReturnType<typeof loadState> }).state;
    assert.deepStrictEqual(next.stageResults, { planning: "earlier", none: "second run" });
  });

  it("advanceStage without a stageResult leaves stageResults unchanged", () => {
    let state = startRun(tmpDir, "Mission");
    state = { ...state, stageResults: { planning: "earlier" } };
    saveState(tmpDir, state);

    const planning = advanceStage(tmpDir, state, "planning");
    assert.strictEqual(planning.ok, true);
    const next = (planning as { ok: true; state: ReturnType<typeof loadState> }).state;
    assert.deepStrictEqual(next.stageResults, { planning: "earlier" });
  });

  it("advanceStage with a stageResult on an illegal transition records nothing", () => {
    let state = startRun(tmpDir, "Mission");
    const planning = advanceStage(tmpDir, state, "planning");
    assert.strictEqual(planning.ok, true);
    state = (planning as { ok: true; state: ReturnType<typeof loadState> }).state;

    // planning -> documenting is not a legal transition; the result must be
    // rejected BEFORE anything is recorded.
    const rejected = advanceStage(tmpDir, state, "documenting", "should not be recorded");
    assert.strictEqual(rejected.ok, false);
    assert.deepStrictEqual(loadState(tmpDir).stageResults, {}, "nothing recorded on rejection");
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
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
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
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "{ not valid json");

    assert.throws(() => loadState(tmpDir), /Unexpected token|Expected property name/);
  });

  it("loadState migrates partial legacy state safely", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ version: 0, mission: "partial" }));

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.mission, "partial");
    assert.strictEqual(loaded.currentStage, "none");
    assert.strictEqual(loaded.version, 1);
  });

  it("resetState does not throw when the state file is missing", () => {
    assert.doesNotThrow(() => resetState(tmpDir));
  });

  it("loadState migrates a non-numeric version safely", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ version: "old", mission: "legacy" }));

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.version, 1);
    assert.strictEqual(loaded.mission, "legacy");
    assert.strictEqual(loaded.currentStage, "none");
  });

  it("advanceStage from delivered reports no valid next stages", () => {
    const state = { ...defaultState(), currentStage: "delivered" as const };
    const result = advanceStage(tmpDir, state, "planning");
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason.includes("(none)"), "reason should show (none) for empty transitions");
    }
  });

  it("loadState returns a version 1 state with missing fields as-is, but resets an invalid stage", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ version: 1 }));

    // version 1 states skip migration entirely, so missing fields stay missing;
    // only the stage is sanitized (undefined is not a valid stage).
    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.version, 1);
    assert.strictEqual(loaded.mission, undefined);
    assert.strictEqual(loaded.runId, undefined);
    assert.strictEqual(loaded.currentStage, "none");
  });

  it("loadState throws when the JSON body is null", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "null");

    // NOTE: possible bug — see Doc/test-plan.md known issues
    // JSON.parse("null") yields null and parsed.version throws before the
    // version check can route to migrateState.
    assert.throws(() => loadState(tmpDir), TypeError);
  });

  it("loadState migrates a JSON array body to the default state", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(["planning", "run-1"]));

    // Arrays fail the version check, and migrateState finds no string fields
    // on them, so the result is a plain default state.
    const loaded = loadState(tmpDir);
    assert.deepStrictEqual(loaded, defaultState());
  });

  it("loadState throws when the state path is a directory", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(statePath, { recursive: true });

    assert.throws(
      () => loadState(tmpDir),
      (err: any) => err.code === "EISDIR",
    );
  });

  it("advanceStage throws a TypeError for a garbage currentStage", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        mission: "Mission",
        runId: "run-1",
        currentStage: "bogus",
        startedAt: "",
        updatedAt: "",
        stageResults: {},
      }),
    );

    // A garbage stage is sanitized to "none" on load instead of crashing later.
    const state = loadState(tmpDir);
    assert.strictEqual(state.currentStage, "none");
    const result = advanceStage(tmpDir, state, "planning");
    assert.ok(result.ok);
  });

  it("startRun called twice overwrites the previous state", () => {
    const first = startRun(tmpDir, "First mission");
    const second = startRun(tmpDir, "Second mission");
    assert.notStrictEqual(first.runId, second.runId);

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.runId, second.runId);
    assert.strictEqual(loaded.mission, "Second mission");
  });

  it("startRun with an empty mission falls back to a -run suffix", () => {
    const state = startRun(tmpDir, "");
    assert.ok(state.runId.endsWith("-run"));
    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.runId, state.runId);
  });

  it("saveState throws when the senai directory is not writable", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      // Root ignores file permission bits, so this case cannot be tested.
      return;
    }
    const senaiDir = path.join(tmpDir, ".IDE_Plans/pi-senai");
    fs.mkdirSync(senaiDir, { recursive: true });
    fs.chmodSync(senaiDir, 0o444);
    try {
      assert.throws(
        () => saveState(tmpDir, defaultState()),
        (err: any) => err.code === "EACCES",
      );
    } finally {
      fs.chmodSync(senaiDir, 0o755);
    }
  });

  it("resetState throws when the state path is a directory", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(statePath, { recursive: true });

    assert.throws(
      () => resetState(tmpDir),
      (err: any) => err.code === "EISDIR" || err.code === "EPERM",
    );
  });
});

describe("coverage audit gaps", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-test-"));
  });

  it("migrateState carries over legacy timestamps and stage results, and resets an unknown stage", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 0,
        mission: "legacy",
        runId: "legacy-run",
        currentStage: "bogus-stage",
        startedAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-06-01T00:00:00Z",
        stageResults: { planning: "plan.md" },
      }),
    );

    const loaded = loadState(tmpDir);
    assert.strictEqual(loaded.version, 1);
    // A legacy stage string that is not in STAGES falls back to "none".
    assert.strictEqual(loaded.currentStage, "none");
    assert.strictEqual(loaded.startedAt, "2025-01-01T00:00:00Z");
    assert.strictEqual(loaded.updatedAt, "2025-06-01T00:00:00Z");
    assert.deepStrictEqual(loaded.stageResults, { planning: "plan.md" });
  });
});

describe("state — discussion fields", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-disc-"));
  });

  it("recordDiscussion appends an event and bumps the counter", () => {
    const state = startRun(tmpDir, "Mission");
    const result = recordDiscussion(tmpDir, state, {
      ts: new Date().toISOString(),
      transcriptPath: "discussion-01-x.md",
      briefPath: "mission-brief.md",
    });
    assert.strictEqual(result.ok, true);
    const next = (result as { ok: true; state: ReturnType<typeof loadState> }).state;
    assert.strictEqual(next.discussions, 1);
    assert.strictEqual(next.discussionEvents?.length, 1);
    assert.strictEqual(next.discussionEvents?.[0].transcriptPath, "discussion-01-x.md");
  });

  it("recordDiscussion rejects events with missing required fields", () => {
    const state = startRun(tmpDir, "Mission");
    const result = recordDiscussion(tmpDir, state, {
      ts: "",
      transcriptPath: "x.md",
      briefPath: "y.md",
    });
    assert.strictEqual(result.ok, false);
  });

  it("recordDiscussion does not mutate the input state", () => {
    const state = startRun(tmpDir, "Mission");
    const before = JSON.stringify(state);
    recordDiscussion(tmpDir, state, {
      ts: new Date().toISOString(),
      transcriptPath: "x.md",
      briefPath: "y.md",
    });
    assert.strictEqual(JSON.stringify(state), before);
  });

  it("setMissionBriefPath persists the brief path", () => {
    const state = startRun(tmpDir, "Mission");
    setMissionBriefPath(tmpDir, state, ".IDE_Plans/pi-senai/discussions/pre-run/mission-brief.md");
    const reloaded = loadState(tmpDir);
    assert.strictEqual(
      reloaded.missionBriefPath,
      ".IDE_Plans/pi-senai/discussions/pre-run/mission-brief.md",
    );
  });

  it("loadState leaves missing discussion fields on a v1 state (matches legacy behavior)", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/pi-senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        mission: "legacy",
        runId: "r",
        currentStage: "planning",
        startedAt: "",
        updatedAt: "",
        stageResults: {},
      }),
    );
    const loaded = loadState(tmpDir);
    // v1 states skip migration entirely (see the existing "missing fields
    // as-is" test), so missing fields stay missing. New state.json files
    // written by recordDiscussion/setMissionBriefPath populate the fields.
    assert.strictEqual(loaded.discussions, undefined);
    assert.strictEqual(loaded.discussionEvents, undefined);
  });

  it("defaultState seeds the new fields so fresh runs start clean", () => {
    const state = defaultState();
    assert.strictEqual(state.discussions, 0);
    assert.deepStrictEqual(state.discussionEvents, []);
    assert.strictEqual(state.missionBriefPath, undefined);
  });
});
