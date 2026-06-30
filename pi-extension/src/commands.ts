import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { getConfigPath, loadAgentConfig, saveAgentConfig, validateMappedAgents } from "./agent-config.js";
import { discoverAgents } from "./agent-discovery.js";
import {
  loadAgentsFilesConfig,
  saveAgentsFilesConfig,
  validateAgentsFilesConfig,
  type AgentsFilesConfig,
  type AgentFilesDocuments,
} from "./agents-files-config.js";
import { discoverProjectFiles } from "./files-discovery.js";
import { loadFilesConfig, saveFilesConfig, validateFilesConfig, type FilesConfig } from "./files-config.js";
import { buildAgentRegistryBlock } from "./agent-registry.js";
import {
  DEFAULT_AGENTS,
  ORCHESTRA_ROLES,
  type OrchestraRole,
  buildSuggestionMap,
} from "./agent-suggestions.js";
import { getArtifactPaths, STAGE_TRANSITIONS, type Stage } from "./constants.js";
import { buildStagePrompt } from "./prompt.js";
import {
  advanceStage,
  loadState,
  resetState,
  startRun,
  type OrchestraState,
} from "./state.js";

const NEXT_COMMAND: Record<string, string> = {
  planning: "/orchestra-approve",
  planned: "/orchestra-implement",
  implementing: "/orchestra-approve",
  implemented: "/orchestra-document",
  documenting: "/orchestra-approve",
  documented: "/orchestra-deliver",
  delivering: "/orchestra-approve",
  delivered: "/orchestra-status",
};

const STAGE_COMMANDS: Record<string, Stage> = {
  planned: "implementing",
  implemented: "documenting",
  documented: "delivering",
};

const STAGE_SKILL: Record<string, string> = {
  implementing: "implement",
  documenting: "document",
  delivering: "deliver",
};

const STAGE_COMMAND_NAME: Record<"planned" | "implemented" | "documented", string> = {
  planned: "implement",
  implemented: "document",
  documented: "deliver",
};

