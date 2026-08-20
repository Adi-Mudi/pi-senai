import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { guardSpawnCall } from "../src/spawn-guard.js";
import { saveAgentConfig } from "../src/agent-config.js";
import { defaultState, saveState } from "../src/state.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spawn-guard-"));
}

/** Active run + planner/discussion mapped to a generated agent. */
function setupActiveRun(cwd: string): void {
  saveState(cwd, { ...defaultState(), currentStage: "planning", runId: "r1" });
  saveAgentConfig(cwd, {
    version: 1,
    agents: {
      planner: "proj-arch-planner",
      discussion: "proj-arch-planner",
      "scout-2": "proj-scout-2",
    },
  });
}

describe("guardSpawnCall", () => {
  it("allows any subagent call when no senai run is active", () => {
    const cwd = makeTmp();
    saveAgentConfig(cwd, { version: 1, agents: { planner: "proj-arch-planner" } });
    assert.strictEqual(guardSpawnCall("subagent", { agent: "planner" }, cwd), undefined);
  });

  it("allows the exact mapped agent name during an active run", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    assert.strictEqual(
      guardSpawnCall("subagent", { agent: "proj-arch-planner" }, cwd),
      undefined,
    );
  });

  it("blocks a bare role name that collides with a custom mapping", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    const result = guardSpawnCall("subagent", { agent: "planner" }, cwd);
    assert.ok(result?.block, "bare 'planner' is blocked");
    assert.ok(
      result.reason.includes("proj-arch-planner"),
      "reason names the mapped agent",
    );
  });

  it("blocks a missing or empty agent parameter during an active run", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    assert.ok(guardSpawnCall("subagent", {}, cwd)?.block, "missing agent blocked");
    assert.ok(guardSpawnCall("subagent", { agent: "  " }, cwd)?.block, "blank agent blocked");
  });

  it("blocks a bare senai role name that is not a built-in (e.g. scout-2)", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    const result = guardSpawnCall("subagent", { agent: "scout-2" }, cwd);
    assert.ok(result?.block, "bare role name blocked");
    assert.ok(result.reason.includes("proj-scout-2"), "reason names the mapped agent");
  });

  it("allows a typo'd name that is neither role nor built-in — the subagent extension's own unknown-agent error handles it", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    assert.strictEqual(guardSpawnCall("subagent", { agent: "sccout-2" }, cwd), undefined);
  });

  it("allows a built-in name for roles that genuinely stay on the default", () => {
    const cwd = makeTmp();
    saveState(cwd, { ...defaultState(), currentStage: "planning", runId: "r1" });
    saveAgentConfig(cwd, { version: 1, agents: { "scout-2": "proj-scout-2" } });
    // 'reviewer' is the default for reviewer-* roles and none are remapped here.
    assert.strictEqual(guardSpawnCall("subagent", { agent: "reviewer" }, cwd), undefined);
  });

  it("applies the same checks to subagent_resume", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    assert.ok(guardSpawnCall("subagent_resume", { agent: "planner" }, cwd)?.block);
    assert.strictEqual(
      guardSpawnCall("subagent_resume", { agent: "proj-arch-planner" }, cwd),
      undefined,
    );
  });

  it("ignores non-subagent tool calls", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    assert.strictEqual(guardSpawnCall("bash", { command: "ls" }, cwd), undefined);
    assert.strictEqual(guardSpawnCall("write", {}, cwd), undefined);
  });

  it("steps aside on corrupted state.json or missing agents.json", () => {
    const cwd = makeTmp();
    fs.mkdirSync(path.join(cwd, ".IDE_Plans", "senai"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".IDE_Plans", "senai", "state.json"), "{not json", "utf8");
    assert.strictEqual(guardSpawnCall("subagent", { agent: "planner" }, cwd), undefined);

    const cwd2 = makeTmp();
    saveState(cwd2, { ...defaultState(), currentStage: "planning", runId: "r1" });
    assert.strictEqual(guardSpawnCall("subagent", { agent: "planner" }, cwd2), undefined);
  });

  it("allows everything once the run is delivered", () => {
    const cwd = makeTmp();
    saveState(cwd, { ...defaultState(), currentStage: "delivered", runId: "r1" });
    saveAgentConfig(cwd, { version: 1, agents: { planner: "proj-arch-planner" } });
    assert.strictEqual(guardSpawnCall("subagent", { agent: "planner" }, cwd), undefined);
  });

  it("allows a custom agent name that does not collide with any role or built-in", () => {
    const cwd = makeTmp();
    setupActiveRun(cwd);
    assert.strictEqual(guardSpawnCall("subagent", { agent: "my-custom-agent" }, cwd), undefined);
  });

  it("allows a missing agent parameter when no role has a custom mapping", () => {
    const cwd = makeTmp();
    saveState(cwd, { ...defaultState(), currentStage: "planning", runId: "r1" });
    saveAgentConfig(cwd, { version: 1, agents: {} });
    assert.strictEqual(guardSpawnCall("subagent", {}, cwd), undefined);
  });
});
