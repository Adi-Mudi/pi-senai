import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  D_FLOOR_CLEAN,
  buildCadenceBlock,
  defaultCadenceState,
  isRateLimitError,
  loadCadenceState,
  record429,
  recordCleanRun,
  resetCadence,
  saveCadenceState,
} from "../../src/spawn-cadence.js";
import { getCadencePath } from "../../src/constants.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-cadence-"));
}

describe("defaultCadenceState", () => {
  it("starts at tier A with zero clean runs and no history", () => {
    const state = defaultCadenceState();
    assert.strictEqual(state.tier, "A");
    assert.strictEqual(state.consecutiveCleanRuns, 0);
    assert.strictEqual(state.last429At, null);
    assert.strictEqual(state.lastPromotableAt, null);
    assert.deepStrictEqual(state.history, []);
  });
});

describe("loadCadenceState", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeTmp();
  });

  it("returns the default state when no file exists", () => {
    const state = loadCadenceState(cwd);
    assert.strictEqual(state.tier, "A");
    assert.strictEqual(state.consecutiveCleanRuns, 0);
  });

  it("round-trips a saved state through disk", () => {
    const saved = defaultCadenceState();
    saved.tier = "B";
    saved.consecutiveCleanRuns = 2;
    saved.last429At = "2026-09-01T00:00:00.000Z";
    saveCadenceState(cwd, saved);
    const loaded = loadCadenceState(cwd);
    assert.strictEqual(loaded.tier, "B");
    assert.strictEqual(loaded.consecutiveCleanRuns, 2);
    assert.strictEqual(loaded.last429At, "2026-09-01T00:00:00.000Z");
  });

  it("recovers from a corrupt file by returning the default state", () => {
    const file = getCadencePath(cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json {{{", "utf8");
    const state = loadCadenceState(cwd);
    assert.strictEqual(state.tier, "A");
  });

  it("drops history entries with invalid shape on load", () => {
    const file = getCadencePath(cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          version: 1,
          tier: "C",
          consecutiveCleanRuns: 1,
          last429At: null,
          lastPromotableAt: null,
          history: [
            { ts: "ok", from: "A", to: "B", reason: "promote:3_clean" },
            { ts: "bad", from: "X", to: "B", reason: "junk" },
            null,
            { ts: "missing-to", from: "A" },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    const loaded = loadCadenceState(cwd);
    assert.strictEqual(loaded.tier, "C");
    assert.strictEqual(loaded.history.length, 1);
    assert.strictEqual(loaded.history[0].from, "A");
  });

  it("treats an unknown tier as the default state", () => {
    const file = getCadencePath(cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, tier: "Z", consecutiveCleanRuns: 5 }),
      "utf8",
    );
    const state = loadCadenceState(cwd);
    assert.strictEqual(state.tier, "A");
  });
});

describe("recordCleanRun", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeTmp();
  });

  it("does NOT promote tier A (ceiling)", () => {
    const state = recordCleanRun(cwd);
    assert.strictEqual(state.tier, "A");
    assert.strictEqual(state.consecutiveCleanRuns, 1);
  });

  it("promotes B → A after PROMOTE_AFTER_CLEAN clean runs", () => {
    saveCadenceState(cwd, { ...defaultCadenceState(), tier: "B" });
    let state = recordCleanRun(cwd);
    assert.strictEqual(state.tier, "B");
    assert.strictEqual(state.consecutiveCleanRuns, 1);
    state = recordCleanRun(cwd);
    assert.strictEqual(state.tier, "B");
    assert.strictEqual(state.consecutiveCleanRuns, 2);
    state = recordCleanRun(cwd);
    assert.strictEqual(state.tier, "A");
    assert.strictEqual(state.consecutiveCleanRuns, 0);
    assert.strictEqual(state.history.length, 1);
    assert.strictEqual(state.history[0].from, "B");
    assert.strictEqual(state.history[0].to, "A");
  });

  it("promotes C → B after PROMOTE_AFTER_CLEAN clean runs", () => {
    saveCadenceState(cwd, { ...defaultCadenceState(), tier: "C", consecutiveCleanRuns: 2 });
    const state = recordCleanRun(cwd);
    assert.strictEqual(state.tier, "B");
    assert.strictEqual(state.consecutiveCleanRuns, 0);
  });

  it("does NOT auto-promote D → C; stamps lastPromotableAt only after D_FLOOR_CLEAN", () => {
    saveCadenceState(cwd, { ...defaultCadenceState(), tier: "D" });
    let state = recordCleanRun(cwd);
    assert.strictEqual(state.tier, "D");
    assert.strictEqual(state.consecutiveCleanRuns, 1);
    assert.strictEqual(state.lastPromotableAt, null);
    // Keep going up to D_FLOOR_CLEAN - 1; still no promotion.
    for (let i = 0; i < D_FLOOR_CLEAN - 2; i++) {
      state = recordCleanRun(cwd);
    }
    assert.strictEqual(state.tier, "D");
    assert.strictEqual(state.consecutiveCleanRuns, D_FLOOR_CLEAN - 1);
    assert.strictEqual(state.lastPromotableAt, null);
    // The D_FLOOR_CLEAN-th call stamps lastPromotableAt but does NOT promote.
    state = recordCleanRun(cwd);
    assert.strictEqual(state.tier, "D");
    assert.strictEqual(state.consecutiveCleanRuns, D_FLOOR_CLEAN);
    assert.ok(state.lastPromotableAt, "lastPromotableAt should be set after D_FLOOR_CLEAN");
  });
});

