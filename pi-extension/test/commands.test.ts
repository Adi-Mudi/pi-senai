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

  it("orchestra-status shows active run", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    notifications.length = 0;
    await commandHandlers["orchestra-status"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Stage: planning"));
    assert.ok(notifications[0].message.includes("Mission: Mission"));
  });

  it("orchestra-approve advances stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    notifications.length = 0;
    await commandHandlers["orchestra-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "planned");
    assert.ok(notifications[0].message.includes("Advanced to 'planned'"));
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

  it("orchestra-implement starts after plan is approved and artifact exists", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx());

    const state = loadState(tmpDir);
    const planPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "plan.md");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");

    sentMessages.length = 0;
    await commandHandlers["orchestra-implement"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
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
});
