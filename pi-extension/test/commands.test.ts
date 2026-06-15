import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkStageArtifact, registerCommands } from "../src/commands.js";
import { loadState, startRun, advanceStage, resetState } from "../src/state.js";
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";

describe("commands", () => {
  let tmpDir: string;
  let notifications: Array<{ message: string; type: string }>;
  let sentMessages: string[];
  let commandHandlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orchestra-cmd-test-"));
    notifications = [];
    sentMessages = [];
    commandHandlers = {};
  });

  function makeCtx(): ExtensionContext {
    return {
      cwd: tmpDir,
      ui: {
        notify: (message: string, type: string) => {
          notifications.push({ message, type });
        },
        confirm: async (_title: string, _message: string) => true,
        input: async () => "",
        select: async () => "",
      },
    } as unknown as ExtensionContext;
  }

  function makeApi(): ExtensionAPI {
    return {
      registerCommand: (name: string, cmd: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
        commandHandlers[name] = cmd.handler;
      },
      registerTool: () => {},
      on: () => {},
      registerMessageRenderer: () => {},
      sendUserMessage: (message: string) => {
        sentMessages.push(message);
      },
      sendMessage: () => {},
    } as unknown as ExtensionAPI;
  }

  it("registerCommands registers all orchestra commands", () => {
    registerCommands(makeApi());

    [
      "orchestra-plan",
      "orchestra-implement",
      "orchestra-document",
      "orchestra-deliver",
      "orchestra-status",
      "orchestra-approve",
      "orchestra-reset",
    ].forEach((cmd) => assert.ok(commandHandlers[cmd], `missing ${cmd}`));
  });

  it("orchestra-plan initializes a run and sends a prompt", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Build a CLI", makeCtx());

    const state = loadState(tmpDir);
    assert.strictEqual(state.mission, "Build a CLI");
    assert.strictEqual(state.currentStage, "planning");
    assert.ok(notifications[0].message.includes("Plan stage started"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Plan Stage"));
    assert.ok(sentMessages[0].includes("Mission: Build a CLI"));
  });

  it("orchestra-plan warns when mission is empty", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("", makeCtx());
    assert.strictEqual(sentMessages.length, 0);
    assert.ok(notifications[0].message.includes("Usage"));
  });

  it("orchestra-status reports no active run", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-status"]("", makeCtx());
    assert.ok(notifications[0].message.includes("No active orchestra run"));
  });

  it("orchestra-status shows active run and next step", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    notifications.length = 0;
    await commandHandlers["orchestra-status"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Stage: planning"));
    assert.ok(notifications[0].message.includes("Mission: Mission"));
    assert.ok(notifications[0].message.includes("Next step: run /orchestra-approve"));
  });

  it("orchestra-approve advances stage and auto-runs next stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    notifications.length = 0;
    sentMessages.length = 0;

    await commandHandlers["orchestra-approve"]("", makeCtx());

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.ok(notifications[0].message.includes("Automatically running the next stage: /orchestra-implement"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Implement Stage"));
  });

  it("orchestra-approve finishes run after deliver stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());

    // Approve through all stages.
    await commandHandlers["orchestra-approve"]("", makeCtx()); // planning -> planned -> implementing
    await commandHandlers["orchestra-approve"]("", makeCtx()); // implementing -> implemented -> documenting
    await commandHandlers["orchestra-approve"]("", makeCtx()); // documenting -> documented -> delivering

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["orchestra-approve"]("", makeCtx()); // delivering -> delivered

    assert.strictEqual(loadState(tmpDir).currentStage, "delivered");
    assert.ok(notifications[0].message.includes("All stages are complete"));
    assert.strictEqual(sentMessages.length, 0);
  });

  it("orchestra-reset clears state", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    notifications.length = 0;
    await commandHandlers["orchestra-reset"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "none");
    assert.ok(notifications[0].message.includes("Orchestra state reset"));
  });

  it("orchestra-implement blocks when plan artifact is missing", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    notifications.length = 0;
    await commandHandlers["orchestra-implement"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Plan artifact not found"));
  });

  it("orchestra-implement can be run directly from planned stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx()); // advances to implementing

    // Manually reset stage back to planned to test direct implement command.
    let state = loadState(tmpDir);
    state.currentStage = "planned";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    // Create the required plan artifact for implement to proceed.
    const planPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "plan.md");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["orchestra-implement"]("", makeCtx());

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.ok(notifications[0].message.includes("Implement stage started"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Implement Stage"));
  });

  it("checkStageArtifact fails when no run is active", () => {
    const state = loadState(tmpDir);
    const result = checkStageArtifact(state, "plan", makeCtx());
    assert.strictEqual(result.ok, false);
    assert.ok(notifications[0].message.includes("No active run"));
  });

  it("checkStageArtifact fails when plan artifact is missing", () => {
    const state = startRun(tmpDir, "Mission");
    advanceStage(tmpDir, state, "planning");
    const result = checkStageArtifact(loadState(tmpDir), "plan", makeCtx());
    assert.strictEqual(result.ok, false);
    assert.ok(notifications[0].message.includes("Plan artifact not found"));
  });

  it("checkStageArtifact passes when plan artifact exists", () => {
    const state = startRun(tmpDir, "Mission");
    advanceStage(tmpDir, state, "planning");

    const planPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "plan.md");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");

    const result = checkStageArtifact(loadState(tmpDir), "plan", makeCtx());
    assert.strictEqual(result.ok, true);
  });

  it("orchestra-document blocks when implement artifacts are missing", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx()); // planning -> planned -> implementing

    // Manually set state to implemented without creating implement artifacts.
    let state = loadState(tmpDir);
    state.currentStage = "implemented";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    notifications.length = 0;
    await commandHandlers["orchestra-document"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Implement artifacts not found"));
    assert.strictEqual(loadState(tmpDir).currentStage, "implemented");
  });

  it("orchestra-deliver blocks when document artifacts are missing", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx()); // planning -> planned -> implementing

    // Manually set state to documented without creating document artifacts.
    let state = loadState(tmpDir);
    state.currentStage = "documented";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    notifications.length = 0;
    await commandHandlers["orchestra-deliver"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Document artifacts not found"));
    assert.strictEqual(loadState(tmpDir).currentStage, "documented");
  });

  it("orchestra-document rejects running from planned stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx()); // planning -> planned -> implementing

    // Manually reset stage back to planned.
    let state = loadState(tmpDir);
    state.currentStage = "planned";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    // Create plan and implement artifacts so only the stage restriction is tested.
    const planPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "plan.md");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");
    const implementPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "implement", "notes.md");
    fs.mkdirSync(path.dirname(implementPath), { recursive: true });
    fs.writeFileSync(implementPath, "# Implement notes\n");

    notifications.length = 0;
    await commandHandlers["orchestra-document"]("", makeCtx());

    assert.ok(notifications[0].message.includes("can only run from 'implemented'"));
    assert.strictEqual(loadState(tmpDir).currentStage, "planned");
  });
});
