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
  registerDoctorCommand,
  registerArchitectInputsCommands,
  registerArchitectCommand,
  buildCategoryItems,
  matchesFilter,
  normalizePath,
  isPathConflict,
  isFolderLike,
  defaultArchitectSkill,
} from "../src/commands.js";
import { loadState, startRun, advanceStage, resetState } from "../src/state.js";
import type { SenaiState } from "../src/state.js";
import type { Stage } from "../src/constants.js";
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { saveAgentConfig } from "../src/agent-config.js";
import { saveFilesConfig, loadFilesConfig } from "../src/files-config.js";
import { saveAgentsFilesConfig, loadAgentsFilesConfig } from "../src/agents-files-config.js";
import {
  loadArchitectInputsConfig,
  saveArchitectInputsConfig,
} from "../src/architect-inputs-config.js";
import { DEFAULT_AGENTS, type SenaiRole } from "../src/agent-suggestions.js";

describe("commands", () => {
  let tmpDir: string;
  let notifications: Array<{ message: string; type: string }>;
  let sentMessages: string[];
  let commandHandlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>>;
  let selectChoices: string[];
  let selectIndex: number;
  let inputs: string[];
  let inputIndex: number;
  let editorValues: string[];
  let editorIndex: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-cmd-test-"));
    notifications = [];
    sentMessages = [];
    commandHandlers = {};
    selectChoices = [];
    selectIndex = 0;
    inputs = [];
    inputIndex = 0;
    editorValues = [];
    editorIndex = 0;
    writeDefaultAgentConfig(tmpDir);
    writeDefaultFilesConfig(tmpDir);
    writeDefaultAgentsFilesConfig(tmpDir);
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
        editor: async (_title: string, _value: string) => editorValues[editorIndex++] ?? "",
        select: async (_title: string, options: string[]) => {
          if (selectIndex >= selectChoices.length) return options[0];
          return selectChoices[selectIndex++];
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

  function writeDefaultFilesConfig(cwd: string): void {
    saveFilesConfig(cwd, {
      version: 2,
      codePaths: [],
      inputDocuments: [],
      testPaths: [],
      excludedPaths: [".git/", "node_modules/"],
    });
  }

  function writeDefaultAgentsFilesConfig(cwd: string): void {
    saveAgentsFilesConfig(cwd, { version: 2, documents: {} });
  }

  function advanceTo(cwd: string, state: SenaiState, stage: Stage): SenaiState {
    const result = advanceStage(cwd, state, stage);
    if (!result.ok) throw new Error(result.reason);
    return result.state;
  }

  it("registerCommands registers all senai commands", () => {
    registerCommands(makeApi());

    [
      "senai-plan",
      "senai-implement",
      "senai-document",
      "senai-deliver",
      "senai-status",
      "senai-approve",
      "senai-reset",
    ].forEach((cmd) => assert.ok(commandHandlers[cmd], `missing ${cmd}`));
  });

  it("blocks stage commands when files.json is missing", async () => {
    fs.rmSync(path.join(tmpDir, ".pi", "senai", "files.json"));
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Build CLI", makeCtx());
    assert.ok(notifications[0].message.includes("Agent configuration errors"));
    assert.ok(notifications[0].message.includes("/senai-configure-files"));
  });

  it("blocks stage commands when agents_files.json is missing", async () => {
    fs.rmSync(path.join(tmpDir, ".pi", "senai", "agents_files.json"));
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Build CLI", makeCtx());
    assert.ok(notifications[0].message.includes("Agent configuration errors"));
    assert.ok(notifications[0].message.includes("/senai-configure-agents-files"));
  });

  it("blocks stage commands when a truth document is missing", async () => {
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-1": { primary: "missing-doc.md" } },
    });
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Build CLI", makeCtx());
    assert.ok(notifications[0].message.includes("Agent configuration errors"));
    assert.ok(notifications[0].message.includes("Truth document"));
  });

  it("registerAgentCommands registers agent commands", () => {
    registerAgentCommands(makeApi());

    ["senai-agents", "senai-configure-agents"].forEach((cmd) =>
      assert.ok(commandHandlers[cmd], `missing ${cmd}`),
    );
  });

  it("senai-plan initializes a run and sends a prompt", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Build a CLI", makeCtx());

    const state = loadState(tmpDir);
    assert.strictEqual(state.mission, "Build a CLI");
    assert.strictEqual(state.currentStage, "planning");
    assert.ok(notifications[0].message.includes("Plan stage started"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Plan Stage"));
    assert.ok(sentMessages[0].includes("Mission: Build a CLI"));
    assert.ok(sentMessages[0].includes("scout-angle_4.md"));
  });

  it("senai-plan warns when mission is empty", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("", makeCtx());
    assert.strictEqual(sentMessages.length, 0);
    assert.ok(notifications[0].message.includes("Usage"));
  });

  it("senai-plan blocks when agent config is missing", async () => {
    fs.rmSync(path.join(tmpDir, ".pi"), { recursive: true, force: true });
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    assert.strictEqual(sentMessages.length, 0);
    assert.ok(notifications[0].message.includes("No Pi Senai agent configuration found"));
  });

  it("senai-implement blocks when agent config maps a missing custom agent", async () => {
    saveAgentConfig(tmpDir, { version: 1, agents: { implementer: "missing-agent" } });
    registerCommands(makeApi());
    await commandHandlers["senai-implement"]("", makeCtx());
    assert.strictEqual(sentMessages.length, 0);
    assert.ok(notifications[0].message.includes("Agent configuration errors"));
    assert.ok(notifications[0].message.includes("missing-agent"));
  });

  it("senai-agents shows the current registry", async () => {
    registerAgentCommands(makeApi());
    await commandHandlers["senai-agents"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Pi Senai Agent Registry"));
    assert.ok(notifications[0].message.includes("Planner (planner) → planner"));
    assert.ok(notifications[0].message.includes("All mapped agents are available"));
  });

  it("senai-agents reports errors for invalid custom agents", async () => {
    saveAgentConfig(tmpDir, { version: 1, agents: { implementer: "missing-agent" } });
    registerAgentCommands(makeApi());
    await commandHandlers["senai-agents"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Pi Senai Agent Registry"));
    assert.ok(notifications[0].message.includes("missing-agent"));
    assert.strictEqual(notifications[0].type, "error");
  });

  it("senai-configure-agents saves a config from user choices", async () => {
    registerAgentCommands(makeApi());
    // Pre-program choices: for every role choose "Use default: <default>".
    for (const role of Object.keys(DEFAULT_AGENTS) as SenaiRole[]) {
      selectChoices.push(`Use default: ${DEFAULT_AGENTS[role]}`);
    }
    await commandHandlers["senai-configure-agents"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Agent configuration saved"));
    const configPath = path.join(tmpDir, ".pi/senai/agents.json");
    assert.ok(fs.existsSync(configPath));
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.version, 1);
    assert.strictEqual(saved.agents.implementer, "worker");
  });

  it("senai-configure-agents reads existing config on re-run", async () => {
    saveAgentConfig(tmpDir, { version: 1, agents: { planner: "custom-planner" } });
    registerAgentCommands(makeApi());

    for (const role of Object.keys(DEFAULT_AGENTS) as SenaiRole[]) {
      if (role === "planner") {
        selectChoices.push("Keep current: custom-planner");
      } else {
        selectChoices.push(`Use default: ${DEFAULT_AGENTS[role]}`);
      }
    }

    await commandHandlers["senai-configure-agents"]("", makeCtx());

    const configPath = path.join(tmpDir, ".pi/senai/agents.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.agents.planner, "custom-planner");
    assert.strictEqual(saved.agents.implementer, "worker");
  });

  it("senai-configure-agents lets the user go back", async () => {
    registerAgentCommands(makeApi());
    const roles = Object.keys(DEFAULT_AGENTS) as SenaiRole[];

    // Role 0: pick default, then role 1: go back, then role 0 again: pick default, then rest defaults.
    selectChoices.push(`Use default: ${DEFAULT_AGENTS[roles[0]]}`);
    selectChoices.push("← Back");
    selectChoices.push(`Use default: ${DEFAULT_AGENTS[roles[0]]}`);
    for (let i = 1; i < roles.length; i++) {
      selectChoices.push(`Use default: ${DEFAULT_AGENTS[roles[i]]}`);
    }

    await commandHandlers["senai-configure-agents"]("", makeCtx());

    const configPath = path.join(tmpDir, ".pi/senai/agents.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.version, 1);
    assert.strictEqual(saved.agents[roles[0]], DEFAULT_AGENTS[roles[0]]);
  });

  it("senai-status reports no active run", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-status"]("", makeCtx());
    assert.ok(notifications[0].message.includes("No active senai run"));
  });

  it("senai-status shows active run and next step", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    notifications.length = 0;
    await commandHandlers["senai-status"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Stage: planning"));
    assert.ok(notifications[0].message.includes("Mission: Mission"));
    assert.ok(notifications[0].message.includes("Next step: run /senai-approve"));
  });

  it("senai-approve advances stage and auto-runs next stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    notifications.length = 0;
    sentMessages.length = 0;

    await commandHandlers["senai-approve"]("", makeCtx());

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.ok(notifications[0].message.includes("Automatically running the next stage: /senai-implement"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Implement Stage"));
  });

  it("senai-approve finishes run after deliver stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    // Approve through all stages.
    await commandHandlers["senai-approve"]("", makeCtx()); // planning -> planned -> implementing
    await commandHandlers["senai-approve"]("", makeCtx()); // implementing -> implemented -> documenting
    await commandHandlers["senai-approve"]("", makeCtx()); // documenting -> documented -> delivering

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["senai-approve"]("", makeCtx()); // delivering -> delivered

    assert.strictEqual(loadState(tmpDir).currentStage, "delivered");
    assert.ok(notifications[0].message.includes("All stages are complete"));
    assert.strictEqual(sentMessages.length, 0);
  });

  it("senai-reset clears state", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    notifications.length = 0;
    await commandHandlers["senai-reset"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "none");
    assert.ok(notifications[0].message.includes("Senai state reset"));
  });

  it("senai-implement blocks when plan artifact is missing", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    notifications.length = 0;
    await commandHandlers["senai-implement"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Plan artifacts not found"));
  });

  it("senai-implement can be run directly from planned stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx()); // advances to implementing

    // Manually reset stage back to planned to test direct implement command.
    let state = loadState(tmpDir);
    state.currentStage = "planned";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    // Create the required plan artifacts for implement to proceed.
    const planPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "plan.md");
    const scoutsDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "scouts");
    fs.mkdirSync(scoutsDir, { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_1.md"), "# Scout 1\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_2.md"), "# Scout 2\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_3.md"), "# Scout 3\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_4.md"), "# Scout 4\n");

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["senai-implement"]("", makeCtx());

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

    const planPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "plan.md");
    const scoutsDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "scouts");
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

    const planPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "plan.md");
    const scoutsDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "scouts");
    fs.mkdirSync(scoutsDir, { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_1.md"), "# Scout 1\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_2.md"), "# Scout 2\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_3.md"), "# Scout 3\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_4.md"), "# Scout 4\n");

    const result = checkStageArtifact(loadState(tmpDir), "plan", makeCtx());
    assert.strictEqual(result.ok, true);
  });

  it("senai-document blocks when implement artifacts are missing", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx()); // planning -> planned -> implementing

    // Manually set state to implemented without creating implement artifacts.
    let state = loadState(tmpDir);
    state.currentStage = "implemented";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    notifications.length = 0;
    await commandHandlers["senai-document"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Implement artifacts not found"));
    assert.strictEqual(loadState(tmpDir).currentStage, "implemented");
  });

  it("senai-deliver blocks when document artifacts are missing", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx()); // planning -> planned -> implementing

    // Manually set state to documented without creating document artifacts.
    let state = loadState(tmpDir);
    state.currentStage = "documented";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    notifications.length = 0;
    await commandHandlers["senai-deliver"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Document artifacts not found"));
    assert.strictEqual(loadState(tmpDir).currentStage, "documented");
  });

  it("senai-document rejects running from planned stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx()); // planning -> planned -> implementing

    // Manually reset stage back to planned.
    let state = loadState(tmpDir);
    state.currentStage = "planned";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    // Create plan and implement artifacts so only the stage restriction is tested.
    const planPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "plan.md");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");
    const implementPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "implement", "notes.md");
    fs.mkdirSync(path.dirname(implementPath), { recursive: true });
    fs.writeFileSync(implementPath, "# Implement notes\n");

    notifications.length = 0;
    await commandHandlers["senai-document"]("", makeCtx());

    assert.ok(notifications[0].message.includes("can only run from 'implemented'"));
    assert.strictEqual(loadState(tmpDir).currentStage, "planned");
  });

  it("senai-implement succeeds from planned with plan artifact", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());

    // Reset back to planned so the manual command can be tested.
    let state = loadState(tmpDir);
    state.currentStage = "planned";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const planPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "plan.md");
    const scoutsDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "scouts");
    fs.mkdirSync(scoutsDir, { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_1.md"), "# Scout 1\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_2.md"), "# Scout 2\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_3.md"), "# Scout 3\n");
    fs.writeFileSync(path.join(scoutsDir, "scout-angle_4.md"), "# Scout 4\n");

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["senai-implement"]("", makeCtx());

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.ok(notifications[0].message.includes("Implement stage started"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Implement Stage"));
  });

  it("senai-document succeeds from implemented with artifacts", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());

    let state = loadState(tmpDir);
    state.currentStage = "implemented";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const planPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan", "plan.md");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "# Plan\n");

    const implementPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "implement", "notes.md");
    fs.mkdirSync(path.dirname(implementPath), { recursive: true });
    fs.writeFileSync(implementPath, "# Implement notes\n");

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["senai-document"]("", makeCtx());

    assert.strictEqual(loadState(tmpDir).currentStage, "documenting");
    assert.ok(notifications[0].message.includes("Document stage started"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Document Stage"));
  });

  it("senai-deliver succeeds from documented with artifacts", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());

    let state = loadState(tmpDir);
    state.currentStage = "documented";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const documentPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "document", "README.md");
    fs.mkdirSync(path.dirname(documentPath), { recursive: true });
    fs.writeFileSync(documentPath, "# Docs\n");

    const deliverDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "deliver");
    fs.mkdirSync(deliverDir, { recursive: true });
    fs.writeFileSync(path.join(deliverDir, "security-report.md"), "# Security\n");
    fs.writeFileSync(path.join(deliverDir, "deliver-summary.md"), "# Summary\n");

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["senai-deliver"]("", makeCtx());

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

    const deliverDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "deliver");
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

    const deliverDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "deliver");
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

    const implementPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "implement", "notes.md");
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

    const documentPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "document", "README.md");
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

    const deliverDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "deliver");
    fs.mkdirSync(deliverDir, { recursive: true });
    fs.writeFileSync(path.join(deliverDir, "security-report.md"), "# Security\n");
    fs.writeFileSync(path.join(deliverDir, "deliver-summary.md"), "# Summary\n");

    const result = checkStageArtifact(loadState(tmpDir), "deliver", makeCtx());
    assert.strictEqual(result.ok, true);
  });

  it("senai-status reports delivered run", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());

    notifications.length = 0;
    await commandHandlers["senai-status"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Stage: delivered"));
    assert.ok(notifications[0].message.includes("Next step: run /senai-status"));
  });

  it("senai-approve rejects when no run is active", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.ok(notifications[0].message.includes("No active senai run"));
  });

  it("senai-implement rejects from planning stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    notifications.length = 0;
    await commandHandlers["senai-implement"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Plan artifacts not found"));
  });

  it("registerFilesCommands registers file commands", () => {
    registerFilesCommands(makeApi());
    ["senai-files", "senai-configure-files"].forEach((cmd) =>
      assert.ok(commandHandlers[cmd], `missing ${cmd}`),
    );
  });

  it("registerAgentsFilesCommands registers agent file commands", () => {
    registerAgentsFilesCommands(makeApi());
    ["senai-agents-files", "senai-configure-agents-files"].forEach((cmd) =>
      assert.ok(commandHandlers[cmd], `missing ${cmd}`),
    );
  });

  it("senai-files shows configured project files", async () => {
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["Doc/"],
      inputDocuments: ["README.md"],
      testPaths: [],
      excludedPaths: [],
    });
    registerFilesCommands(makeApi());

    await commandHandlers["senai-files"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Pi Senai Project Files"));
    assert.ok(notifications[0].message.includes("README.md"));
    assert.ok(notifications[0].message.includes("Doc/"));
  });

  it("senai-agents-files shows configured assignments", async () => {
    saveAgentsFilesConfig(tmpDir, {
      version: 1,
      documents: { planner: { primary: "Doc/planner.md", reads: ["Doc/plan.md"] } },
    });
    registerAgentsFilesCommands(makeApi());

    await commandHandlers["senai-agents-files"]("", makeCtx());
    assert.ok(notifications[0].message.includes("Agent Document Assignments"));
    assert.ok(notifications[0].message.includes("Doc/planner.md"));
    assert.ok(notifications[0].message.includes("Doc/plan.md"));
  });

  it("senai-configure-files saves categorized choices", async () => {
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

    await commandHandlers["senai-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, ["src/"]);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/PRD.md"]);
  });

  it("senai-configure-files avoids folder and child file conflicts", async () => {
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

    await commandHandlers["senai-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/"]);
  });

  it("senai-configure-agents-files saves user choices", async () => {
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

    await commandHandlers["senai-configure-agents-files"]("", makeCtx());
    const saved = loadAgentsFilesConfig(tmpDir);
    assert.strictEqual(saved?.documents.planner?.primary, "Doc/planner.md");
    assert.deepStrictEqual(saved?.documents.planner?.reads, ["Doc/plan.md"]);
  });

  // Edge cases
  it("senai-configure-files handles empty suggestions gracefully", async () => {
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

    await commandHandlers["senai-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, ["custom/"]);
  });

  it("senai-configure-files prevents selecting nested folder and ancestor", async () => {
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

    await commandHandlers["senai-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, ["src/"]);
  });

  it("senai-configure-files allows test files inside selected code folders", async () => {
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

    await commandHandlers["senai-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, ["src/"]);
    assert.deepStrictEqual(saved?.testPaths, ["src/main.test.ts"]);
  });

  it("senai-configure-files filters suggestions by name", async () => {
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

    await commandHandlers["senai-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/beta.md"]);
  });

  it("senai-configure-files paginates long suggestion lists", async () => {
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

    await commandHandlers["senai-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/doc12.md"]);
  });

  it("senai-configure-files picker can select a folder for input documents", async () => {
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

    await commandHandlers["senai-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.inputDocuments, ["docs/"]);
  });

  it("senai-configure-files picker cancels without adding a path", async () => {
    registerFilesCommands(makeApi());
    selectChoices.push(
      "Edit code paths",
      "Add custom path",
      "❌ Cancel",
      "Back",
      "Finish",
    );

    await commandHandlers["senai-configure-files"]("", makeCtx());
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, []);
  });

  it("registerDoctorCommand registers /senai-doctor", async () => {
    registerDoctorCommand(makeApi());
    assert.ok(commandHandlers["senai-doctor"]);

    await commandHandlers["senai-doctor"]("", makeCtx());
    assert.ok(sentMessages.some((m) => m.includes("Architecture setup")));
  });

  it("registerArchitectInputsCommands cancels when main menu is dismissed", async () => {
    registerArchitectInputsCommands(makeApi());
    assert.ok(commandHandlers["senai-configure-architect-inputs"]);

    selectChoices.push(undefined as unknown as string);
    await commandHandlers["senai-configure-architect-inputs"]("", makeCtx());
    assert.ok(notifications.some((n) => n.message.includes("Configuration cancelled")));
  });

  it("senai-configure-architect-inputs saves selected suggestions", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");

    registerArchitectInputsCommands(makeApi());
    selectChoices.push(
      "⬜ prd: PRD — not set",
      "⬜ Suggest: docs/PRD.md",
      "Back",
      "⬜ Finish",
    );

    await commandHandlers["senai-configure-architect-inputs"]("", makeCtx());
    const saved = loadArchitectInputsConfig(tmpDir);
    assert.ok(saved);
    assert.ok(saved?.documents.some((d) => d.type === "prd" && d.path === "docs/PRD.md"));
  });

  it("senai-configure-architect-inputs adds custom path via browser", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");

    registerArchitectInputsCommands(makeApi());
    selectChoices.push(
      "⬜ prd: PRD — not set",
      "Add custom path",
      "📂 docs/",
      "📄 PRD.md",
      "Back",
      "⬜ Finish",
    );

    await commandHandlers["senai-configure-architect-inputs"]("", makeCtx());
    const saved = loadArchitectInputsConfig(tmpDir);
    assert.ok(saved?.documents.some((d) => d.type === "prd" && d.path === "docs/PRD.md"));
  });

  it("senai-configure-architect-inputs saves additional constraints", async () => {
    registerArchitectInputsCommands(makeApi());
    editorValues.push("Keep it simple");
    selectChoices.push(
      "⬜ additional-constraints: Additional constraints — not set",
      "⬜ Finish",
    );

    await commandHandlers["senai-configure-architect-inputs"]("", makeCtx());
    const saved = loadArchitectInputsConfig(tmpDir);
    assert.deepStrictEqual(saved?.additionalConstraints, ["Keep it simple"]);
  });

  it("registerArchitectCommand warns when no architect inputs configured", async () => {
    registerArchitectCommand(makeApi());
    assert.ok(commandHandlers["senai-generate-architect"]);

    await commandHandlers["senai-generate-architect"]("", makeCtx());
    assert.ok(notifications.some((n) => n.message.includes("No architect inputs configured")));
  });

  it("registerArchitectCommand sends prompt when inputs configured", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: ["Keep it simple"],
    });

    registerArchitectCommand(makeApi());
    await commandHandlers["senai-generate-architect"]("", makeCtx());
    assert.ok(sentMessages.some((m) => m.includes("<pi-senai-generate-architect>")));
    assert.ok(sentMessages.some((m) => m.includes("docs/PRD.md")));
    assert.ok(sentMessages.some((m) => m.includes("feasibility")));
  });
});


