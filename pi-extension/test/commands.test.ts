import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkStageArtifact,
  registerCommands,
  registerDiscussionCommands,
  registerAgentCommands,
  registerFilesCommands,
  registerAgentsFilesCommands,
  registerDoctorCommand,
  registerDocsStructureCommand,
  registerArchitectInputsCommands,
  registerArchitectCommand,
  registerAgentGeneratorCommand,
  buildCategoryItems,
  matchesFilter,
  normalizePath,
  isPathConflict,
  isFolderLike,
  defaultArchitectSkill,
  listMissingStageArtifacts,
} from "../src/commands.js";
import { loadState, startRun, advanceStage } from "../src/state.js";
import type { SenaiState } from "../src/state.js";
import type { Stage } from "../src/constants.js";
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { saveAgentConfig, CONFIG_COMMENT } from "../src/agent-config.js";
import { saveFilesConfig, loadFilesConfig, FILES_CONFIG_COMMENT } from "../src/files-config.js";
import { saveAgentsFilesConfig, loadAgentsFilesConfig, AGENTS_FILES_CONFIG_COMMENT } from "../src/agents-files-config.js";
import {
  loadArchitectInputsConfig,
  saveArchitectInputsConfig,
  ARCHITECT_INPUTS_CONFIG_COMMENT,
} from "../src/architect-inputs-config.js";
import { saveArchitectReport, slugify } from "../src/architect.js";
import { resolveSkillPath } from "../src/prompt.js";
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
      getContextUsage: () => undefined,
      compact: () => {},
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
    registerDiscussionCommands(makeApi());

    [
      "senai-plan",
      "senai-implement",
      "senai-document",
      "senai-deliver",
      "senai-status",
      "senai-approve",
      "senai-reset",
      "senai-discussion",
      "senai-discussion-approve",
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

    let edited = false;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agents") {
        if (!edited) return options.find((o) => o.includes("implementer:"));
        return "⬜ Finish";
      }
      edited = true;
      return options.find((o) => o.startsWith("Use default:"));
    };

    await commandHandlers["senai-configure-agents"]("", ctx);
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

    let edited = false;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agents") {
        if (!edited) return options.find((o) => o.includes("planner:"));
        return "⬜ Finish";
      }
      edited = true;
      return options.find((o) => o.startsWith("Keep current:"));
    };

    await commandHandlers["senai-configure-agents"]("", ctx);

    const configPath = path.join(tmpDir, ".pi/senai/agents.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.agents.planner, "custom-planner");
    assert.strictEqual(Object.keys(saved.agents).length, Object.keys(DEFAULT_AGENTS).length);
  });

  it("senai-configure-agents returns to the role list after editing a role", async () => {
    registerAgentCommands(makeApi());
    const roles = Object.keys(DEFAULT_AGENTS) as SenaiRole[];

    let edits = 0;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agents") {
        if (edits === 0) return options.find((o) => o.includes(`${roles[0]}:`));
        if (edits === 1) return options.find((o) => o.includes(`${roles[1]}:`));
        return "⬜ Finish";
      }
      edits++;
      return options.find((o) => o.startsWith("Use default:"));
    };

    await commandHandlers["senai-configure-agents"]("", ctx);

    const configPath = path.join(tmpDir, ".pi/senai/agents.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.version, 1);
    assert.strictEqual(saved.agents[roles[0]], DEFAULT_AGENTS[roles[0]]);
    assert.strictEqual(saved.agents[roles[1]], DEFAULT_AGENTS[roles[1]]);
    assert.strictEqual(edits, 2, "both roles edited through the list loop");
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

  it("senai-approve compacts the parent context when usage is 50% or higher", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    const compactCalls: unknown[] = [];
    const ctx = makeCtx();
    ctx.getContextUsage = () => ({ tokens: 130000, contextWindow: 200000, percent: 65 });
    ctx.compact = (options?: unknown) => {
      compactCalls.push(options);
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.strictEqual(compactCalls.length, 1);
  });

  it("senai-approve skips compaction when usage is below 50%", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    const compactCalls: unknown[] = [];
    const ctx = makeCtx();
    ctx.getContextUsage = () => ({ tokens: 40000, contextWindow: 200000, percent: 20 });
    ctx.compact = (options?: unknown) => {
      compactCalls.push(options);
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.strictEqual(compactCalls.length, 0);
  });

  it("senai-approve compacts when usage is exactly 50%", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    const compactCalls: unknown[] = [];
    const ctx = makeCtx();
    ctx.getContextUsage = () => ({ tokens: 100000, contextWindow: 200000, percent: 50 });
    ctx.compact = (options?: unknown) => {
      compactCalls.push(options);
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(compactCalls.length, 1);
  });

  it("senai-approve does not compact when percent is null (tokens unknown)", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    sentMessages.length = 0;

    const compactCalls: unknown[] = [];
    const ctx = makeCtx();
    ctx.getContextUsage = () => ({ tokens: null, contextWindow: 200000, percent: null });
    ctx.compact = (options?: unknown) => {
      compactCalls.push(options);
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.strictEqual(compactCalls.length, 0);
    assert.ok(sentMessages.some((m) => m.includes("Implement Stage")));
  });

  it("senai-approve compacts on absolute tokens when percent is null", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    sentMessages.length = 0;

    const compactCalls: unknown[] = [];
    const ctx = makeCtx();
    // percent null (e.g. right after a provider gap), but tokens known and
    // above 40% of the window — the gate must still fire.
    ctx.getContextUsage = () => ({ tokens: 90000, contextWindow: 200000, percent: null });
    ctx.compact = (options?: unknown) => {
      compactCalls.push(options);
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.strictEqual(compactCalls.length, 1);
  });

  function writePlanArtifacts(cwd: string, runId: string): void {
    const runDir = path.join(cwd, ".IDE_Plans", "senai", "runs", runId);
    fs.writeFileSync(path.join(runDir, "plan", "plan.md"), "# plan\n", "utf8");
    for (let i = 1; i <= 4; i++) {
      fs.writeFileSync(path.join(runDir, "plan", "scouts", `scout-angle_${i}.md`), "scout\n", "utf8");
    }
  }

  it("senai-approve warns about missing artifacts and does not advance when declined", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    // plan.md and the scout reports were never written.
    const confirmTitles: string[] = [];
    let confirmCount = 0;
    const ctx = makeCtx();
    ctx.ui.confirm = async (title: string) => {
      confirmTitles.push(title);
      confirmCount += 1;
      return confirmCount === 1; // approve the stage, decline the missing-artifacts override
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.deepStrictEqual(confirmTitles, ["Approve stage", "Artifacts missing"]);
    assert.strictEqual(loadState(tmpDir).currentStage, "planning");
    assert.strictEqual(sentMessages.length, 1, "no next-stage prompt should be sent");
  });

  it("senai-approve advances with artifacts verified and records the stage result", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    const runId = loadState(tmpDir).runId;
    writePlanArtifacts(tmpDir, runId);

    const confirmTitles: string[] = [];
    const ctx = makeCtx();
    ctx.ui.confirm = async (title: string) => {
      confirmTitles.push(title);
      return true;
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.deepStrictEqual(confirmTitles, ["Approve stage"], "no missing-artifacts confirm");
    const state = loadState(tmpDir);
    assert.strictEqual(state.currentStage, "implementing");
    assert.match(state.stageResults.planning ?? "", /^approved .*; artifacts: verified$/);
  });

  it("senai-approve advances on confirmed missing artifacts and records the outcome", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    const ctx = makeCtx(); // confirm always true: approve + advance anyway
    await commandHandlers["senai-approve"]("", ctx);

    const state = loadState(tmpDir);
    assert.strictEqual(state.currentStage, "implementing");
    assert.match(state.stageResults.planning ?? "", /artifacts: missing 5 \(user confirmed\)$/);
  });

  it("listMissingStageArtifacts reports per-stage expectations", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    const runId = loadState(tmpDir).runId;
    const runDir = path.join(tmpDir, ".IDE_Plans", "senai", "runs", runId);

    // plan: plan.md + 4 scouts required.
    assert.strictEqual(listMissingStageArtifacts(tmpDir, runId, "plan").length, 5);
    writePlanArtifacts(tmpDir, runId);
    assert.deepStrictEqual(listMissingStageArtifacts(tmpDir, runId, "plan"), []);

    // implement/document: any file in the directory satisfies the check.
    assert.deepStrictEqual(listMissingStageArtifacts(tmpDir, runId, "implement"), [
      "implement/ (no files)",
    ]);
    fs.writeFileSync(path.join(runDir, "implement", "notes.md"), "done\n", "utf8");
    assert.deepStrictEqual(listMissingStageArtifacts(tmpDir, runId, "implement"), []);
    assert.deepStrictEqual(listMissingStageArtifacts(tmpDir, runId, "document"), [
      "document/ (no files)",
    ]);

    // deliver: both report files required and non-empty.
    assert.deepStrictEqual(listMissingStageArtifacts(tmpDir, runId, "deliver"), [
      "deliver/security-report.md",
      "deliver/deliver-summary.md",
    ]);
    fs.writeFileSync(path.join(runDir, "deliver", "security-report.md"), "ok\n", "utf8");
    fs.writeFileSync(path.join(runDir, "deliver", "deliver-summary.md"), "", "utf8");
    assert.deepStrictEqual(listMissingStageArtifacts(tmpDir, runId, "deliver"), [
      "deliver/deliver-summary.md",
    ]);
  });

  it("senai-approve does not compact on the final approval (no next stage)", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "delivering");

    const compactCalls: unknown[] = [];
    const ctx = makeCtx();
    ctx.getContextUsage = () => ({ tokens: 190000, contextWindow: 200000, percent: 95 });
    ctx.compact = (options?: unknown) => {
      compactCalls.push(options);
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(loadState(tmpDir).currentStage, "delivered");
    assert.strictEqual(compactCalls.length, 0);
  });

  it("senai-approve invokes compact before the next stage prompt is sent", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    sentMessages.length = 0;

    const ctx = makeCtx();
    ctx.getContextUsage = () => ({ tokens: 130000, contextWindow: 200000, percent: 65 });
    let promptCountAtCompactTime = -1;
    ctx.compact = () => {
      promptCountAtCompactTime = sentMessages.length;
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(promptCountAtCompactTime, 0);
    assert.strictEqual(sentMessages.length, 1);
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

    // Top-level role picker: choose scout-4.
    // Per-role editor: set truth, add read, go back.
    // Top-level: finish.
    selectChoices.push(
      "⬜ scout-4: Scout 4 — PRD / documentation audit (needs: PRD / requirements document) (scout) — not set [recommended]",
      "Set truth document",
      "Doc/planner.md",
      "⬜ Suggest: Doc/plan.md",
      "Back",
      "⬜ Finish",
    );

    await commandHandlers["senai-configure-agents-files"]("", makeCtx());
    const saved = loadAgentsFilesConfig(tmpDir);
    assert.strictEqual(saved?.documents["scout-4"]?.primary, "Doc/planner.md");
    assert.deepStrictEqual(saved?.documents["scout-4"]?.reads, ["Doc/plan.md"]);
  });

  it("senai-configure-agents-files picker labels carry guidance tags", async () => {
    registerAgentsFilesCommands(makeApi());

    const captured: string[][] = [];
    const ctx = {
      cwd: tmpDir,
      ui: {
        notify: () => {},
        select: async (_title: string, options: string[]) => {
          captured.push(options);
          return "⬜ Finish"; // leave the picker immediately
        },
      },
    } as unknown as ExtensionContext;

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    assert.ok(captured.length > 0, "role picker was shown");
    const labels = captured[0];
    assert.ok(
      labels.some((l) => l.includes("scout-1") && l.includes("[design-defined]")),
      "scout-1 row carries the design-defined tag",
    );
    assert.ok(
      labels.some((l) => l.includes("scout-3") && l.includes("[optional]")),
      "scout-3 row carries the optional tag",
    );
    assert.ok(
      labels.some((l) => l.includes("scout-4") && l.includes("[recommended]")),
      "scout-4 row carries the recommended tag",
    );
    assert.ok(
      !labels.some((l) => l.includes("planner:")),
      "planner is hidden from the picker",
    );
    assert.ok(
      !labels.some((l) => l.includes("security-gate:")),
      "security-gate is hidden from the picker",
    );
    assert.ok(
      !labels.some((l) => l.includes("discussion:")),
      "discussion is hidden from the picker",
    );
    assert.ok(
      !labels.some((l) => l.includes("code-review:")),
      "code-review is hidden from the picker",
    );
  });

  it("senai-configure-agents-files shows needs text and doctor suggestion for unassigned roles", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "rtm", path: "docs/RTM.md" }],
      additionalConstraints: [],
    });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "RTM.md"), "# RTM", "utf8");
    registerAgentsFilesCommands(makeApi());

    const captured: string[][] = [];
    const ctx = {
      cwd: tmpDir,
      ui: {
        notify: () => {},
        select: async (_title: string, options: string[]) => {
          captured.push(options);
          return "⬜ Finish"; // leave the picker immediately
        },
      },
    } as unknown as ExtensionContext;

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const row = captured[0].find((l) => l.includes("reviewer-correctness:"));
    assert.ok(row, "reviewer-correctness row exists");
    assert.ok(row.includes("(needs: RTM / traceability document)"), "plain document-type name shown");
    assert.ok(row.includes("not set, suggested: docs/RTM.md"), "doctor's concrete suggestion shown");
  });

  it("senai-configure-agents-files hides the suggestion for assigned roles", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "rtm", path: "docs/RTM.md" }],
      additionalConstraints: [],
    });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "RTM.md"), "# RTM", "utf8");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "reviewer-correctness": { primary: "docs/RTM.md" } },
    });
    registerAgentsFilesCommands(makeApi());

    const captured: string[][] = [];
    const ctx = {
      cwd: tmpDir,
      ui: {
        notify: () => {},
        select: async (_title: string, options: string[]) => {
          captured.push(options);
          return "⬜ Finish";
        },
      },
    } as unknown as ExtensionContext;

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const row = captured[0].find((l) => l.includes("reviewer-correctness:"));
    assert.ok(row, "reviewer-correctness row exists");
    assert.ok(row.includes("truth=docs/RTM.md"), "assigned summary shown");
    assert.ok(!row.includes("suggested:"), "no suggestion noise on assigned rows");
  });

  it("senai-configure-agents-files shows plain 'not set' when no suggestion exists", async () => {
    registerAgentsFilesCommands(makeApi());
    const captured: string[][] = [];
    const ctx = {
      cwd: tmpDir,
      ui: {
        notify: () => {},
        select: async (_title: string, options: string[]) => {
          captured.push(options);
          return "⬜ Finish";
        },
      },
    } as unknown as ExtensionContext;

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const row = captured[0].find((l) => l.includes("reviewer-correctness:"));
    assert.ok(row, "reviewer-correctness row exists");
    assert.ok(row.includes("— not set"), "plain not set shown");
    assert.ok(!row.includes("suggested:"), "no suggestion text without a candidate");
  });

  it("senai-configure-agents-files suggests a keyword-matched input document", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "security-policy.md"), "# Security", "utf8");
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: ["docs/security-policy.md"],
      testPaths: [],
      excludedPaths: [],
    });
    registerAgentsFilesCommands(makeApi());
    const captured: string[][] = [];
    const ctx = {
      cwd: tmpDir,
      ui: {
        notify: () => {},
        select: async (_title: string, options: string[]) => {
          captured.push(options);
          return "⬜ Finish";
        },
      },
    } as unknown as ExtensionContext;

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const row = captured[0].find((l) => l.includes("reviewer-security:"));
    assert.ok(row, "reviewer-security row exists");
    assert.ok(row.includes("not set, suggested: docs/security-policy.md"), "keyword-matched suggestion shown");
  });

  it("senai-configure-agents-files hides the suggestion for reads-only assignments", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "rtm", path: "docs/RTM.md" }],
      additionalConstraints: [],
    });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "RTM.md"), "# RTM", "utf8");
    fs.writeFileSync(path.join(tmpDir, "docs", "extra.md"), "# Extra", "utf8");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "reviewer-correctness": { reads: ["docs/extra.md"] } },
    });
    registerAgentsFilesCommands(makeApi());
    const captured: string[][] = [];
    const ctx = {
      cwd: tmpDir,
      ui: {
        notify: () => {},
        select: async (_title: string, options: string[]) => {
          captured.push(options);
          return "⬜ Finish";
        },
      },
    } as unknown as ExtensionContext;

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const row = captured[0].find((l) => l.includes("reviewer-correctness:"));
    assert.ok(row, "reviewer-correctness row exists");
    assert.ok(row.includes("reads=1"), "reads-only summary shown");
    assert.ok(!row.includes("suggested:"), "no suggestion text on reads-only rows");
  });

  it("senai-configure-agents-files shows needs only on document-rule rows", async () => {
    registerAgentsFilesCommands(makeApi());
    const captured: string[][] = [];
    const ctx = {
      cwd: tmpDir,
      ui: {
        notify: () => {},
        select: async (_title: string, options: string[]) => {
          captured.push(options);
          return "⬜ Finish";
        },
      },
    } as unknown as ExtensionContext;

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const labels = captured[0];
    assert.ok(labels.find((l) => l.includes("scout-1:"))?.includes("(needs: architecture / design document)"));
    assert.ok(labels.find((l) => l.includes("scout-4:"))?.includes("(needs: PRD / requirements document)"));
    assert.ok(labels.find((l) => l.includes("reviewer-correctness:"))?.includes("(needs: RTM / traceability document)"));
    assert.ok(labels.find((l) => l.includes("reviewer-security:"))?.includes("(needs: NFR / security requirements)"));
    assert.ok(labels.find((l) => l.includes("reviewer-tests:"))?.includes("(needs: test plan document)"));
    assert.ok(!labels.find((l) => l.includes("scout-2:"))?.includes("(needs:"), "scout-2 has no needs text");
    assert.ok(!labels.find((l) => l.includes("scout-3:"))?.includes("(needs:"), "scout-3 has no needs text");
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

  it("registerDocsStructureCommand creates stubs and notifies the counts", async () => {
    registerDocsStructureCommand(makeApi());
    assert.ok(commandHandlers["senai-generate-docs-structure"]);

    await commandHandlers["senai-generate-docs-structure"]("", makeCtx());
    assert.ok(fs.existsSync(path.join(tmpDir, "README.md")));
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "senai", "docs-structure.json")));
    assert.ok(notifications.some((n) => n.message.includes("created 1 stub(s)")));
    assert.ok(notifications.some((n) => n.message.includes("Next: /senai-plan")));
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

  it("registerArchitectCommand sends prompt without agent config", async () => {
    fs.rmSync(path.join(tmpDir, ".pi", "senai", "agents.json"));
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: [],
    });

    registerArchitectCommand(makeApi());
    await commandHandlers["senai-generate-architect"]("", makeCtx());

    assert.ok(sentMessages.some((m) => m.includes("<pi-senai-generate-architect>")));
    assert.ok(!notifications.some((n) => n.message.includes("No Pi Senai agent configuration found")));
  });

  it("registerArchitectCommand asks to re-run when inputs changed and user confirms", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: [],
    });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD v2", "utf8");
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    const driversPath = path.join(tmpDir, ".pi", "architect", "architectural-drivers.json");
    fs.writeFileSync(
      driversPath,
      JSON.stringify({
        functionalRequirements: [],
        qualityAttributes: [],
        constraints: [],
        technicalConcerns: [],
        uncertainties: [],
      }),
      "utf8",
    );
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(driversPath, old, old);

    registerArchitectCommand(makeApi());
    await commandHandlers["senai-generate-architect"]("", makeCtx());

    assert.ok(sentMessages.some((m) => m.includes("<pi-senai-generate-architect>")));
    assert.ok(sentMessages.some((m) => m.includes("Regenerate architectural drivers")));
  });

  it("registerArchitectCommand cancels when user declines the re-run", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: [],
    });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD v2", "utf8");
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    const driversPath = path.join(tmpDir, ".pi", "architect", "architectural-drivers.json");
    fs.writeFileSync(
      driversPath,
      JSON.stringify({
        functionalRequirements: [],
        qualityAttributes: [],
        constraints: [],
        technicalConcerns: [],
        uncertainties: [],
      }),
      "utf8",
    );
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(driversPath, old, old);

    registerArchitectCommand(makeApi());
    const ctx = makeCtx();
    (ctx.ui as any).confirm = async () => false;
    await commandHandlers["senai-generate-architect"]("", ctx);

    assert.ok(!sentMessages.some((m) => m.includes("<pi-senai-generate-architect>")));
    assert.ok(notifications.some((n) => n.message.includes("cancelled")));
  });

  it("registerArchitectCommand loads the bundled skill, not the fallback", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: [],
    });

    registerArchitectCommand(makeApi());
    await commandHandlers["senai-generate-architect"]("", makeCtx());

    assert.ok(
      sentMessages.some((m) => m.includes("## Preconditions")),
      "prompt should contain the real bundled skill",
    );
    assert.ok(
      !sentMessages.some((m) => m.includes("Follow the sequence in Doc/architect-sequence.md.")),
      "prompt should not contain the inline fallback",
    );
  });

  it("resolveSkillPath resolves an existing skill file", () => {
    const skillPath = resolveSkillPath("plan");
    assert.ok(skillPath.endsWith(path.join("skills", "senai-plan.md")));
    assert.ok(fs.existsSync(skillPath), `skill file should exist at ${skillPath}`);
  });

  it("senai-generate-agents reports nothing to do when all roles have custom agents", async () => {
    const custom: Record<string, string> = {};
    for (const role of [
      "scout-2", "scout-3", "scout-4", "discussion", "plan-overview",
      "test-skeleton", "linter", "full-test", "readme-writer", "changelog-writer",
      "api-docs-writer", "other-docs-writer", "security-gate", "archive",
    ] as SenaiRole[]) {
      custom[role] = DEFAULT_AGENTS[role] === "worker" ? "scout" : "worker";
    }
    saveAgentConfig(tmpDir, { version: 1, agents: { ...DEFAULT_AGENTS, ...custom } });

    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    assert.ok(notifications.some((n) => n.message.includes("Nothing to generate")));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".pi", "agents")));
  });

  it("senai-generate-agents generates files and maps only default roles", async () => {
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { ...DEFAULT_AGENTS, "code-review": "worker" },
    });
    selectChoices = ["automation / scripts", "Use generic resource"];

    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.ok(saved.agents["scout-2"].endsWith("-scout-2"), "scout-2 should be remapped to the generated agent");
    const agentFile = path.join(tmpDir, ".pi", "agents", `${saved.agents["scout-2"]}.md`);
    assert.ok(fs.existsSync(agentFile));
    const content = fs.readFileSync(agentFile, "utf8");
    assert.ok(content.includes("## Your mandate"));
    assert.ok(content.includes("## Technology craft"));
    assert.strictEqual(saved.agents["code-review"], "worker", "custom mapping must stay untouched");
    assert.ok(notifications.some((n) => n.message.includes("/senai-doctor")));
  });

  it("senai-generate-agents creates agents.json when none exists", async () => {
    fs.rmSync(path.join(tmpDir, ".pi", "senai", "agents.json"));
    selectChoices = ["automation / scripts", "Use generic resource"];

    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.ok(saved.agents["scout-2"].endsWith("-scout-2"), "generated role should be mapped in the new agents.json");
    assert.ok(!notifications.some((n) => n.message.includes("No Pi Senai agent configuration found")));
  });

  it("senai-generate-agents writes nothing when the user declines", async () => {
    selectChoices = ["automation / scripts", "Use generic resource"];
    registerAgentGeneratorCommand(makeApi());
    const ctx = makeCtx();
    (ctx.ui as any).confirm = async () => false;
    await commandHandlers["senai-generate-sub-agents"]("", ctx);

    assert.ok(notifications.some((n) => n.message.includes("cancelled")));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".pi", "agents")));
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(saved.agents["scout-2"], "scout");
  });

  it("senai-generate-agents preserves an existing user file on name collision", async () => {
    selectChoices = ["automation / scripts", "Use generic resource"];
    const slug = slugify(path.basename(tmpDir));
    const collisionName = `${slug}-scout-2`;
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, `${collisionName}.md`), "USER_OWNED_CONTENT", "utf8");

    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    const content = fs.readFileSync(path.join(agentsDir, `${collisionName}.md`), "utf8");
    assert.strictEqual(content, "USER_OWNED_CONTENT", "user file must be preserved byte-for-byte");
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(saved.agents["scout-2"], "scout", "collided role must stay on its current mapping");
    assert.ok(saved.agents["scout-3"].endsWith("-scout-3"), "other roles are still generated");
  });

  it("senai-generate-agents second run regenerates proven-untouched agents in place", async () => {
    selectChoices = ["automation / scripts", "Use generic resource"];
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    const firstCount = fs.readdirSync(agentsDir).length;
    assert.ok(firstCount > 0);
    const firstContent = fs.readFileSync(
      path.join(agentsDir, fs.readdirSync(agentsDir)[0]),
      "utf8",
    );

    notifications = [];
    // Re-arm the picker answers: the second run asks the same questions.
    selectChoices = ["automation / scripts", "Use generic resource"];
    selectIndex = 0;
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    // Second run is no longer a no-op: previously generated agents are
    // regenerate candidates. Content is deterministic, so files stay
    // byte-identical and the summary reports the in-place regeneration.
    assert.ok(notifications.some((n) => n.message.includes("Regenerated")));
    assert.strictEqual(fs.readdirSync(agentsDir).length, firstCount);
    const secondContent = fs.readFileSync(
      path.join(agentsDir, fs.readdirSync(agentsDir)[0]),
      "utf8",
    );
    assert.strictEqual(secondContent, firstContent);
  });

  it("senai-generate-agents recreates a deleted agent whose mapping still exists", async () => {
    selectChoices = ["automation / scripts", "Use generic resource"];
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    // User deletes one generated file but agents.json still maps the role.
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    const deletedName = saved.agents["scout-2"];
    fs.rmSync(path.join(agentsDir, `${deletedName}.md`));

    notifications = [];
    selectChoices = ["automation / scripts", "Use generic resource"];
    selectIndex = 0;
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    // The stale mapping must not strand the role: the file is recreated.
    assert.ok(fs.existsSync(path.join(agentsDir, `${deletedName}.md`)), "deleted agent must be recreated");
    assert.ok(notifications.some((n) => n.message.includes("Generated 1 agent(s)")));
    assert.ok(notifications.some((n) => n.message.includes("Regenerated")));
    const after = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(after.agents["scout-2"], deletedName, "mapping stays intact");
  });

  it("senai-generate-agents keeps user-edited agents and says so in the summary", async () => {
    selectChoices = ["automation / scripts", "Use generic resource"];
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    const agentsDir = path.join(tmpDir, ".pi", "agents");
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    const editedFile = path.join(agentsDir, `${saved.agents["scout-2"]}.md`);
    const edited = `${fs.readFileSync(editedFile, "utf8")}\n\nUSER CUSTOM RULE`;
    fs.writeFileSync(editedFile, edited, "utf8");

    notifications = [];
    selectChoices = ["automation / scripts", "Use generic resource"];
    selectIndex = 0;
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    assert.strictEqual(fs.readFileSync(editedFile, "utf8"), edited, "user edits must survive regeneration");
    assert.ok(
      notifications.some((n) => n.message.includes("Kept 1 agent(s) you edited")),
      "summary must report the kept drifted agent",
    );
  });

  it("senai-generate-agents uses generic when the user picks it explicitly", async () => {
    selectChoices = ["automation / scripts", "Use generic resource"];
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.ok(saved.agents["scout-2"].endsWith("-scout-2"));
    assert.ok(notifications.some((n) => n.message.includes("Generic")), "should mention the generic resource was used");
  });

  it("senai-generate-agents cancels when the user picks Cancel", async () => {
    selectChoices = ["automation / scripts", "Cancel"];
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    assert.ok(notifications.some((n) => n.message.includes("cancelled")));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".pi", "agents")));
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(saved.agents["scout-2"], "scout");
  });

  it("senai-generate-agents sends the fetch prompt when the user picks Fetch", async () => {
    selectChoices = ["automation / scripts", "Fetch from official docs (recommended)"];
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    assert.ok(sentMessages.some((m) => m.includes("<pi-senai-fetch-technology>")));
    assert.ok(sentMessages.some((m) => m.includes(".pi/technologies/")));
    assert.ok(sentMessages.some((m) => m.includes("OFFICIAL documentation")));
    assert.ok(sentMessages.some((m) => m.includes("## Core rules")));
    assert.ok(sentMessages.some((m) => m.includes("Re-run /senai-generate-sub-agents")));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".pi", "agents")), "no agents written on the fetch path");
  });

  it("senai-generate-agents skips the choice when a real resource matches", async () => {
    const techDir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(techDir, { recursive: true });
    fs.writeFileSync(
      path.join(techDir, "mytech.md"),
      [
        "---",
        "id: mytech",
        "name: My Tech",
        "keywords: [mytech, automation]",
        "---",
        "",
        "## Core rules",
        "",
        "1. MYTECH_CRAFT_MARKER_LINE (source: https://example.com/official)",
        "",
        "## Testing patterns",
        "",
        "1. Test with the official runner (source: https://example.com/official)",
        "",
        "## Tooling and limits",
        "",
        "1. Respect the official limits (source: https://example.com/official)",
        "",
        "## Common mistakes",
        "",
        "1. Do not guess behavior (source: https://example.com/official)",
        "",
      ].join("\n"),
      "utf8",
    );
    // No selectChoices: every select falls back to options[0]. The project-type
    // answer "automation / scripts" matches the seeded resource. If the
    // onlyGeneric choice select were shown, options[0] would take the Fetch
    // path and no agents would be written.
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.ok(saved.agents["scout-2"].endsWith("-scout-2"));
    const agentFile = path.join(tmpDir, ".pi", "agents", `${saved.agents["scout-2"]}.md`);
    const content = fs.readFileSync(agentFile, "utf8");
    assert.ok(content.includes("## Technology craft (My Tech)"), "matched resource craft must be embedded");
    assert.ok(content.includes("MYTECH_CRAFT_MARKER_LINE"));
    assert.ok(!content.includes("Technology craft (Generic"), "generic resource must not be used");
    assert.ok(!sentMessages.some((m) => m.includes("<pi-senai-fetch-technology>")), "no fetch prompt when a resource matches");
  });

  it("senai-generate-agents asks for the technology name when fetch has no hint", async () => {
    selectChoices = ["", "Fetch from official docs (recommended)"];
    inputs = ["", "", "rust"];
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    assert.ok(sentMessages.some((m) => m.includes("<pi-senai-fetch-technology>")));
    assert.ok(sentMessages.some((m) => m.includes("rust")));
    assert.ok(sentMessages.some((m) => m.includes(".pi/technologies/rust.md")));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".pi", "agents")), "no agents written on the fetch path");
  });

  it("senai-generate-agents cancels the fetch when the technology name is empty", async () => {
    selectChoices = ["", "Fetch from official docs (recommended)"];
    // All inputs empty: no language, no framework, no technology name.
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    assert.ok(notifications.some((n) => n.message.includes("No technology given. Agent generation cancelled.")));
    assert.ok(!sentMessages.some((m) => m.includes("<pi-senai-fetch-technology>")), "no fetch prompt without a technology name");
    assert.ok(!fs.existsSync(path.join(tmpDir, ".pi", "agents")));
  });

  it("senai-generate-agents skips the basic questions when an architect report exists", async () => {
    saveArchitectReport(tmpDir, {
      selectedArchitecture: "layered-monolith",
      confidence: "high" as const,
      missingResources: [],
      reasoning: "Test report.",
      skillProfile: { recommendedAgents: [], forbiddenPatterns: [] },
      developmentOrder: [],
      feasibility: "feasible" as const,
      feasibilityReasoning: "Clear.",
      techStack: ["python", "pytest"],
      atomicFunctions: [],
      systemOverview: "",
      components: [],
      interfaces: [],
      dataFlow: "",
      dataModel: "",
      deployment: "",
      qualityAttributeMapping: [],
      adrs: [],
      constraints: [],
    });
    const ctx = makeCtx();
    (ctx.ui as any).select = async () => {
      throw new Error("select must not be called when a report exists");
    };
    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", ctx);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.ok(saved.agents["scout-2"].endsWith("-scout-2"));
    const agentFile = path.join(tmpDir, ".pi", "agents", `${saved.agents["scout-2"]}.md`);
    const content = fs.readFileSync(agentFile, "utf8");
    assert.ok(content.includes("## Technology craft (Python)"), "python craft from the report tech stack must be embedded");
    assert.ok(content.includes("Follow PEP 8 style"));
    assert.ok(!sentMessages.some((m) => m.includes("<pi-senai-fetch-technology>")));
  });

  it("senai-doctor writes the report artifact", async () => {
    registerDoctorCommand(makeApi());
    await commandHandlers["senai-doctor"]("", makeCtx());
    const reportPath = path.join(tmpDir, ".IDE_Plans", "senai", "doctor-report.md");
    assert.ok(fs.existsSync(reportPath), "report artifact should be written");
    const content = fs.readFileSync(reportPath, "utf8");
    assert.ok(content.includes("Pi Senai Diagnostic Report"));
    assert.ok(sentMessages.some((m) => m.includes("Report saved to .IDE_Plans/senai/doctor-report.md")));
  });

  it("senai-generate-agents is not registered after the rename", async () => {
    registerAgentGeneratorCommand(makeApi());
    assert.ok(commandHandlers["senai-generate-sub-agents"], "new name registered");
    assert.strictEqual(commandHandlers["senai-generate-agents"], undefined, "old name must not be registered");
  });

  it("senai-approve leaves state unchanged when the user declines", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    notifications.length = 0;
    sentMessages.length = 0;

    const ctx = makeCtx();
    (ctx.ui as any).confirm = async () => false;
    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(loadState(tmpDir).currentStage, "planning");
    assert.strictEqual(sentMessages.length, 0);
    assert.ok(!notifications.some((n) => n.message.includes("approved")));
  });

  it("senai-approve reports an already delivered run", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "delivered");

    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["senai-approve"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Run is already delivered"));
    assert.strictEqual(loadState(tmpDir).currentStage, "delivered");
    assert.strictEqual(sentMessages.length, 0);
  });

  it("senai-reset reports when there is no active run and skips the confirm", async () => {
    registerCommands(makeApi());
    const ctx = makeCtx();
    let confirmCalled = false;
    (ctx.ui as any).confirm = async () => {
      confirmCalled = true;
      return true;
    };

    await commandHandlers["senai-reset"]("", ctx);

    assert.ok(notifications[0].message.includes("No active senai run to reset"));
    assert.strictEqual(notifications[0].type, "info");
    assert.strictEqual(confirmCalled, false);
  });

  it("senai-reset keeps the state file when the user declines", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    notifications.length = 0;

    const ctx = makeCtx();
    (ctx.ui as any).confirm = async () => false;
    await commandHandlers["senai-reset"]("", ctx);

    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    assert.ok(fs.existsSync(statePath), "state file must still exist");
    assert.strictEqual(loadState(tmpDir).currentStage, "planning");
  });

  it("checkStageArtifact fails when the run ID is missing", () => {
    const state: SenaiState = { ...loadState(tmpDir), currentStage: "planning" };
    const result = checkStageArtifact(state, "plan", makeCtx());
    assert.strictEqual(result.ok, false);
    assert.ok(notifications[0].message.includes("Run ID is missing"));
    assert.strictEqual(notifications[0].type, "error");
  });

  it("senai-status omits the artifacts section when the run ID is empty", async () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        mission: "Mission",
        runId: "",
        currentStage: "planning",
        startedAt: "2026-06-12T00:00:00Z",
        updatedAt: "2026-06-12T00:00:00Z",
        stageResults: {},
      }),
    );

    registerCommands(makeApi());
    await commandHandlers["senai-status"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Stage: planning"));
    assert.ok(!notifications[0].message.includes("Artifacts:"));
  });

  it("senai-document rejects running from the planned stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx()); // planning -> planned -> implementing

    let state = loadState(tmpDir);
    state.currentStage = "planned";
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    // Create implement artifacts so only the stage restriction is tested.
    const implementPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "implement", "notes.md");
    fs.mkdirSync(path.dirname(implementPath), { recursive: true });
    fs.writeFileSync(implementPath, "# Implement notes\n");

    notifications.length = 0;
    await commandHandlers["senai-document"]("", makeCtx());

    assert.ok(notifications[0].message.includes("can only run from 'implemented'"));
    assert.strictEqual(notifications[0].type, "warning");
    assert.strictEqual(loadState(tmpDir).currentStage, "planned");
  });

  it("senai-deliver rejects running from the implementing stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx()); // planning -> planned -> implementing

    const state = loadState(tmpDir);
    // Create document artifacts so only the stage restriction is tested.
    const documentPath = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "document", "README.md");
    fs.mkdirSync(path.dirname(documentPath), { recursive: true });
    fs.writeFileSync(documentPath, "# Docs\n");

    notifications.length = 0;
    await commandHandlers["senai-deliver"]("", makeCtx());

    assert.ok(notifications[0].message.includes("can only run from 'documented'"));
    assert.strictEqual(notifications[0].type, "warning");
    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
  });

  it("senai-agents warns when no agent configuration exists", async () => {
    fs.rmSync(path.join(tmpDir, ".pi"), { recursive: true, force: true });
    registerAgentCommands(makeApi());

    await commandHandlers["senai-agents"]("", makeCtx());

    assert.ok(notifications[0].message.includes("No agent configuration found"));
    assert.ok(notifications[0].message.includes("/senai-configure-agents"));
    assert.strictEqual(notifications[0].type, "warning");
    assert.ok(!notifications[0].message.includes("Pi Senai Agent Registry"));
  });

  it("senai-files reports when no project files are configured", async () => {
    fs.rmSync(path.join(tmpDir, ".pi", "senai", "files.json"));
    registerFilesCommands(makeApi());

    await commandHandlers["senai-files"]("", makeCtx());

    assert.ok(notifications[0].message.includes("No project files configured"));
    assert.ok(notifications[0].message.includes("/senai-configure-files"));
    assert.strictEqual(notifications[0].type, "info");
  });

  it("senai-agents-files reports when no assignments are configured", async () => {
    fs.rmSync(path.join(tmpDir, ".pi", "senai", "agents_files.json"));
    registerAgentsFilesCommands(makeApi());

    await commandHandlers["senai-agents-files"]("", makeCtx());

    assert.ok(notifications[0].message.includes("No agent document assignments configured"));
    assert.ok(notifications[0].message.includes("/senai-configure-agents-files"));
    assert.strictEqual(notifications[0].type, "info");
  });

  it("senai-configure-agents saves a hand-picked agent via Choose different", async () => {
    registerAgentCommands(makeApi());
    const roles = Object.keys(DEFAULT_AGENTS) as SenaiRole[];

    // Hermetic select: pick from the actually-offered options (user agents can
    // shadow built-ins, so exact labels differ per machine).
    let stage = 0;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agents") {
        if (stage === 0) return options.find((o) => o.includes(`${roles[0]}:`));
        return "⬜ Finish";
      }
      if (title.startsWith("Select agent for")) {
        stage = 2;
        return options.find((o) => o.startsWith("reviewer (")) ?? options[0];
      }
      stage = 1;
      return "Choose different";
    };

    await commandHandlers["senai-configure-agents"]("", ctx);

    const configPath = path.join(tmpDir, ".pi/senai/agents.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.agents[roles[0]], "reviewer");
    assert.strictEqual(saved.agents[roles[1]], DEFAULT_AGENTS[roles[1]]);
  });

  it("senai-configure-agents keeps the current value when the per-role menu is cancelled", async () => {
    registerAgentCommands(makeApi());
    const roles = Object.keys(DEFAULT_AGENTS) as SenaiRole[];

    let opened = false;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agents") {
        if (!opened) return options.find((o) => o.includes(`${roles[0]}:`));
        return "⬜ Finish";
      }
      opened = true;
      return undefined; // esc the per-role menu: no change
    };

    await commandHandlers["senai-configure-agents"]("", ctx);

    const configPath = path.join(tmpDir, ".pi/senai/agents.json");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(saved.agents[roles[0]], DEFAULT_AGENTS[roles[0]]);
    assert.strictEqual(saved.agents[roles[1]], DEFAULT_AGENTS[roles[1]]);
  });

  it("senai-configure-agents-files preserves entries for hidden roles", async () => {
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { implementer: { primary: "docs/IMPL.md", reads: ["docs/X.md"] } },
    });
    registerAgentsFilesCommands(makeApi());
    const ctx = makeCtx();
    (ctx.ui as any).select = async () => "⬜ Finish";

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents_files.json"), "utf8"));
    assert.deepStrictEqual(
      saved.documents.implementer,
      { primary: "docs/IMPL.md", reads: ["docs/X.md"] },
      "hidden-role entries must survive a configure run untouched",
    );
  });

  it("senai-configure-agents-files shows only the picker-visible roles", async () => {
    registerAgentsFilesCommands(makeApi());
    const ctx = makeCtx();
    const offered: string[][] = [];
    (ctx.ui as any).select = async (_title: string, options: string[]) => {
      offered.push(options);
      return "⬜ Finish";
    };

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const labels = offered[0];
    assert.strictEqual(labels.length, 8, "7 picker-visible roles + Finish");
    assert.ok(labels.some((l) => l.includes("Scout 1")), "scouts are shown");
    assert.ok(labels.some((l) => l.includes("Reviewer — Tests")), "reviewers are shown");
    assert.ok(!labels.some((l) => l.includes("Security gate")), "sequence roles are hidden");
    assert.ok(!labels.some((l) => l.includes("Planner")), "planner is hidden");
    assert.ok(!labels.some((l) => l.includes("Implementer")), "artifact roles are hidden");
    assert.ok(!labels.some((l) => l.includes("Archive")), "archive is hidden");
    assert.ok(!labels.some((l) => l.includes("Linter")), "linter is hidden");
  });

  it("senai-configure-agents-files removes the role entry when truth is cleared with no reads", async () => {
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-4": { primary: "Doc/planner.md" } },
    });
    registerAgentsFilesCommands(makeApi());

    selectChoices.push(
      "✅ scout-4: Scout 4 — PRD / documentation audit (needs: PRD / requirements document) (scout) — truth=Doc/planner.md [recommended]",
      "Clear truth",
      "Back",
      "⬜ Finish",
    );

    await commandHandlers["senai-configure-agents-files"]("", makeCtx());

    const saved = loadAgentsFilesConfig(tmpDir);
    assert.ok(saved);
    assert.strictEqual(saved.documents["scout-4"], undefined);
    assert.deepStrictEqual(Object.keys(saved.documents), []);
  });

  it("senai-configure-files can add and then remove an excluded path", async () => {
    fs.mkdirSync(path.join(tmpDir, "buildtmp"), { recursive: true });
    registerFilesCommands(makeApi());

    selectChoices.push(
      "Edit excluded paths",
      "Add excluded path",
      "📂 buildtmp/",
      "📁 Select this folder (buildtmp/)",
      "✅ Remove: buildtmp/",
      "Back",
      "Finish",
    );

    await commandHandlers["senai-configure-files"]("", makeCtx());

    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.excludedPaths, [".git/", "node_modules/"]);
  });

  it("senai-configure-files browser navigates into a subfolder and back to the parent", async () => {
    fs.mkdirSync(path.join(tmpDir, "src", "components"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    registerFilesCommands(makeApi());

    selectChoices.push(
      "Edit code paths",
      "Add custom path",
      "📂 src/",
      "⬆️ ../",
      "📂 docs/",
      "📁 Select this folder (docs/)",
      "Back",
      "Finish",
    );

    await commandHandlers["senai-configure-files"]("", makeCtx());

    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, ["docs/"]);
  });

  it("senai-generate-sub-agents falls back to basic questions when the architect report is corrupted", async () => {
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-report.json"),
      "{ not valid json",
    );
    selectChoices = ["automation / scripts", "Use generic resource"];

    const ctx = makeCtx();
    const selectTitles: string[] = [];
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      selectTitles.push(title);
      if (selectIndex >= selectChoices.length) return options[0];
      return selectChoices[selectIndex++];
    };

    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", ctx);

    assert.ok(selectTitles.includes("Project type?"), "basic questions should be asked");
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.ok(saved.agents["scout-2"].endsWith("-scout-2"));
  });

  it("senai-generate-sub-agents reports skipped files on a name collision", async () => {
    selectChoices = ["automation / scripts", "Use generic resource"];
    const slug = slugify(path.basename(tmpDir));
    const collisionName = `${slug}-scout-2`;
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, `${collisionName}.md`), "USER_OWNED_CONTENT", "utf8");

    registerAgentGeneratorCommand(makeApi());
    await commandHandlers["senai-generate-sub-agents"]("", makeCtx());

    assert.ok(
      notifications.some((n) => n.message.includes("Skipped 1 existing file(s)")),
      "notification should report the skipped collision",
    );
  });

  it("senai-generate-architect adds the change note without a confirm when drivers are missing", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: [],
    });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");

    const ctx = makeCtx();
    let confirmCalled = false;
    (ctx.ui as any).confirm = async () => {
      confirmCalled = true;
      return true;
    };

    registerArchitectCommand(makeApi());
    await commandHandlers["senai-generate-architect"]("", ctx);

    assert.strictEqual(confirmCalled, false, "no confirm dialog when the drivers file is missing");
    assert.ok(sentMessages.some((m) => m.includes("<pi-senai-generate-architect>")));
    assert.ok(sentMessages.some((m) => m.includes("Note: Input documents have changed.")));
  });

  it("checkStageArtifact treats an empty implement directory as missing", () => {
    const state = startRun(tmpDir, "Mission");
    advanceStage(tmpDir, state, "planning");

    // startRun creates the implement directory but leaves it empty.
    const result = checkStageArtifact(loadState(tmpDir), "implement", makeCtx());
    assert.strictEqual(result.ok, false);
    assert.ok(notifications[0].message.includes("Implement artifacts not found"));
  });

  it("checkStageArtifact passes when the implement directory holds only a subdirectory", () => {
    const state = startRun(tmpDir, "Mission");
    advanceStage(tmpDir, state, "planning");

    // dirHasFiles counts any entry, so a lone subdirectory is enough.
    const nestedDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "implement", "nested");
    fs.mkdirSync(nestedDir, { recursive: true });

    const result = checkStageArtifact(loadState(tmpDir), "implement", makeCtx());
    assert.strictEqual(result.ok, true);
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

describe("coverage audit gaps", () => {
  let tmpDir: string;
  let notifications: Array<{ message: string; type: string }>;
  let sentMessages: string[];
  let commandHandlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>>;
  let inputs: string[];
  let inputIndex: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-cmd-test-"));
    notifications = [];
    sentMessages = [];
    commandHandlers = {};
    inputs = [];
    inputIndex = 0;
    saveAgentConfig(tmpDir, { version: 1, agents: { ...DEFAULT_AGENTS } });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: [],
      testPaths: [],
      excludedPaths: [".git/", "node_modules/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
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
        editor: async (_title: string, _value: string) => "",
        select: async (_title: string, options: string[]) => options[0],
      },
      getContextUsage: () => undefined,
      compact: () => {},
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

  function writeStage(stage: Stage): SenaiState {
    const state = loadState(tmpDir);
    state.currentStage = stage;
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    return state;
  }

  function writePlanArtifacts(state: SenaiState): void {
    const planDir = path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId, "plan");
    const scoutsDir = path.join(planDir, "scouts");
    fs.mkdirSync(scoutsDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, "plan.md"), "# Plan\n");
    for (let i = 1; i <= 4; i++) {
      fs.writeFileSync(path.join(scoutsDir, `scout-angle_${i}.md`), `# Scout ${i}\n`);
    }
  }

  it("senai-implement warns when plan artifacts exist but the stage is not planned", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx()); // planning -> planned -> implementing
    writePlanArtifacts(loadState(tmpDir));

    notifications.length = 0;
    await commandHandlers["senai-implement"]("", makeCtx());

    assert.ok(notifications[0].message.includes("can only run from 'planned'"));
    assert.strictEqual(notifications[0].type, "warning");
    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
  });

  it("senai-status prints the artifacts block and next command for the planned stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    writeStage("planned");

    notifications.length = 0;
    await commandHandlers["senai-status"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Stage: planned"));
    assert.ok(notifications[0].message.includes("Artifacts:"));
    assert.ok(notifications[0].message.includes("plan.md:"));
    assert.ok(notifications[0].message.includes("security-report.md:"));
    assert.ok(notifications[0].message.includes("Next step: run /senai-implement"));
  });

  it("senai-configure-agents applies the suggested agent via Accept suggestion", async () => {
    // Accept is offered when the current value differs from the suggestion,
    // so seed every role with a value that matches no suggestion.
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: Object.fromEntries(
        (Object.keys(DEFAULT_AGENTS) as SenaiRole[]).map((r) => [r, "zzz-not-a-suggestion"]),
      ),
    });
    registerAgentCommands(makeApi());
    const roles = Object.keys(DEFAULT_AGENTS) as SenaiRole[];

    // Hermetic select: walk the roles until an "Accept suggestion" option
    // appears (suggestions depend on the machine's discovered agents).
    let accepted: string | undefined;
    let acceptedRole: string | undefined;
    let roleIdx = 0;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agents") {
        if (accepted !== undefined || roleIdx >= roles.length) return "⬜ Finish";
        return options.find((o) => o.includes(`${roles[roleIdx]}:`));
      }
      const accept = options.find((o) => o.startsWith("Accept suggestion:"));
      if (accept) {
        accepted = accept.replace("Accept suggestion: ", "");
        acceptedRole = roles[roleIdx];
        return accept;
      }
      roleIdx++;
      return undefined; // esc, try the next role
    };

    await commandHandlers["senai-configure-agents"]("", ctx);

    assert.ok(accepted, "an Accept suggestion option should have been offered");
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(saved.agents[acceptedRole!], accepted);
    assert.ok(notifications.some((n) => n.message.includes("Agent configuration saved")));
  });

  it("senai-configure-agents saves effective values when finishing without edits", async () => {
    registerAgentCommands(makeApi());
    const roles = Object.keys(DEFAULT_AGENTS) as SenaiRole[];

    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, _options: string[]) => {
      assert.strictEqual(title, "Configure agents");
      return "⬜ Finish";
    };

    await commandHandlers["senai-configure-agents"]("", ctx);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(saved.agents[roles[0]], DEFAULT_AGENTS[roles[0]]);
    assert.strictEqual(
      saved.agents[roles[roles.length - 1]],
      DEFAULT_AGENTS[roles[roles.length - 1]],
    );
    assert.ok(notifications.some((n) => n.message.includes("Agent configuration saved")));
  });

  it("senai-configure-agents falls back to the default when the Choose different sub-picker is cancelled", async () => {
    const roles = Object.keys(DEFAULT_AGENTS) as SenaiRole[];
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { ...DEFAULT_AGENTS, [roles[0]]: "custom-keep" },
    });
    registerAgentCommands(makeApi());

    let stage = 0;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agents") {
        if (stage === 0) return options.find((o) => o.includes(`${roles[0]}:`));
        return "⬜ Finish";
      }
      if (title.startsWith("Select agent for")) {
        stage = 2;
        return undefined; // cancelled sub-picker
      }
      stage = 1;
      return "Choose different";
    };

    await commandHandlers["senai-configure-agents"]("", ctx);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(saved.agents[roles[0]], DEFAULT_AGENTS[roles[0]]);
  });

  it("senai-files reports no files when the config exists but all categories are empty", async () => {
    // beforeEach saved a files.json with empty category arrays.
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "senai", "files.json")));
    registerFilesCommands(makeApi());

    await commandHandlers["senai-files"]("", makeCtx());

    assert.ok(notifications[0].message.includes("No project files configured"));
    assert.strictEqual(notifications[0].type, "info");
  });

  it("senai-agents-files reports no assignments when the documents object is empty", async () => {
    // beforeEach saved agents_files.json with documents: {}.
    registerAgentsFilesCommands(makeApi());

    await commandHandlers["senai-agents-files"]("", makeCtx());

    assert.ok(notifications[0].message.includes("No agent document assignments configured"));
    assert.strictEqual(notifications[0].type, "info");
  });

  it("senai-agents-files prints 'No assignments found' when entries have neither truth nor reads", async () => {
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: { planner: {} } });
    registerAgentsFilesCommands(makeApi());

    await commandHandlers["senai-agents-files"]("", makeCtx());

    assert.ok(notifications[0].message.includes("Pi Senai Agent Document Assignments"));
    assert.ok(notifications[0].message.includes("No assignments found."));
  });

  it("senai-configure-agents-files supports filter, add custom read, and esc-back in the role editor", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");
    registerAgentsFilesCommands(makeApi());
    inputs.push("prd"); // filter query for the first editor action

    let roleCalls = 0;
    let editorCalls = 0;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agent documents") {
        roleCalls++;
        if (roleCalls === 1) return options.find((o) => o.includes("scout-4:"));
        return "⬜ Finish";
      }
      if (title === "Browsing project root") return "📂 docs/";
      if (title.startsWith("Browsing")) return "📄 PRD.md";
      // Role document list editor.
      editorCalls++;
      if (editorCalls === 1) return "Filter suggestions...";
      if (editorCalls === 2) return "Add custom path";
      return undefined; // esc → back
    };

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const saved = loadAgentsFilesConfig(tmpDir);
    assert.ok(saved);
    assert.deepStrictEqual(saved.documents["scout-4"]?.reads, ["docs/PRD.md"]);
    assert.strictEqual(saved.documents["scout-4"]?.primary, undefined);
  });

  it("senai-configure-agents-files clears the truth document via the picker clear item", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");
    fs.writeFileSync(path.join(tmpDir, "docs", "extra.md"), "# Extra", "utf8");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-4": { primary: "docs/PRD.md" } },
    });
    registerAgentsFilesCommands(makeApi());

    let roleCalls = 0;
    let editorCalls = 0;
    let truthPickerOptions: string[] = [];
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agent documents") {
        roleCalls++;
        if (roleCalls === 1) return options.find((o) => o.includes("scout-4:"));
        return "⬜ Finish";
      }
      if (title === "Select truth document") {
        truthPickerOptions = options;
        return "(clear truth document)"; // hits the __clear__ branch in pickTruthDocument
      }
      editorCalls++;
      if (editorCalls === 1) return "Set truth document";
      return undefined; // esc → back
    };

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    // The __clear__ item is offered only when a truth document is set.
    assert.ok(truthPickerOptions.includes("(clear truth document)"));
    // Clearing with no reads left removes the role entry entirely (updateRoleDocs).
    const saved = loadAgentsFilesConfig(tmpDir);
    assert.ok(saved);
    assert.strictEqual(saved.documents["scout-4"], undefined);
  });

  it("senai-configure-agents-files keeps the current truth document when the picker is cancelled", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-4": { primary: "docs/PRD.md" } },
    });
    registerAgentsFilesCommands(makeApi());

    let roleCalls = 0;
    let editorCalls = 0;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure agent documents") {
        roleCalls++;
        if (roleCalls === 1) return options.find((o) => o.includes("scout-4:"));
        return "⬜ Finish";
      }
      if (title === "Select truth document") return undefined; // cancel keeps current
      editorCalls++;
      if (editorCalls === 1) return "Set truth document";
      return undefined; // esc → back
    };

    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const saved = loadAgentsFilesConfig(tmpDir);
    assert.ok(saved);
    assert.strictEqual(saved.documents["scout-4"]?.primary, "docs/PRD.md");
  });

  it("senai-configure-architect-inputs discards in-progress picks when the editor is backed out", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");
    registerArchitectInputsCommands(makeApi());

    let roleCalls = 0;
    let editorCalls = 0;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure architect inputs") {
        roleCalls++;
        if (roleCalls === 1) return options.find((o) => o.startsWith("⬜ prd:"));
        return "⬜ Finish";
      }
      // PRD document-type list editor.
      editorCalls++;
      if (editorCalls === 1) return options.find((o) => o.startsWith("⬜ Suggest:"));
      return undefined; // esc → back: discards the suggestion picked above
    };

    await commandHandlers["senai-configure-architect-inputs"]("", ctx);

    const saved = loadArchitectInputsConfig(tmpDir);
    assert.ok(saved);
    assert.deepStrictEqual(saved.documents, []);
  });

  it("senai-configure-architect-inputs applies a filter and keeps the filtered pick", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");
    registerArchitectInputsCommands(makeApi());
    inputs.push("prd"); // filter query

    let roleCalls = 0;
    let editorCalls = 0;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure architect inputs") {
        roleCalls++;
        if (roleCalls === 1) return options.find((o) => o.startsWith("⬜ prd:"));
        return "⬜ Finish";
      }
      editorCalls++;
      if (editorCalls === 1) return "Filter suggestions...";
      if (editorCalls === 2) return options.find((o) => o.startsWith("⬜ Suggest:"));
      return "Back"; // fallback Back = done
    };

    await commandHandlers["senai-configure-architect-inputs"]("", ctx);

    const saved = loadArchitectInputsConfig(tmpDir);
    assert.ok(saved?.documents.some((d) => d.type === "prd" && d.path === "docs/PRD.md"));
  });

  it("senai-configure-architect-inputs keeps existing constraints when the editor is cancelled", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [],
      additionalConstraints: ["Keep it simple"],
    });
    registerArchitectInputsCommands(makeApi());

    let roleCalls = 0;
    const ctx = makeCtx();
    (ctx.ui as any).editor = async () => undefined; // cancelled editor
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title === "Configure architect inputs") {
        roleCalls++;
        if (roleCalls === 1) return options.find((o) => o.includes("additional-constraints"));
        return "⬜ Finish";
      }
      return options[0];
    };

    await commandHandlers["senai-configure-architect-inputs"]("", ctx);

    const saved = loadArchitectInputsConfig(tmpDir);
    assert.deepStrictEqual(saved?.additionalConstraints, ["Keep it simple"]);
  });

  it("senai-configure-files leaves the config unchanged when category editors are backed out", async () => {
    registerFilesCommands(makeApi());

    let menuCalls = 0;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, _options: string[]) => {
      if (title.startsWith("Project files")) {
        menuCalls++;
        if (menuCalls === 1) return "Edit code paths";
        if (menuCalls === 2) return "Edit excluded paths";
        return "Finish";
      }
      return undefined; // esc → back out of the category editor
    };

    await commandHandlers["senai-configure-files"]("", ctx);

    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.codePaths, []);
    assert.deepStrictEqual(saved?.inputDocuments, []);
    assert.deepStrictEqual(saved?.testPaths, []);
    assert.deepStrictEqual(saved?.excludedPaths, [".git/", "node_modules/"]);
  });

  it("senai-configure-files browser redraws on esc and hides dotfiles except .github", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "visible.txt"), "x", "utf8");
    fs.writeFileSync(path.join(tmpDir, ".hidden.txt"), "x", "utf8");
    registerFilesCommands(makeApi());

    let menuCalls = 0;
    let editorCalls = 0;
    let browseCalls = 0;
    const captured: string[][] = [];
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      if (title.startsWith("Project files")) {
        menuCalls++;
        return menuCalls === 1 ? "Edit input documents" : "Finish";
      }
      if (title === "Browsing project root") {
        browseCalls++;
        captured.push(options);
        if (browseCalls === 1) return undefined; // esc redraws the browser
        return "❌ Cancel";
      }
      editorCalls++;
      if (editorCalls === 1) return "Add custom path";
      return undefined; // esc → back out of the editor
    };

    await commandHandlers["senai-configure-files"]("", ctx);

    assert.strictEqual(browseCalls, 2, "esc should redraw the browser once");
    const labels = captured[0];
    assert.ok(labels.includes("📂 .github/"), ".github stays visible");
    assert.ok(labels.includes("📂 docs/"));
    assert.ok(labels.includes("📄 visible.txt"));
    assert.ok(!labels.some((l) => l.includes(".hidden.txt")), "dotfiles are filtered out");
    const saved = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(saved?.inputDocuments, []);
  });

  it("isFolderLike resolves directory symlinks and reports broken symlinks as files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-helper-"));
    fs.mkdirSync(path.join(dir, "real"));
    fs.symlinkSync(path.join(dir, "real"), path.join(dir, "link"));
    fs.symlinkSync(path.join(dir, "missing"), path.join(dir, "broken"));

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const entry = (name: string) => entries.find((e) => e.name === name)!;
    assert.strictEqual(isFolderLike(dir, entry("link")), true);
    assert.strictEqual(isFolderLike(dir, entry("broken")), false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("isPathConflict blocks only exact duplicates across categories", () => {
    assert.strictEqual(isPathConflict("src/app.ts", [], ["src/app.ts"]), true);
    assert.strictEqual(isPathConflict("src/app.ts", [], ["src/"]), false);
    assert.strictEqual(isPathConflict("src/", [], ["src/app.ts"]), false);
  });

  it("senai-generate-architect falls back to the default skill when the skill file cannot be read", async () => {
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: [],
    });
    const skillPath = resolveSkillPath("generate-architect");
    const backupPath = `${skillPath}.cov-bak`;
    fs.renameSync(skillPath, backupPath);
    try {
      registerArchitectCommand(makeApi());
      await commandHandlers["senai-generate-architect"]("", makeCtx());
    } finally {
      fs.renameSync(backupPath, skillPath);
    }

    assert.ok(
      sentMessages.some((m) => m.includes("Follow the sequence in Doc/architect-sequence.md.")),
      "prompt should contain the inline fallback skill",
    );
  });

  it("checkStageArtifact treats a missing implement directory as no artifacts", () => {
    const statePath = path.join(tmpDir, ".IDE_Plans/senai/state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        mission: "Mission",
        runId: "ghost-run",
        currentStage: "implementing",
        startedAt: "2026-06-12T00:00:00Z",
        updatedAt: "2026-06-12T00:00:00Z",
        stageResults: {},
      }),
    );

    // The run directory for "ghost-run" does not exist, so dirHasFiles catches.
    const result = checkStageArtifact(loadState(tmpDir), "implement", makeCtx());
    assert.strictEqual(result.ok, false);
    assert.ok(notifications[0].message.includes("Implement artifacts not found"));
  });

  it("senai-configure-agents regenerates _comment when the file on disk lacks it", async () => {
    const configPath = path.join(tmpDir, ".pi", "senai", "agents.json");
    // Simulate a user hand-removing the instruction line.
    fs.writeFileSync(configPath, JSON.stringify({ version: 1, agents: {} }, null, 2), "utf8");
    registerAgentCommands(makeApi());

    const ctx = makeCtx();
    (ctx.ui as any).select = async () => "⬜ Finish";
    await commandHandlers["senai-configure-agents"]("", ctx);

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(Object.keys(raw)[0], "_comment");
    assert.strictEqual(raw._comment, CONFIG_COMMENT);
  });

  it("senai-configure-files regenerates _comment when the file on disk lacks it", async () => {
    const configPath = path.join(tmpDir, ".pi", "senai", "files.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        { version: 2, codePaths: [], inputDocuments: [], testPaths: [], excludedPaths: [] },
        null,
        2,
      ),
      "utf8",
    );
    registerFilesCommands(makeApi());

    const ctx = makeCtx();
    (ctx.ui as any).select = async () => "Finish";
    await commandHandlers["senai-configure-files"]("", ctx);

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(Object.keys(raw)[0], "_comment");
    assert.strictEqual(raw._comment, FILES_CONFIG_COMMENT);
  });

  it("senai-configure-agents-files regenerates _comment when the file on disk lacks it", async () => {
    const configPath = path.join(tmpDir, ".pi", "senai", "agents_files.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ version: 2, documents: {} }, null, 2),
      "utf8",
    );
    registerAgentsFilesCommands(makeApi());

    const ctx = makeCtx();
    (ctx.ui as any).select = async () => "⬜ Finish";
    await commandHandlers["senai-configure-agents-files"]("", ctx);

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(Object.keys(raw)[0], "_comment");
    assert.strictEqual(raw._comment, AGENTS_FILES_CONFIG_COMMENT);
  });

  it("senai-configure-architect-inputs regenerates _comment when the file on disk lacks it", async () => {
    const configPath = path.join(tmpDir, ".pi", "senai", "architect-inputs.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ version: 1, documents: [], additionalConstraints: [] }, null, 2),
      "utf8",
    );
    registerArchitectInputsCommands(makeApi());

    const ctx = makeCtx();
    (ctx.ui as any).select = async () => "⬜ Finish";
    await commandHandlers["senai-configure-architect-inputs"]("", ctx);

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(Object.keys(raw)[0], "_comment");
    assert.strictEqual(raw._comment, ARCHITECT_INPUTS_CONFIG_COMMENT);
  });

  it("senai-configure-agents cancels without saving via the Back button", async () => {
    registerAgentCommands(makeApi());
    const configPath = path.join(tmpDir, ".pi", "senai", "agents.json");
    const before = fs.readFileSync(configPath, "utf8");

    let backOffered = false;
    const ctx = makeCtx();
    (ctx.ui as any).select = async (title: string, options: string[]) => {
      assert.strictEqual(title, "Configure agents");
      backOffered = options[0] === "Back";
      return "Back";
    };

    await commandHandlers["senai-configure-agents"]("", ctx);

    assert.ok(backOffered, "Back should be the first option in the role list");
    assert.strictEqual(fs.readFileSync(configPath, "utf8"), before, "file must be unchanged");
    assert.ok(notifications.some((n) => n.message.includes("cancelled")));
  });
});