export function registerCommands(pi: ExtensionAPI) {
  pi.registerCommand("orchestra-plan", {
    description: "Start the Plan stage: /orchestra-plan <mission>",
    handler: async (args, ctx) => {
      if (!ensureAgentConfig(ctx.cwd, ctx)) return;
      const mission = args.trim();
      if (!mission) {
        ctx.ui.notify("Usage: /orchestra-plan <mission>", "warning");
        return;
      }

      const state = startRun(ctx.cwd, mission);
      const advance = advanceStage(ctx.cwd, state, "planning");
      if (!advance.ok) {
        ctx.ui.notify(advance.reason, "error");
        return;
      }

      ctx.ui.notify(
        `Plan stage started for: ${mission}\n` +
          `When the plan is ready and you approve it, run /orchestra-approve to continue.`,
        "info",
      );

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "plan");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("orchestra-implement", {
    description: "Start the Implement stage (requires approved plan)",
    handler: async (_args, ctx) => {
      if (!ensureAgentConfig(ctx.cwd, ctx)) return;
      const state = loadState(ctx.cwd);
      const check = checkStageArtifact(state, "plan", ctx);
      if (!check.ok) return;

      const ensured = ensureStage(ctx.cwd, state, "planned");
      if (!ensured.ok) {
        ctx.ui.notify(ensured.reason, "warning");
        return;
      }

      const advance = advanceStage(ctx.cwd, ensured.state, "implementing");
      if (!advance.ok) {
        ctx.ui.notify(advance.reason, "error");
        return;
      }

      ctx.ui.notify(
        `Implement stage started.\n` +
          `When implementation and tests are complete and you approve, run /orchestra-approve to continue.`,
        "info",
      );

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "implement");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("orchestra-document", {
    description: "Start the Document stage (requires implemented code)",
    handler: async (_args, ctx) => {
      if (!ensureAgentConfig(ctx.cwd, ctx)) return;
      const state = loadState(ctx.cwd);
      const check = checkStageArtifact(state, "implement", ctx);
      if (!check.ok) return;

      const ensured = ensureStage(ctx.cwd, state, "implemented");
      if (!ensured.ok) {
        ctx.ui.notify(ensured.reason, "warning");
        return;
      }

      const advance = advanceStage(ctx.cwd, ensured.state, "documenting");
      if (!advance.ok) {
        ctx.ui.notify(advance.reason, "error");
        return;
      }

      ctx.ui.notify(
        `Document stage started.\n` +
          `When documentation is complete and you approve, run /orchestra-approve to continue.`,
        "info",
      );

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "document");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("orchestra-deliver", {
    description: "Start the Deliver stage (requires documentation)",
    handler: async (_args, ctx) => {
      if (!ensureAgentConfig(ctx.cwd, ctx)) return;
      const state = loadState(ctx.cwd);
      const check = checkStageArtifact(state, "document", ctx);
      if (!check.ok) return;

      const ensured = ensureStage(ctx.cwd, state, "documented");
      if (!ensured.ok) {
        ctx.ui.notify(ensured.reason, "warning");
        return;
      }

      const advance = advanceStage(ctx.cwd, ensured.state, "delivering");
      if (!advance.ok) {
        ctx.ui.notify(advance.reason, "error");
        return;
      }

      ctx.ui.notify(
        `Deliver stage started.\n` +
          `When security audit and packaging are complete and you approve, run /orchestra-approve to finish.`,
        "info",
      );

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "deliver");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("orchestra-status", {
    description: "Show current orchestra stage and artifact paths",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      if (state.currentStage === "none") {
        ctx.ui.notify("No active orchestra run. Use /orchestra-plan <mission> to start.", "info");
        return;
      }

      const artifacts = state.runId
        ? getArtifactPaths(ctx.cwd, state.runId)
        : null;

      const nextCommand = NEXT_COMMAND[state.currentStage];

      const lines = [
        `Stage: ${state.currentStage}`,
        `Mission: ${state.mission}`,
        `Run ID: ${state.runId}`,
        `Started: ${state.startedAt}`,
        `Updated: ${state.updatedAt}`,
      ];
      if (artifacts) {
        lines.push(
          ``,
          `Artifacts:`,
          `  plan.md: ${artifacts.plan}`,
          `  discussion-notes.md: ${artifacts.discussionNotes}`,
          `  scout-angle_*.md: ${artifacts.scoutAngle1}`,
          `  review-*.md: ${artifacts.reviewCorrectness}`,
          `  security-report.md: ${artifacts.securityReport}`,
          `  deliver-summary.md: ${artifacts.deliverSummary}`,
        );
      }
      if (nextCommand) {
        lines.push(
          ``,
          `Next step: run ${nextCommand}`,
        );
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("orchestra-approve", {
    description: "Approve the current stage and run the next stage automatically",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      if (state.currentStage === "none") {
        ctx.ui.notify("No active orchestra run. Start with /orchestra-plan <mission>", "warning");
        return;
      }
      if (state.currentStage === "delivered") {
        ctx.ui.notify("Run is already delivered.", "info");
        return;
      }

      const nextStage = STAGE_TRANSITIONS[state.currentStage][0];
      if (!nextStage) {
        ctx.ui.notify(`No next stage from '${state.currentStage}'.`, "info");
        return;
      }

      const confirmed = await ctx.ui.confirm(
        "Approve stage",
        `Approve '${state.currentStage}' and run the next stage?`,
      );
      if (!confirmed) return;

      // Advance from current working stage to completed stage.
      const firstAdvance = advanceStage(ctx.cwd, state, nextStage);
      if (!firstAdvance.ok) {
        ctx.ui.notify(firstAdvance.reason, "error");
        return;
      }

      const completedStage = nextStage;
      const nextCommand = NEXT_COMMAND[completedStage];
      const nextWorkingStage = STAGE_COMMANDS[completedStage];

      if (!nextWorkingStage) {
        // Final stage completed.
        ctx.ui.notify(
          `Stage '${state.currentStage}' approved. Advanced to '${completedStage}'.\n` +
            `All stages are complete.`,
          "info",
        );
        return;
      }

      // Auto-advance to the next working stage and run it.
      const secondAdvance = advanceStage(ctx.cwd, firstAdvance.state, nextWorkingStage);
      if (!secondAdvance.ok) {
        ctx.ui.notify(secondAdvance.reason, "error");
        return;
      }

      ctx.ui.notify(
        `Stage '${state.currentStage}' approved. Advanced to '${completedStage}'.\n` +
          `Automatically running the next stage: ${nextCommand}`,
        "info",
      );

      const { prompt } = buildStagePrompt(ctx.cwd, secondAdvance.state, STAGE_SKILL[nextWorkingStage]);
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("orchestra-reset", {
    description: "Clear the current orchestra run state",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      if (state.currentStage === "none") {
        ctx.ui.notify("No active orchestra run to reset.", "info");
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Reset orchestra run",
        `Reset run "${state.mission}"? This only deletes the state file; artifacts are preserved.`,
      );
      if (!confirmed) return;
      resetState(ctx.cwd);
      ctx.ui.notify("Orchestra state reset.", "info");
    },
  });
}

const REQUIRED_STAGE_FOR_MANUAL_COMMAND: Record<
  "planned" | "implemented" | "documented",
  Stage
> = {
  planned: "planned",
  implemented: "implemented",
  documented: "documented",
};

function ensureStage(
  _cwd: string,
  state: OrchestraState,
  targetStage: "planned" | "implemented" | "documented",
): { ok: true; state: OrchestraState } | { ok: false; reason: string } {
  const required = REQUIRED_STAGE_FOR_MANUAL_COMMAND[targetStage];
  if (state.currentStage === required) {
    return { ok: true, state };
  }
  if (state.currentStage === "none") {
    return {
      ok: false,
      reason: "No active run. Start with /orchestra-plan <mission>.",
    };
  }
  return {
    ok: false,
    reason: `Manual '/orchestra-${STAGE_COMMAND_NAME[targetStage]}' can only run from '${required}'. Current stage is '${state.currentStage}'. Run /orchestra-status to see the next step.`,
  };
}

export function checkStageArtifact(
  state: OrchestraState,
  stage: "plan" | "implement" | "document" | "deliver",
  ctx: ExtensionContext,
): { ok: true } | { ok: false } {
  if (state.currentStage === "none") {
    ctx.ui.notify("No active run. Start with /orchestra-plan <mission>", "warning");
    return { ok: false };
  }

  if (!state.runId) {
    ctx.ui.notify("Run ID is missing. Start a new run with /orchestra-plan.", "error");
    return { ok: false };
  }

  const artifacts = getArtifactPaths(ctx.cwd, state.runId);

  if (stage === "plan") {
    const missing: string[] = [];
    if (!fs.existsSync(artifacts.plan)) missing.push(artifacts.plan);
    for (const scoutPath of [
      artifacts.scoutAngle1,
      artifacts.scoutAngle2,
      artifacts.scoutAngle3,
      artifacts.scoutAngle4,
    ]) {
      if (!fs.existsSync(scoutPath)) missing.push(scoutPath);
    }
    if (missing.length > 0) {
      ctx.ui.notify(
        `Plan artifacts not found: ${missing.join(", ")}. Complete the Plan stage first.`,
        "warning",
      );
      return { ok: false };
    }
  }

  if (stage === "implement") {
    if (!dirHasFiles(artifacts.implementDir)) {
      ctx.ui.notify(
        `Implement artifacts not found in ${artifacts.implementDir}. Complete the Implement stage first.`,
        "warning",
      );
      return { ok: false };
    }
  }

  if (stage === "document") {
    if (!dirHasFiles(artifacts.documentDir)) {
      ctx.ui.notify(
        `Document artifacts not found in ${artifacts.documentDir}. Complete the Document stage first.`,
        "warning",
      );
      return { ok: false };
    }
  }

  if (stage === "deliver") {
    const missing: string[] = [];
    if (!fs.existsSync(artifacts.securityReport)) {
      missing.push(artifacts.securityReport);
    }
    if (!fs.existsSync(artifacts.deliverSummary)) {
      missing.push(artifacts.deliverSummary);
    }
    if (missing.length > 0) {
      ctx.ui.notify(
        `Deliver artifacts not found: ${missing.join(", ")}. Complete the Deliver stage first.`,
        "warning",
      );
      return { ok: false };
    }
  }

  return { ok: true };
}

function dirHasFiles(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function ensureAgentConfig(cwd: string, ctx: ExtensionContext): boolean {
  const config = loadAgentConfig(cwd);
  if (!config) {
    ctx.ui.notify(
      "No Pi Orchestra agent configuration found. Please run /orchestra-configure-agents first.",
      "warning",
    );
    return false;
  }
  const errors = validateMappedAgents(cwd, config);

  try {
    const filesConfig = loadFilesConfig(cwd);
    if (filesConfig) validateFilesConfig(filesConfig);
  } catch (err: any) {
    errors.push(`Files config error: ${err.message}`);
  }

  try {
    const agentsFilesConfig = loadAgentsFilesConfig(cwd);
    if (agentsFilesConfig) validateAgentsFilesConfig(agentsFilesConfig);
  } catch (err: any) {
    errors.push(`Agent files config error: ${err.message}`);
  }

  if (errors.length > 0) {
    ctx.ui.notify("Agent configuration errors:\n" + errors.join("\n"), "error");
    return false;
  }
  return true;
}

export function registerAgentCommands(pi: ExtensionAPI) {
  pi.registerCommand("orchestra-agents", {
    description: "Show current agent mapping and validation status",
    handler: async (_args, ctx) => {
      const config = loadAgentConfig(ctx.cwd);
      if (!config) {
        ctx.ui.notify(
          "No agent configuration found. Run /orchestra-configure-agents first.",
          "warning",
        );
        return;
      }

      const errors = validateMappedAgents(ctx.cwd, config);
      const lines = ["Pi Orchestra Agent Registry", ""];
      for (const role of ORCHESTRA_ROLES) {
        const agentName = config.agents[role] ?? DEFAULT_AGENTS[role];
        lines.push(`  ${role} → ${agentName}`);
      }

      if (errors.length > 0) {
        lines.push("", "Errors:", ...errors.map((e) => `  ❌ ${e}`));
        ctx.ui.notify(lines.join("\n"), "error");
      } else {
        lines.push("", "All mapped agents are available.");
        ctx.ui.notify(lines.join("\n"), "info");
      }
    },
  });

  pi.registerCommand("orchestra-configure-agents", {
    description: "Interactively configure subagents for this project",
    handler: async (_args, ctx) => {
      const agents = discoverAgents(ctx.cwd);
      const suggestions = buildSuggestionMap(agents);
      const existing = loadAgentConfig(ctx.cwd);
      const mapping: Partial<Record<OrchestraRole, string>> = {};
      let i = 0;

      while (i < ORCHESTRA_ROLES.length) {
        const role = ORCHESTRA_ROLES[i];
        const existingValue = existing?.agents?.[role];
        const suggested = suggestions[role] ?? DEFAULT_AGENTS[role];
        const current = mapping[role] ?? existingValue ?? suggested;

        const options: string[] = [];
        if (existingValue) {
          options.push(`Keep current: ${existingValue}`);
        }
        if (!existingValue || existingValue !== suggested) {
          options.push(`Accept suggestion: ${suggested}`);
        }
        options.push("Choose different");
        options.push(`Use default: ${DEFAULT_AGENTS[role]}`);
        if (i > 0) {
          options.push("← Back");
        }
        if (i < ORCHESTRA_ROLES.length - 1) {
          options.push("Next →");
        } else {
          options.push("Finish");
        }

        const choice = await ctx.ui.select(`Configure agent for role "${role}"`, options);

        if (choice?.startsWith("Keep current:")) {
          mapping[role] = existingValue!;
          i++;
        } else if (choice?.startsWith("Accept suggestion:")) {
          mapping[role] = suggested;
          i++;
        } else if (choice === "Choose different") {
          const agentOptions = agents.map((a) => `${a.name} (${a.source})`);
          const selected = await ctx.ui.select(`Select agent for "${role}"`, agentOptions);
          if (selected) {
            mapping[role] = selected.split(" ")[0];
          } else {
            mapping[role] = DEFAULT_AGENTS[role];
          }
          i++;
        } else if (choice?.startsWith("Use default:")) {
          mapping[role] = DEFAULT_AGENTS[role];
          i++;
        } else if (choice === "← Back") {
          i = Math.max(0, i - 1);
        } else if (choice === "Next →" || choice === "Finish") {
          mapping[role] = current;
          i++;
        } else {
          // Unexpected cancellation / empty selection: keep current and advance.
          mapping[role] = current;
          i++;
        }
      }

      const finalMapping: Partial<Record<OrchestraRole, string>> = {};
      for (const role of ORCHESTRA_ROLES) {
        finalMapping[role] = mapping[role] ?? existing?.agents?.[role] ?? DEFAULT_AGENTS[role];
      }

      const config = { version: 1, agents: finalMapping };
      saveAgentConfig(ctx.cwd, config);
      ctx.ui.notify("Agent configuration saved to .pi/orchestra/agents.json", "info");
    },
  });
}



export function registerFilesCommands(pi: ExtensionAPI) {
  pi.registerCommand("orchestra-files", {
    description: "Show the configured project file list",
    handler: async (_args, ctx) => {
      const config = loadFilesConfig(ctx.cwd);
      if (!config || getAllSelectedPaths(config).length === 0) {
        ctx.ui.notify("No project files configured. Run /orchestra-configure-files first.", "info");
        return;
      }
      const lines = ["Pi Orchestra Project Files", ""];
      if (config.codePaths.length > 0) {
        lines.push("Code paths:");
        for (const f of config.codePaths) lines.push(`  ${f}`);
        lines.push("");
      }
      if (config.inputDocuments.length > 0) {
        lines.push("Input documents:");
        for (const f of config.inputDocuments) lines.push(`  ${f}`);
        lines.push("");
      }
      if (config.testPaths.length > 0) {
        lines.push("Test paths:");
        for (const f of config.testPaths) lines.push(`  ${f}`);
        lines.push("");
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("orchestra-configure-files", {
    description: "Configure important project files and folders",
    handler: async (_args, ctx) => {
      const existing = loadFilesConfig(ctx.cwd);
      const config: FilesConfig = existing ?? {
        version: 2,
        codePaths: [],
        inputDocuments: [],
        testPaths: [],
        excludedPaths: [
          ".git/", "node_modules/", "__pycache__/", ".venv/", "venv/",
          "dist/", "build/", "target/", ".pi/", ".idea/", ".vscode/",
        ],
      };

      const discovered = discoverProjectFiles(ctx.cwd, config.excludedPaths);

      let editing = true;
      while (editing) {
        const choice = await ctx.ui.select(
          `Project files — ${config.codePaths.length} code, ${config.inputDocuments.length} docs, ${config.testPaths.length} tests`,
          [
            "Edit code paths",
            "Edit input documents",
            "Edit test paths",
            "Edit excluded paths",
            "Finish",
          ],
        );

        if (choice === "Edit code paths") {
          await editCategory(ctx, config, "codePaths", discovered.codeFolders.map((f) => f.path));
        } else if (choice === "Edit input documents") {
          await editCategory(ctx, config, "inputDocuments", discovered.documentFiles);
        } else if (choice === "Edit test paths") {
          await editCategory(ctx, config, "testPaths", [
            ...discovered.testFolders.map((f) => f.path),
            ...discovered.testFiles,
          ]);
        } else if (choice === "Edit excluded paths") {
          await editExcludedPaths(ctx, config);
        } else {
          editing = false;
        }
      }

      saveFilesConfig(ctx.cwd, config);
      ctx.ui.notify("Project files saved to .pi/orchestra/files.json", "info");
    },
  });
}

type CategoryKey = "codePaths" | "inputDocuments" | "testPaths";

const SUGGESTION_PAGE_SIZE = 10;

async function editCategory(
  ctx: ExtensionContext,
  config: FilesConfig,
  key: CategoryKey,
  suggestions: string[],
): Promise<void> {
  const current = config[key];
  const otherPaths = getAllSelectedPaths(config).filter((p) => !current.includes(p));

  let filterQuery = "";
  let page = 0;
  let editing = true;

  while (editing) {
    const available = suggestions
      .filter((s) => !isPathConflict(s, current, otherPaths))
      .filter((s) => matchesFilter(s, filterQuery));

    const pageCount = Math.max(1, Math.ceil(available.length / SUGGESTION_PAGE_SIZE));
    page = Math.max(0, Math.min(page, pageCount - 1));
    const pageStart = page * SUGGESTION_PAGE_SIZE;
    const pageItems = available.slice(pageStart, pageStart + SUGGESTION_PAGE_SIZE);

    const options: string[] = [];
    if (filterQuery) {
      options.push(`Filter: ${filterQuery} (clear)`);
    } else {
      options.push("Filter suggestions...");
    }
    options.push(...pageItems.map((s) => `Suggest: ${s}`));
    if (pageCount > 1) {
      if (page > 0) options.push("← Previous page");
      if (page < pageCount - 1) options.push("Next page →");
    }
    options.push("Add custom path");
    options.push(...current.map((s) => `Remove: ${s}`));
    options.push("Back");

    const choice = await ctx.ui.select(
      `${key} (${current.length} selected, ${available.length} suggestions)`,
      options,
    );

    if (choice === "Filter suggestions...") {
      const input = await ctx.ui.input("Filter by name (empty clears):");
      filterQuery = normalizePath(input ?? "").toLowerCase();
      page = 0;
    } else if (choice?.startsWith("Filter: ")) {
      filterQuery = "";
      page = 0;
    } else if (choice === "Next page →") {
      page++;
    } else if (choice === "← Previous page") {
      page--;
    } else if (choice?.startsWith("Suggest: ")) {
      const path = choice.replace("Suggest: ", "");
      if (!isPathConflict(path, current, otherPaths)) {
        current.push(path);
      }
    } else if (choice === "Add custom path") {
      const input = await ctx.ui.input("File or folder path:");
      if (input && !isPathConflict(input, current, otherPaths)) {
        current.push(normalizePath(input));
      }
    } else if (choice?.startsWith("Remove: ")) {
      const path = choice.replace("Remove: ", "");
      const idx = current.indexOf(path);
      if (idx >= 0) current.splice(idx, 1);
    } else {
      editing = false;
    }
  }
}

function matchesFilter(path: string, query: string): boolean {
  if (!query) return true;
  return path.toLowerCase().includes(query);
}

async function editExcludedPaths(ctx: ExtensionContext, config: FilesConfig): Promise<void> {
  let editing = true;
  while (editing) {
    const options = [
      "Add excluded path",
      ...config.excludedPaths.map((s) => `Remove: ${s}`),
      "Back",
    ];
    const choice = await ctx.ui.select(
      `Excluded paths (${config.excludedPaths.length})`,
      options,
    );

    if (choice === "Add excluded path") {
      const input = await ctx.ui.input("Path to exclude (folder should end with /):");
      if (input) config.excludedPaths.push(normalizePath(input));
    } else if (choice?.startsWith("Remove: ")) {
      const path = choice.replace("Remove: ", "");
      const idx = config.excludedPaths.indexOf(path);
      if (idx >= 0) config.excludedPaths.splice(idx, 1);
    } else {
      editing = false;
    }
  }
}

function getAllSelectedPaths(config: FilesConfig): string[] {
  return [...config.codePaths, ...config.inputDocuments, ...config.testPaths];
}

function normalizePath(input: string): string {
  // Keep trailing slash if the user included it; otherwise treat as file.
  return input.replace(/\\/g, "/");
}

function isPathConflict(path: string, current: string[], other: string[]): boolean {
  // A folder blocks any file inside it, and a file inside blocks the folder.
  const all = [...current, ...other];
  for (const existing of all) {
    if (existing === path) return true;
    if (existing.endsWith("/")) {
      if (path.startsWith(existing)) return true;
    }
    if (path.endsWith("/")) {
      if (existing.startsWith(path)) return true;
    }
  }
  return false;
}

export function registerAgentsFilesCommands(pi: ExtensionAPI) {
  pi.registerCommand("orchestra-agents-files", {
    description: "Show configured document assignments per role",
    handler: async (_args, ctx) => {
      const config = loadAgentsFilesConfig(ctx.cwd);
      if (!config || Object.keys(config.documents).length === 0) {
        ctx.ui.notify(
          "No agent document assignments configured. Run /orchestra-configure-agents-files first.",
          "info",
        );
        return;
      }
      const lines = ["Pi Orchestra Agent Document Assignments", ""];
      for (const role of ORCHESTRA_ROLES) {
        const docs = config.documents[role];
        if (!docs) continue;
        const parts: string[] = [];
        if (docs.primary) parts.push(`truth=${docs.primary}`);
        if (docs.reads?.length) parts.push(`reads=[${docs.reads.join(", ")}]`);
        if (parts.length > 0) lines.push(`  ${role}: ${parts.join(" ")}`);
      }
      if (lines.length === 2) {
        lines.push("  No assignments found.");
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("orchestra-configure-agents-files", {
    description: "Configure truth and comparison documents for each role",
    handler: async (_args, ctx) => {
      const existing = loadAgentsFilesConfig(ctx.cwd);
      const documents: Partial<Record<OrchestraRole, AgentFilesDocuments>> = existing
        ? { ...existing.documents }
        : {};
      let i = 0;

      while (i < ORCHESTRA_ROLES.length) {
        const role = ORCHESTRA_ROLES[i];
        const current = documents[role] ?? {};
        const summary = current.primary
          ? `${role}: truth=${current.primary}${current.reads?.length ? ` reads=[${current.reads.join(", ")}]` : ""}`
          : `${role}: no assignment`;

        const options = [
          "Set truth document",
          "Add comparison document",
          "Remove comparison document",
          "Clear assignment",
          "Skip",
        ];
        if (i > 0) options.push("← Back");
        if (i < ORCHESTRA_ROLES.length - 1) options.push("Next →");
        else options.push("Finish");

        const choice = await ctx.ui.select(summary, options);

        if (choice === "Set truth document") {
          const input = await ctx.ui.input("Truth document path:");
          if (input) documents[role] = { ...current, primary: input };
          continue;
        } else if (choice === "Add comparison document") {
          const input = await ctx.ui.input("Comparison document path:");
          if (input) {
            const reads = [...(current.reads ?? []), input];
            documents[role] = { ...current, reads };
          }
          continue;
        } else if (choice === "Remove comparison document") {
          if (current.reads && current.reads.length > 0) {
            const toRemove = await ctx.ui.select("Select path to remove", current.reads);
            if (toRemove) {
              documents[role] = {
                ...current,
                reads: current.reads.filter((r) => r !== toRemove),
              };
            }
          }
          continue;
        } else if (choice === "Clear assignment") {
          delete documents[role];
        } else if (choice === "← Back") {
          i = Math.max(0, i - 1);
          continue;
        } else if (choice === "Finish") {
          break;
        } else if (choice === "Next →" || choice === "Skip") {
          // keep current and advance
        }
        i++;
      }

      saveAgentsFilesConfig(ctx.cwd, { version: 1, documents });
      ctx.ui.notify("Agent document assignments saved to .pi/orchestra/agents_files.json", "info");
    },
  });
}
