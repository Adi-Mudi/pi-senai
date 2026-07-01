import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkStageArtifact,
  registerCommands,
  registerAgentCommands,
  registerFilesCommands,
  registerAgentsFilesCommands,
} from "../src/commands.js";
import { loadState, startRun, advanceStage, resetState } from "../src/state.js";
import type { OrchestraState } from "../src/state.js";
import type { Stage } from "../src/constants.js";
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { saveAgentConfig } from "../src/agent-config.js";
import { saveFilesConfig, loadFilesConfig } from "../src/files-config.js";
import { saveAgentsFilesConfig, loadAgentsFilesConfig } from "../src/agents-files-config.js";
import { DEFAULT_AGENTS, type OrchestraRole } from "../src/agent-suggestions.js";

describe("commands", () => {
  let tmpDir: string;
  let notifications: Array<{ message: string; type: string }>;
  let sentMessages: string[];
  let commandHandlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>>;
  let selectChoices: string[];
  let selectIndex: number;
  let inputs: string[];
  let inputIndex: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orchestra-cmd-test-"));
    notifications = [];
    sentMessages = [];
    commandHandlers = {};
    selectChoices = [];
    selectIndex = 0;
    inputs = [];
    inputIndex = 0;
    writeDefaultAgentConfig(tmpDir);
  });

  function makeCtx(): ExtensionContext {
    return {
      cwd: tmpDir,
      ui: {
        notify: (message: string, type: string) => {
          notifications.push({ message, type });
        },
        confirm: async (_title: string, _message: string) => true,
        input: async () => inputs[inputIndex++] ?? "",
        select: async (_title: string, options: string[]) => {
          const choice = selectChoices[selectIndex++] ?? options[0];
          return choice;
        },
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

  function writeDefaultAgentConfig(cwd: string): void {
    saveAgentConfig(cwd, { version: 1, agents: { ...DEFAULT_AGENTS } });
  }

  function advanceTo(cwd: string, state: OrchestraState, stage: Stage): OrchestraState {
    const result = advanceStage(cwd, state, stage);
    if (!result.ok) throw new Error(result.reason);
    return result.state;
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

  it("registerAgentCommands registers agent commands", () => {
    registerAgentCommands(makeApi());

    ["orchestra-agents", "orchestra-configure-agents"].forEach((cmd) =>
      assert.ok(commandHandlers[cmd], `missing ${cmd}`),
    );
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
    assert.ok(sentMessages[0].includes("scout-angle_4.md"));
  });

  it("orchestra-plan warns when mission is empty", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("", makeCtx());
    assert.strictEqual(sentMessages.length, 0);
    assert.ok(notifications[0].message.includes("Usage"));
  });

  it("orchestra-plan blocks when agent config is missing", async () => {
    fs.rmSync(path.join(tmpDir, ".pi"), { recursive: true, force: true });
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    assert.strictEqual(sentMessages.length, 0);
    assert.ok(notifications[0].message.includes("No Pi Orchestra agent configuration found"));
  });

  it("orchestra-implement blocks when agent config maps a missing custom agent", async () => {
    saveAgentConfig(tmpDir, { version: 1, agents: { implementer: "missing-agent" } });
    registerCommands(makeApi());
    await commandHandlers["orchestra-implement"]("", makeCtx());
    assert.strictEqual(sentMessages.length, 0);
    assert.ok(notifications[0].message.includes("Agent configuration errors"));
    assert.ok(notifications[0].message.includes("missing-agent"));
  });

  it("orchestra-agents shows the current registry", async () => {
    registerAgentCommands(makeApi());
    await commandHandlers["orchestra-agents"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Pi Orchestra Agent Registry"));
    assert.ok(notifications[0].message.includes("Planner (planner) → planner"));
    assert.ok(notifications[0].message.includes("All mapped agents are available"));
  });

  it("orchestra-agents reports errors for invalid custom agents", async () => {
    saveAgentConfig(tmpDir, { version: 1, agents: { implementer: "missing-agent" } });
    registerAgentCommands(makeApi());
    await commandHandlers["orchestra-agents"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Pi Orchestra Agent Registry"));
    assert.ok(notifications[0].message.includes("missing-agent"));
    assert.strictEqual(notifications[0].type, "error");
  });

  it("orchestra-configure-agents saves a config from user choices", async () => {
    registerAgentCommands(makeApi());
    // Pre-program choices: for every role choose "Use default: <default>".
    for (const role of Object.keys(DEFAULT_AGENTS) as OrchestraRole[]) {
      selectChoices.push(`Use default: ${DEFAULT_AGENTS[role]}`);
    }
    await commandHandlers["orchestra-configure-agents"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Agent configuration saved"));
    const configPath = path.join(tmpDir, ".pi/orchestra/agents.json");
    assert.ok(fs.existsSync(configPath));
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.version, 1);
    assert.strictEqual(saved.agents.implementer, "worker");
  });

  it("orchestra-configure-agents reads existing config on re-run", async () => {
    saveAgentConfig(tmpDir, { version: 1, agents: { planner: "custom-planner" } });
    registerAgentCommands(makeApi());

    for (const role of Object.keys(DEFAULT_AGENTS) as OrchestraRole[]) {
      if (role === "planner") {
        selectChoices.push("Keep current: custom-planner");
      } else {
        selectChoices.push(`Use default: ${DEFAULT_AGENTS[role]}`);
      }
    }

    await commandHandlers["orchestra-configure-agents"]("", makeCtx());

    const configPath = path.join(tmpDir, ".pi/orchestra/agents.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.agents.planner, "custom-planner");
    assert.strictEqual(saved.agents.implementer, "worker");
  });

  it("orchestra-configure-agents lets the user go back", async () => {
    registerAgentCommands(makeApi());
    const roles = Object.keys(DEFAULT_AGENTS) as OrchestraRole[];

    // Role 0: pick default, then role 1: go back, then role 0 again: pick default, then rest defaults.
    selectChoices.push(`Use default: ${DEFAULT_AGENTS[roles[0]]}`);
    selectChoices.push("← Back");
    selectChoices.push(`Use default: ${DEFAULT_AGENTS[roles[0]]}`);
    for (let i = 1; i < roles.length; i++) {
      selectChoices.push(`Use default: ${DEFAULT_AGENTS[roles[i]]}`);
    }

    await commandHandlers["orchestra-configure-agents"]("", makeCtx());

    const configPath = path.join(tmpDir, ".pi/orchestra/agents.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.version, 1);
    assert.strictEqual(saved.agents[roles[0]], DEFAULT_AGENTS[roles[0]]);
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
    assert.ok(notifications[0].message.includes("Plan artifacts not found"));
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

    // Create the required plan artifacts for implement to proceed.
    const planPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "plan.md");
    const scoutsDir = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "scouts");
    fs.mkdirSync(scoutsDir, { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_1.md"), "# Scout 1\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_2.md"), "# Scout 2\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_3.md"), "# Scout 3\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_4.md"), "# Scout 4\n");

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
    assert.ok(notifications[0].message.includes("Plan artifacts not found"));
  });

  it("checkStageArtifact fails when a scout report is missing", () => {
    const state = startRun(tmpDir, "Mission");
    advanceStage(tmpDir, state, "planning");

    const planPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "plan.md");
    const scoutsDir = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "scouts");
    fs.mkdirSync(scoutsDir, { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_1.md"), "# Scout 1\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_2.md"), "# Scout 2\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_3.md"), "# Scout 3\n");
    // scout-angle_4.md is intentionally missing.

    const result = checkStageArtifact(loadState(tmpDir), "plan", makeCtx());
    assert.strictEqual(result.ok, false);
    assert.ok(notifications[0].message.includes("Plan artifacts not found"));
    assert.ok(notifications[0].message.includes("scout-angle_4.md"));
  });

  it("checkStageArtifact passes when plan artifact exists", () => {
    const state = startRun(tmpDir, "Mission");
    advanceStage(tmpDir, state, "planning");

    const planPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "plan.md");
    const scoutsDir = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "scouts");
    fs.mkdirSync(scoutsDir, { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_1.md"), "# Scout 1\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_2.md"), "# Scout 2\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_3.md"), "# Scout 3\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_4.md"), "# Scout 4\n");

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

  it("orchestra-implement succeeds from planned with plan artifact", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx());

    // Reset back to planned so the manual command can be tested.
    let state = loadState(tmpDir);
    state.currentStage = "planned";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const planPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "plan.md");
    const scoutsDir = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "scouts");
    fs.mkdirSync(scoutsDir, { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_1.md"), "# Scout 1\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_2.md"), "# Scout 2\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_3.md"), "# Scout 3\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_4.md"), "# Scout 4\n");

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["orchestra-implement"]("", makeCtx());

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.ok(notifications[0].message.includes("Implement stage started"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Implement Stage"));
  });

  it("orchestra-document succeeds from implemented with artifacts", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx());

    let state = loadState(tmpDir);
    state.currentStage = "implemented";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const planPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "plan", "plan.md");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");

    const implementPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "implement", "notes.md");
    fs.mkdirSync(path.dirname(implementPath), { recursive: true });
    fs.writeFileSync(implementPath, "# Implement notes\n");

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["orchestra-document"]("", makeCtx());

    assert.strictEqual(loadState(tmpDir).currentStage, "documenting");
    assert.ok(notifications[0].message.includes("Document stage started"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Document Stage"));
  });

  it("orchestra-deliver succeeds from documented with artifacts", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx());

    let state = loadState(tmpDir);
    state.currentStage = "documented";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/orchestra/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const documentPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "document", "README.md");
    fs.mkdirSync(path.dirname(documentPath), { recursive: true });
    fs.writeFileSync(documentPath, "# Docs\n");

    const deliverDir = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "deliver");
    fs.mkdirSync(deliverDir, { recursive: true });
    fs.writeFileSync(path.join(deliverDir, "security-report.md"), "# Security\n");
    fs.writeFileSync(path.join(deliverDir, "deliver-summary.md"), "# Summary\n");

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["orchestra-deliver"]("", makeCtx());

    assert.strictEqual(loadState(tmpDir).currentStage, "delivering");
    assert.ok(notifications[0].message.includes("Deliver stage started"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Deliver Stage"));
  });

  it("checkStageArtifact fails when deliver security report is missing", () => {
    let state = startRun(tmpDir, "Mission");
    state = advanceTo(tmpDir, state, "planning");
    state = advanceTo(tmpDir, state, "planned");
    state = advanceTo(tmpDir, state, "implementing");
    state = advanceTo(tmpDir, state, "implemented");
    state = advanceTo(tmpDir, state, "documenting");
    state = advanceTo(tmpDir, state, "documented");
    state = advanceTo(tmpDir, state, "delivering");

    const deliverDir = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "deliver");
    fs.mkdirSync(deliverDir, { recursive: true });
    fs.writeFileSync(path.join(deliverDir, "deliver-summary.md"), "# Summary\n");

    notifications.length = 0;
    const result = checkStageArtifact(loadState(tmpDir), "deliver", makeCtx());

    assert.strictEqual(result.ok, false);
    assert.ok(notifications[0].message.includes("Deliver artifacts not found"));
    assert.ok(notifications[0].message.includes("security-report.md"));
  });

  it("checkStageArtifact fails when deliver summary is missing", () => {
    let state = startRun(tmpDir, "Mission");
    state = advanceTo(tmpDir, state, "planning");
    state = advanceTo(tmpDir, state, "planned");
    state = advanceTo(tmpDir, state, "implementing");
    state = advanceTo(tmpDir, state, "implemented");
    state = advanceTo(tmpDir, state, "documenting");
    state = advanceTo(tmpDir, state, "documented");
    state = advanceTo(tmpDir, state, "delivering");

    const deliverDir = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "deliver");
    fs.mkdirSync(deliverDir, { recursive: true });
    fs.writeFileSync(path.join(deliverDir, "security-report.md"), "# Security\n");

    notifications.length = 0;
    const result = checkStageArtifact(loadState(tmpDir), "deliver", makeCtx());

    assert.strictEqual(result.ok, false);
    assert.ok(notifications[0].message.includes("Deliver artifacts not found"));
    assert.ok(notifications[0].message.includes("deliver-summary.md"));
  });

  it("checkStageArtifact passes when implement artifacts exist", () => {
    let state = startRun(tmpDir, "Mission");
    state = advanceTo(tmpDir, state, "planning");
    state = advanceTo(tmpDir, state, "planned");
    state = advanceTo(tmpDir, state, "implementing");

    const implementPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "implement", "notes.md");
    fs.mkdirSync(path.dirname(implementPath), { recursive: true });
    fs.writeFileSync(implementPath, "# Notes\n");

    const result = checkStageArtifact(loadState(tmpDir), "implement", makeCtx());
    assert.strictEqual(result.ok, true);
  });

  it("checkStageArtifact passes when document artifacts exist", () => {
    let state = startRun(tmpDir, "Mission");
    state = advanceTo(tmpDir, state, "planning");
    state = advanceTo(tmpDir, state, "planned");
    state = advanceTo(tmpDir, state, "implementing");
    state = advanceTo(tmpDir, state, "implemented");
    state = advanceTo(tmpDir, state, "documenting");

    const documentPath = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "document", "README.md");
    fs.mkdirSync(path.dirname(documentPath), { recursive: true });
    fs.writeFileSync(documentPath, "# Docs\n");

    const result = checkStageArtifact(loadState(tmpDir), "document", makeCtx());
    assert.strictEqual(result.ok, true);
  });

  it("checkStageArtifact passes when deliver artifacts exist", () => {
    let state = startRun(tmpDir, "Mission");
    state = advanceTo(tmpDir, state, "planning");
    state = advanceTo(tmpDir, state, "planned");
    state = advanceTo(tmpDir, state, "implementing");
    state = advanceTo(tmpDir, state, "implemented");
    state = advanceTo(tmpDir, state, "documenting");
    state = advanceTo(tmpDir, state, "documented");
    state = advanceTo(tmpDir, state, "delivering");

    const deliverDir = path.join(tmpDir, ".IDE_Plans/orchestra/runs", state.runId, "deliver");
    fs.mkdirSync(deliverDir, { recursive: true });
    fs.writeFileSync(path.join(deliverDir, "security-report.md"), "# Security\n");
    fs.writeFileSync(path.join(deliverDir, "deliver-summary.md"), "# Summary\n");

    const result = checkStageArtifact(loadState(tmpDir), "deliver", makeCtx());
    assert.strictEqual(result.ok, true);
  });

  it("orchestra-status reports delivered run", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx());
    await commandHandlers["orchestra-approve"]("", makeCtx());

    notifications.length = 0;
    await commandHandlers["orchestra-status"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Stage: delivered"));
    assert.ok(notifications[0].message.includes("Next step: run /orchestra-status"));
  });

  it("orchestra-approve rejects when no run is active", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-approve"]("", makeCtx());
    assert.ok(notifications[0].message.includes("No active orchestra run"));
  });

  it("orchestra-implement rejects from planning stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["orchestra-plan"]("Mission", makeCtx());

    notifications.length = 0;
    await commandHandlers["orchestra-implement"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Plan artifacts not found"));
  });

  it("registerFilesCommands registers file commands", () => {
    registerFilesCommands(makeApi());
    ["orchestra-files", "orchestra-configure-files"].forEach((cmd) =>
      assert.ok(commandHandlers[cmd], `missing ${cmd}`),
    );
  });

  it("registerAgentsFilesCommands registers agent file commands", () => {
    registerAgentsFilesCommands(makeApi());
    ["orchestra-agents-files", "orchestra-configure-agents-files"].forEach((cmd) =>
      assert.ok(commandHandlers[cmd], `missing ${cmd}`),
    );
  });

  it("orchestra-files shows configured project files", async () => {
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["Doc/"],
      inputDocuments: ["README.md"],
      testPaths: [],
      excludedPaths: [],
    });
    registerFilesCommands(makeApi());

    await commandHandlers["orchestra-files"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Pi Orchestra Project Files"));
    assert.ok(notifications[0].message.includes("README.md"));
    assert.ok(notifications[0].message.includes("Doc/"));
  });

  it("orchestra-agents-files shows configured assignments", async () => {
    saveAgentsFilesConfig(tmpDir, {
      version: 1,
      documents: { planner: { primary: "Doc/planner.md", reads: ["Doc/plan.md"] } },
    });
    registerAgentsFilesCommands(makeApi());

    await commandHandlers["orchestra-agents-files"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Agent Document Assignments"));
    assert.ok(notifications[0].message.includes("Doc/planner.md"));
    assert.ok(notifications[0].message.includes("Doc/plan.md"));
  });

  it("orchestra-configure-files saves categorized choices", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "", "utf8");

    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit code paths",
      "Add custom path",
      "📂 src/",
      "📁 Select this folder (src/)",
      "Back",
      "Edit input documents",
      "Add custom path",
      "📂 docs/",
      "📄 PRD.md",
      "Back",
      "Finish",
    );

    await commandHandlers["orchestra-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, ["src/"]);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/PRD.md"]);
  });

  it("orchestra-configure-files avoids folder and child file conflicts", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "", "utf8");

    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit input documents",
      "Add custom path",
      "📂 docs/",
      "📁 Select this folder (docs/)",
      "Back",
      "Edit input documents",
      "Add custom path",
      "📂 docs/",
      "📄 PRD.md",
      "Back",
      "Finish",
    );

    await commandHandlers["orchestra-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/"]);
  });

  it("orchestra-configure-agents-files saves user choices", async () => {
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: ["Doc/planner.md", "Doc/plan.md"],
      testPaths: [],
      excludedPaths: [".git/", "node_modules/"],
    });
    registerAgentsFilesCommands(makeApi());

    // Top-level role picker: choose planner.
    // Per-role editor: set truth, add read, go back.
    // Top-level: finish.
    selectChoices.push(
      "⬜ planner: Planner (planner) — not set",
      "Set truth document",
      "Doc/planner.md",
      "⬜ Suggest: Doc/plan.md",
      "Back",
      "⬜ Finish",
    );

    await commandHandlers["orchestra-configure-agents-files"]("", makeCtx());
    const saved = loadAgentsFilesConfig(tmpDir);
    assert.strictEqual(saved?.documents.planner?.primary, "Doc/planner.md");
    assert.deepStrictEqual(saved?.documents.planner?.reads, ["Doc/plan.md"]);
  });

  // Edge cases
  it("orchestra-configure-files handles empty suggestions gracefully", async () => {
    fs.mkdirSync(path.join(tmpDir, "custom"), { recursive: true });

    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit code paths",
      "Add custom path",
      "📂 custom/",
      "📁 Select this folder (custom/)",
      "Back",
      "Finish",
    );

    await commandHandlers["orchestra-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, ["custom/"]);
  });

  it("orchestra-configure-files prevents selecting nested folder and ancestor", async () => {
    fs.mkdirSync(path.join(tmpDir, "src", "components"), { recursive: true });

    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit code paths",
      "Add custom path",
      "📂 src/",
      "📁 Select this folder (src/)",
      "Back",
      "Edit code paths",
      "Add custom path",
      "📂 src/",
      "📂 components/",
      "📁 Select this folder (src/components/)",
      "Back",
      "Finish",
    );

    await commandHandlers["orchestra-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, ["src/"]);
  });

  it("orchestra-configure-files allows test files inside selected code folders", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "main.test.ts"), "", "utf8");

    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit code paths",
      "Add custom path",
      "📂 src/",
      "📁 Select this folder (src/)",
      "Back",
      "Edit test paths",
      "Add custom path",
      "📂 src/",
      "📄 main.test.ts",
      "Back",
      "Finish",
    );

    await commandHandlers["orchestra-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, ["src/"]);
    assert.deepStrictEqual(saved?.testPaths, ["src/main.test.ts"]);
  });

  it("orchestra-configure-files filters suggestions by name", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    for (const name of ["alpha.md", "beta.md", "gamma.md"]) {
      fs.writeFileSync(path.join(tmpDir, "docs", name), "", "utf8");
    }

    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit input documents",
      "Filter suggestions...",
      "⬜ Suggest: docs/beta.md",
      "Back",
      "Finish",
    );
    inputs.push("beta");

    await commandHandlers["orchestra-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/beta.md"]);
  });

  it("orchestra-configure-files paginates long suggestion lists", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    for (let i = 1; i <= 15; i++) {
      const num = i.toString().padStart(2, "0");
      fs.writeFileSync(path.join(tmpDir, "docs", `doc${num}.md`), "", "utf8");
    }

    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit input documents",
      "Next page →",
      "⬜ Suggest: docs/doc12.md",
      "Back",
      "Finish",
    );

    await commandHandlers["orchestra-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/doc12.md"]);
  });

  it("orchestra-configure-files picker can select a folder for input documents", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "one.md"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "docs", "two.md"), "", "utf8");

    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit input documents",
      "⬜ Suggest: docs/",
      "Back",
      "Finish",
    );

    await commandHandlers["orchestra-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/"]);
  });

  it("orchestra-configure-files picker cancels without adding a path", async () => {
    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit code paths",
      "Add custom path",
      "❌ Cancel",
      "Back",
      "Finish",
    );

    await commandHandlers["orchestra-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, []);
  });
});