describe("commands helpers", () => {
  it("normalizePath converts backslashes and preserves trailing slash", () => {
    assert.strictEqual(normalizePath("src\\app\\main.ts"), "src/app/main.ts");
    assert.strictEqual(normalizePath("src/app/"), "src/app/");
  });

  it("matchesFilter returns true for empty query and case-insensitive match", () => {
    assert.strictEqual(matchesFilter("src/app.ts", ""), true);
    assert.strictEqual(matchesFilter("src/app.ts", "APP"), true);
    assert.strictEqual(matchesFilter("src/app.ts", "app"), true);
    assert.strictEqual(matchesFilter("src/app.ts", "missing"), false);
  });

  it("isPathConflict detects exact duplicates and folder-child conflicts", () => {
    assert.strictEqual(isPathConflict("src/app.ts", ["src/app.ts"], []), true);
    assert.strictEqual(isPathConflict("src/", ["src/app.ts"], []), true);
    assert.strictEqual(isPathConflict("src/app.ts", ["src/"], []), true);
    assert.strictEqual(isPathConflict("src/app.ts", ["tests/"], []), false);
    assert.strictEqual(isPathConflict("src/app.ts", [], ["other/"]), false);
  });

  it("isFolderLike detects directories and files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-helper-"));
    const filePath = path.join(tmpDir, "file.txt");
    fs.writeFileSync(filePath, "x");
    const subDir = path.join(tmpDir, "sub");
    fs.mkdirSync(subDir);

    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const fileEntry = entries.find((e) => e.name === "file.txt");
    const dirEntry = entries.find((e) => e.name === "sub");
    assert.ok(fileEntry);
    assert.ok(dirEntry);
    assert.strictEqual(isFolderLike(filePath, fileEntry!), false);
    assert.strictEqual(isFolderLike(subDir, dirEntry!), true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("buildCategoryItems filters suggestions and excludes conflicts", () => {
    const suggestions = ["src/", "src/app.ts", "tests/", "README.md"];
    const current = ["src/"];
    const other = ["tests/"];
    const items = buildCategoryItems(suggestions, current, other);
    assert.ok(items.some((i) => i.value === "README.md" && i.kind === "suggestion"));
    assert.ok(items.some((i) => i.value === "src/" && i.kind === "selected"));
    assert.ok(!items.some((i) => i.value === "tests/"));
    assert.ok(!items.some((i) => i.value === "src/app.ts"));
  });

  it("defaultArchitectSkill returns non-empty architect prompt", () => {
    const skill = defaultArchitectSkill();
    assert.ok(skill.length > 0);
    assert.ok(skill.includes("Architect Generation"));
  });
});