describe("record429", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeTmp();
  });

  it("demotes A → B and stamps last429At", () => {
    const state = record429(cwd);
    assert.strictEqual(state.tier, "B");
    assert.strictEqual(state.consecutiveCleanRuns, 0);
    assert.ok(state.last429At);
    assert.strictEqual(state.history.length, 1);
    assert.strictEqual(state.history[0].reason, "demote:rate_limit");
  });

  it("demotes B → C and C → D", () => {
    saveCadenceState(cwd, { ...defaultCadenceState(), tier: "B" });
    const after2 = record429(cwd);
    assert.strictEqual(after2.tier, "C");
    const after3 = record429(cwd);
    assert.strictEqual(after3.tier, "D");
  });

  it("does NOT demote past D; logs a floor event instead", () => {
    saveCadenceState(cwd, { ...defaultCadenceState(), tier: "D" });
    const state = record429(cwd);
    assert.strictEqual(state.tier, "D");
    const last = state.history[state.history.length - 1];
    assert.strictEqual(last.reason, "demote:rate_limit:floor");
  });

  it("resets the consecutive-clean-run counter on demotion", () => {
    saveCadenceState(cwd, {
      ...defaultCadenceState(),
      tier: "B",
      consecutiveCleanRuns: 2,
    });
    const state = record429(cwd);
    assert.strictEqual(state.tier, "C");
    assert.strictEqual(state.consecutiveCleanRuns, 0);
  });
});

describe("resetCadence", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeTmp();
  });

  it("returns to tier A from any tier and records a manual reset", () => {
    saveCadenceState(cwd, {
      ...defaultCadenceState(),
      tier: "D",
      consecutiveCleanRuns: 5,
    });
    const state = resetCadence(cwd);
    assert.strictEqual(state.tier, "A");
    assert.strictEqual(state.consecutiveCleanRuns, 0);
    assert.strictEqual(state.last429At, null);
    assert.strictEqual(state.lastPromotableAt, null);
    assert.strictEqual(state.history.length, 1);
    assert.strictEqual(state.history[0].reason, "reset:manual");
    assert.strictEqual(state.history[0].from, "D");
  });

  it("from a fresh A state still writes a no-op history entry", () => {
    const state = resetCadence(cwd);
    // No tier change so no history entry is needed.
    assert.strictEqual(state.tier, "A");
    assert.strictEqual(state.history.length, 0);
  });
});

describe("isRateLimitError", () => {
  it("matches 429", () => {
    assert.ok(isRateLimitError("Sub-agent \"X\" failed ... 429 rate limit"));
  });

  it("matches rate-limit phrasing", () => {
    assert.ok(isRateLimitError("provider is rate-limiting this account"));
    assert.ok(isRateLimitError("server returned 429: rate-limited"));
  });

  it("matches 5xx server errors", () => {
    assert.ok(isRateLimitError("500 internal server error"));
    assert.ok(isRateLimitError("503 service unavailable"));
  });

  it("matches stopReason: error surfaced by pi-interactive-subagents v3.7.2+", () => {
    assert.ok(isRateLimitError('failed after 12s (stopReason: "error" — auto-retry exhausted)'));
  });

  it("does NOT match auth, network, or tool errors", () => {
    assert.ok(!isRateLimitError("401 unauthorized"));
    assert.ok(!isRateLimitError("network timeout"));
    assert.ok(!isRateLimitError("artifact file is missing"));
    assert.ok(!isRateLimitError("invalid JSON syntax"));
  });
});

describe("buildCadenceBlock", () => {
  it("renders the A-tier burst rule for the default state", () => {
    const block = buildCadenceBlock(defaultCadenceState());
    assert.ok(block.includes("A (parallel burst)"));
    assert.ok(block.includes("single burst"));
    assert.ok(block.includes("Tier A is the ceiling"));
  });

  it("renders the staggered rule for tier B", () => {
    const block = buildCadenceBlock({ ...defaultCadenceState(), tier: "B" });
    assert.ok(block.includes("B (staggered)"));
    assert.ok(block.includes("sleep 5"));
  });

  it("renders the batch-2 rule for tier C", () => {
    const block = buildCadenceBlock({ ...defaultCadenceState(), tier: "C" });
    assert.ok(block.includes("C (batch-2)"));
    assert.ok(block.includes("sleep 10"));
  });

  it("renders the fully-serial rule for tier D and notes the floor", () => {
    const block = buildCadenceBlock({ ...defaultCadenceState(), tier: "D" });
    assert.ok(block.includes("D (fully serial)"));
    assert.ok(block.includes("Tier D is the floor"));
    assert.ok(block.includes("/senai-cadence-reset"));
  });

  it("includes the clean-run counter and last 429 timestamp when present", () => {
    const block = buildCadenceBlock({
      ...defaultCadenceState(),
      tier: "B",
      consecutiveCleanRuns: 2,
      last429At: "2026-09-01T12:00:00.000Z",
    });
    assert.ok(block.includes("2 clean runs"));
    assert.ok(block.includes("Last rate-limit error: 2026-09-01T12:00:00.000Z"));
  });
});