describe("senai-fix v1.1 approve/docs-structure coverage", () => {
  let tmpDir: string;
  let notifications: Array<{ message: string; type: string }>;
  let sentMessages: string[];
  let commandHandlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-cmd-cov-"));
    notifications = [];
    sentMessages = [];
    commandHandlers = {};
    saveAgentConfig(tmpDir, { version: 1, agents: { ...DEFAULT_AGENTS } });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: [],
      testPaths: [],
      excludedPaths: [],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
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
      getContextUsage: () => undefined,
      compact: () => {},
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

  function writePlanArtifacts(cwd: string, runId: string): void {
    const runDir = path.join(cwd, ".IDE_Plans", "senai", "runs", runId);
    fs.writeFileSync(path.join(runDir, "plan", "plan.md"), "# plan\n", "utf8");
    for (let i = 1; i <= 4; i++) {
      fs.writeFileSync(path.join(runDir, "plan", "scouts", `scout-angle_${i}.md`), "scout\n", "utf8");
    }
  }

  it("senai-approve at documenting with an empty document/ warns and declining keeps the stage", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    const runId = loadState(tmpDir).runId;
    writePlanArtifacts(tmpDir, runId);

    // Approve planning → implementing (artifacts verified).
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");

    // Write implement output, approve → documenting.
    const runDir = path.join(tmpDir, ".IDE_Plans", "senai", "runs", runId);
    fs.writeFileSync(path.join(runDir, "implement", "notes.md"), "done\n", "utf8");
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "documenting");

    // Approve documenting with an empty document/ dir: warn-and-ask; decline.
    const confirmTitles: string[] = [];
    let confirmCount = 0;
    const ctx = makeCtx();
    ctx.ui.confirm = async (title: string) => {
      confirmTitles.push(title);
      confirmCount += 1;
      return confirmCount === 1; // approve the stage, decline the missing-artifacts override
    };
    sentMessages.length = 0;
    await commandHandlers["senai-approve"]("", ctx);

    assert.deepStrictEqual(confirmTitles, ["Approve stage", "Artifacts missing"]);
    assert.strictEqual(loadState(tmpDir).currentStage, "documenting", "stage must not advance when declined");
    assert.strictEqual(sentMessages.length, 0, "no next-stage prompt should be sent");
  });

  it("senai-approve compacts at exactly 40% of the context window (percent null)", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    const compactCalls: unknown[] = [];
    const ctx = makeCtx();
    ctx.getContextUsage = () => ({ tokens: 80000, contextWindow: 200000, percent: null });
    ctx.compact = (options?: unknown) => {
      compactCalls.push(options);
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.strictEqual(compactCalls.length, 1, "80000/200000 is exactly 40% — must compact");
  });

  it("senai-approve does not compact just below 40% (79999/200000, percent null)", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    const compactCalls: unknown[] = [];
    const ctx = makeCtx();
    ctx.getContextUsage = () => ({ tokens: 79999, contextWindow: 200000, percent: null });
    ctx.compact = (options?: unknown) => {
      compactCalls.push(options);
    };

    await commandHandlers["senai-approve"]("", ctx);

    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.strictEqual(compactCalls.length, 0, "79999/200000 is below 40% — must not compact");
  });

  it("senai-generate-docs-structure notifies kept docs on a second run with a real README", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# My real README\n", "utf8");
    registerDocsStructureCommand(makeApi());

    await commandHandlers["senai-generate-docs-structure"]("", makeCtx());

    assert.ok(
      notifications.some((n) => n.message.includes("created 0 stub(s), kept 1 existing doc(s)")),
      `expected the kept count in the notification, got: ${notifications.map((n) => n.message).join(" | ")}`,
    );
    assert.ok(
      notifications.some((n) => n.message.includes("Kept (existing, not overwritten):")),
      "kept block listed",
    );
    assert.strictEqual(
      fs.readFileSync(path.join(tmpDir, "README.md"), "utf8"),
      "# My real README\n",
      "real README must be untouched",
    );
  });

  // /senai-discussion command cases — share closure with the main describe so
  // tmpDir / makeApi / makeCtx / commandHandlers / notifications / sentMessages
  // are all in scope.
  it("/senai-plan does NOT warn when state is none", async () => {
    registerCommands(makeApi());
    notifications.length = 0;
    sentMessages.length = 0;
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "planning");
    assert.ok(!notifications.some((n) => n.message.includes("Active run in progress")));
  });

  it("/senai-plan does NOT warn when state is delivered", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());
    // Approve through all stages to reach delivered.
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "delivered");

    notifications.length = 0;
    await commandHandlers["senai-plan"]("New", makeCtx());
    assert.ok(!notifications.some((n) => n.message.includes("Active run in progress")));
    assert.strictEqual(loadState(tmpDir).currentStage, "planning");
    assert.strictEqual(loadState(tmpDir).mission, "New");
  });

  it("/senai-plan warns and cancels when a run is active and the user declines", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("First", makeCtx());
    // Now in 'planning' (active). Try to start another.
    notifications.length = 0;

    const ctx = makeCtx();
    ctx.ui.confirm = async () => false;
    await commandHandlers["senai-plan"]("Second", ctx);

    const state = loadState(tmpDir);
    assert.strictEqual(state.currentStage, "planning", "state must not advance");
    assert.strictEqual(state.mission, "First", "mission must not change");
    assert.ok(
      notifications.some((n) =>
        n.message.includes("Active run in progress") ||
        n.message.includes("Cancelled"),
      ),
    );
  });

  it("/senai-plan warns and proceeds when the user confirms", async () => {
    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("First", makeCtx());

    const ctx = makeCtx();
    ctx.ui.confirm = async () => true;
    await commandHandlers["senai-plan"]("Second", ctx);

    const state = loadState(tmpDir);
    assert.strictEqual(state.mission, "Second", "mission replaced on confirm");
    assert.strictEqual(state.currentStage, "planning");
  });

  it("/senai-plan consumes a pre-run mission-brief.md and stores missionBriefPath", async () => {
    const briefRel = ".IDE_Plans/senai/discussions/pre-run/mission-brief.md";
    fs.mkdirSync(path.dirname(path.join(tmpDir, briefRel)), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, briefRel), "## Refined mission\nfoo\n", "utf8");

    registerCommands(makeApi());
    await commandHandlers["senai-plan"]("Mission", makeCtx());

    const state = loadState(tmpDir);
    assert.strictEqual(state.missionBriefPath, briefRel);
    assert.ok(
      notifications[0].message.includes(`Pre-run mission brief consumed: ${briefRel}`),
    );
  });

  it("/senai-discussion with no active run emits the skill and pre-run notify", async () => {
    registerDiscussionCommands(makeApi());
    notifications.length = 0;
    sentMessages.length = 0;

    await commandHandlers["senai-discussion"]("refine", makeCtx());

    assert.ok(notifications[0].message.includes("pre-run"));
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Discussion Stage"));
    assert.ok(sentMessages[0].includes("Brief location:"));
  });

  it("/senai-discussion-approve with no brief warns and skips", async () => {
    registerDiscussionCommands(makeApi());
    notifications.length = 0;

    await commandHandlers["senai-discussion-approve"]("", makeCtx());

    assert.ok(notifications[0].message.includes("No mission-brief.md found"));
  });

  it("/senai-discussion-approve finalizes a brief and appends a discussionEvents entry", async () => {
    // Pre-create a brief AND a transcript file under pre-run, so the
    // approve command has something to record against.
    const preDir = path.join(tmpDir, ".IDE_Plans/senai/discussions/pre-run");
    fs.mkdirSync(preDir, { recursive: true });
    const briefPath = path.join(preDir, "mission-brief.md");
    fs.writeFileSync(
      briefPath,
      [
        "<!-- pi-senai mission-brief: draft -->",
        "## Problem statement\nx",
        "## Mission type\nfeature",
        "## Success criteria\n- ok",
        "## Out-of-scope\n- n/a",
        "## Open questions\n- none",
        "## Refined mission\nm",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(path.join(preDir, "discussion-01-refine.md"), "t", "utf8");

    registerDiscussionCommands(makeApi());
    notifications.length = 0;
    await commandHandlers["senai-discussion-approve"]("", makeCtx());

    const after = fs.readFileSync(briefPath, "utf8");
    assert.ok(!after.startsWith("<!-- pi-senai mission-brief: draft -->"));
    const state = loadState(tmpDir);
    assert.strictEqual(state.discussions, 1);
    assert.strictEqual(state.discussionEvents?.length, 1);
    assert.strictEqual(state.discussionEvents?.[0].transcriptPath, ".IDE_Plans/senai/discussions/pre-run/discussion-01-refine.md");
    assert.strictEqual(state.discussionEvents?.[0].afterStage, undefined, "pre-run has no afterStage");
    assert.ok(notifications[0].message.includes("Mission brief finalized"));
  });

  it("/senai-discussion-approve warns before finalizing a brief with missing sections", async () => {
    const preDir = path.join(tmpDir, ".IDE_Plans/senai/discussions/pre-run");
    fs.mkdirSync(preDir, { recursive: true });
    const briefPath = path.join(preDir, "mission-brief.md");
    fs.writeFileSync(
      briefPath,
      [
        "<!-- pi-senai mission-brief: draft -->",
        "## Problem statement\nx",
        // All other sections missing.
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(path.join(preDir, "discussion-01-test.md"), "t", "utf8");

    registerDiscussionCommands(makeApi());
    const ctx = makeCtx();
    ctx.ui.confirm = async () => false;
    notifications.length = 0;
    await commandHandlers["senai-discussion-approve"]("", ctx);

    // Marker stays because the user declined the missing-sections override.
    assert.ok(fs.readFileSync(briefPath, "utf8").startsWith("<!-- pi-senai mission-brief: draft -->"));
    assert.ok(
      notifications.some((n) => n.message.includes("Cancelled")),
      "declining the gaps override emits a Cancelled notify",
    );
    assert.ok((loadState(tmpDir).discussions ?? 0) === 0);
  });
});
