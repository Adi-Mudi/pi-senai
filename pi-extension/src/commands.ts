import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  getConfigPath,
  loadAgentConfig,
  resolveAgentName,
  saveAgentConfig,
  validateMappedAgents,
} from "./agent-config.js";
import { discoverAgents } from "./agent-discovery.js";
import {
  loadAgentsFilesConfig,
  saveAgentsFilesConfig,
  validateAgentsFilesConfig,
  type AgentsFilesConfig,
  type AgentFilesDocuments,
} from "./agents-files-config.js";
import { discoverProjectFiles, safeReadDir, isExcluded } from "./files-discovery.js";
import { loadFilesConfig, saveFilesConfig, validateFilesConfig, type FilesConfig } from "./files-config.js";
import { buildAgentRegistryBlock } from "./agent-registry.js";
import {
  DEFAULT_AGENTS,
  ORCHESTRA_ROLES,
  ROLE_LABELS,
  type OrchestraRole,
  buildSuggestionMap,
} from "./agent-suggestions.js";
import { getArtifactPaths, STAGE_TRANSITIONS, type Stage } from "./constants.js";
import { buildStagePrompt } from "./prompt.js";
import {
  runListEditor,
  type ListEditorCustomAction,
  type ListEditorItem,
} from "./ui/list-editor.js";
import {
  runRolePicker,
  type RolePickerItem,
} from "./ui/role-picker.js";
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

function validateTruthDocuments(
  cwd: string,
  config: AgentsFilesConfig | null,
): string[] {
  const errors: string[] = [];
  if (!config) return errors;
  for (const role of ORCHESTRA_ROLES) {
    const docs = config.documents[role];
    if (!docs?.primary) continue;
    const fullPath = path.resolve(cwd, docs.primary);
    if (!fs.existsSync(fullPath)) {
      errors.push(
        `Truth document for ${ROLE_LABELS[role]} (${role}) not found: ${docs.primary}`,
      );
    }
  }
  return errors;
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

  const filesConfig = loadFilesConfig(cwd);
  if (!filesConfig) {
    errors.push(
      "No project files configured. Please run /orchestra-configure-files first.",
    );
  } else {
    try {
      validateFilesConfig(filesConfig);
    } catch (err: any) {
      errors.push(`Files config error: ${err.message}`);
    }
  }

  const agentsFilesConfig = loadAgentsFilesConfig(cwd);
  if (!agentsFilesConfig) {
    errors.push(
      "No agent document assignments configured. Please run /orchestra-configure-agents-files first.",
    );
  } else {
    try {
      validateAgentsFilesConfig(agentsFilesConfig);
      errors.push(...validateTruthDocuments(cwd, agentsFilesConfig));
    } catch (err: any) {
      errors.push(`Agent files config error: ${err.message}`);
    }
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
        lines.push(`  ${ROLE_LABELS[role]} (${role}) → ${agentName}`);
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

        const choice = await ctx.ui.select(`Configure agent for ${ROLE_LABELS[role]} (${role})`, options);

        if (choice?.startsWith("Keep current:")) {
          mapping[role] = existingValue!;
          i++;
        } else if (choice?.startsWith("Accept suggestion:")) {
          mapping[role] = suggested;
          i++;
        } else if (choice === "Choose different") {
          const agentOptions = agents.map((a) => `${a.name} (${a.source})`);
          const selected = await ctx.ui.select(`Select agent for ${ROLE_LABELS[role]} (${role})`, agentOptions);
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
          await editCategory(ctx, config, "inputDocuments", [
            ...discovered.documentFolders.map((f) => f.path),
            ...discovered.documentFiles,
          ]);
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

function buildDocumentCandidates(
  cwd: string,
  filesConfig: FilesConfig | null,
): string[] {
  const excludedPaths = filesConfig?.excludedPaths ?? [
    ".git/", "node_modules/", "__pycache__/", ".venv/", "venv/",
    "dist/", "build/", "target/", ".pi/", ".idea/", ".vscode/",
  ];
  const discovered = discoverProjectFiles(cwd, excludedPaths);
  const candidates = new Set<string>();
  for (const p of filesConfig?.inputDocuments ?? []) candidates.add(p);
  for (const folder of discovered.documentFolders) candidates.add(folder.path);
  for (const file of discovered.documentFiles) candidates.add(file);
  return Array.from(candidates).sort((a, b) => a.localeCompare(b));
}

function buildCategoryItems(
  suggestions: string[],
  current: string[],
  otherPaths: string[],
): ListEditorItem[] {
  const items: ListEditorItem[] = [];
  for (const path of suggestions) {
    if (isPathConflict(path, current, otherPaths)) continue;
    if (current.includes(path)) continue;
    items.push({
      id: `suggest:${path}`,
      kind: "suggestion",
      label: `⬜ Suggest: ${path}`,
      value: path,
    });
  }
  for (const path of current) {
    items.push({
      id: `selected:${path}`,
      kind: "selected",
      label: `✅ Remove: ${path}`,
      value: path,
    });
  }
  return items;
}

async function editCategory(
  ctx: ExtensionContext,
  config: FilesConfig,
  key: CategoryKey,
  suggestions: string[],
): Promise<void> {
  let filterQuery = "";
  let editing = true;

  while (editing) {
    const otherPaths = getAllSelectedPaths(config).filter((p) => !config[key].includes(p));
    const action = await runListEditor(ctx, {
      title: `${key} (${config[key].length} selected)`,
      items: buildCategoryItems(suggestions, config[key], otherPaths),
      filterQuery,
      enableFilter: true,
      customActions: [{ id: "add-custom", label: "Add custom path" }],
      pageSize: SUGGESTION_PAGE_SIZE,
    });

    switch (action.kind) {
      case "back":
        editing = false;
        break;
      case "done":
        config[key] = action.paths as FilesConfig[CategoryKey];
        editing = false;
        break;
      case "filter":
        config[key] = action.paths as FilesConfig[CategoryKey];
        filterQuery = action.query;
        break;
      case "custom": {
        config[key] = action.paths as FilesConfig[CategoryKey];
        const mode: PickerMode = key === "codePaths" ? "folder" : "both";
        const picked = await browsePath(ctx, ctx.cwd, mode, config.excludedPaths);
        if (picked && !isPathConflict(picked, config[key], otherPaths)) {
          config[key].push(normalizePath(picked));
        }
        break;
      }
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
    const action = await runListEditor(ctx, {
      title: `Excluded paths (${config.excludedPaths.length})`,
      items: config.excludedPaths.map((p) => ({
        id: `selected:${p}`,
        kind: "selected" as const,
        label: `✅ Remove: ${p}`,
        value: p,
      })),
      customActions: [{ id: "add-excluded", label: "Add excluded path" }],
    });

    switch (action.kind) {
      case "back":
        editing = false;
        break;
      case "done":
        config.excludedPaths = action.paths;
        editing = false;
        break;
      case "custom": {
        config.excludedPaths = action.paths;
        const picked = await browsePath(ctx, ctx.cwd, "both", config.excludedPaths);
        if (picked) config.excludedPaths.push(normalizePath(picked));
        break;
      }
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
  // Within the same category, a folder blocks any file inside it,
  // and a file inside blocks the folder.
  for (const existing of current) {
    if (existing === path) return true;
    if (existing.endsWith("/")) {
      if (path.startsWith(existing)) return true;
    }
    if (path.endsWith("/")) {
      if (existing.startsWith(path)) return true;
    }
  }
  // Across categories, only block exact duplicates.
  for (const existing of other) {
    if (existing === path) return true;
  }
  return false;
}

function isFolderLike(dir: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return fs.statSync(path.join(dir, entry.name)).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}

type PickerMode = "folder" | "file" | "both";

async function browsePath(
  ctx: ExtensionContext,
  cwd: string,
  mode: PickerMode,
  excludedPaths: string[],
): Promise<string | null> {
  const root = path.resolve(cwd);
  let currentDir = root;

  while (true) {
    const relativeDir = path.relative(root, currentDir).replace(/\\/g, "/") || "";
    const prefix = relativeDir ? `${relativeDir}/` : "";
    const entries = safeReadDir(currentDir)
      .filter((e) => {
        if (e.name.startsWith(".") && e.name !== ".github") return false;
        const rel = `${prefix}${e.name}${isFolderLike(currentDir, e) ? "/" : ""}`;
        return !isExcluded(rel, excludedPaths);
      })
      .sort((a, b) => {
        if (isFolderLike(currentDir, a) && !isFolderLike(currentDir, b)) return -1;
        if (!isFolderLike(currentDir, a) && isFolderLike(currentDir, b)) return 1;
        return a.name.localeCompare(b.name);
      });

    const options: string[] = [];
    if (relativeDir && mode !== "file") {
      options.push(`📁 Select this folder (${relativeDir}/)`);
    }
    for (const entry of entries) {
      if (isFolderLike(currentDir, entry)) {
        options.push(`📂 ${entry.name}/`);
      } else if (mode !== "folder") {
        options.push(`📄 ${entry.name}`);
      }
    }
    if (currentDir !== root) {
      options.push("⬆️ ../");
    }
    options.push("❌ Cancel");

    const title = relativeDir ? `Browsing ${relativeDir}/` : "Browsing project root";
    const choice = await ctx.ui.select(title, options);

    if (choice === "❌ Cancel") return null;
    if (choice === "⬆️ ../") {
      currentDir = path.dirname(currentDir);
      continue;
    }
    if (choice?.startsWith("📁 Select this folder")) {
      return `${relativeDir}/`;
    }
    if (choice?.startsWith("📂 ")) {
      const name = choice.replace("📂 ", "").replace(/\/$/, "");
      currentDir = path.join(currentDir, name);
      continue;
    }

    if (choice?.startsWith("📄 ")) {
      const name = choice.replace("📄 ", "");
      return relativeDir ? `${relativeDir}/${name}` : name;
    }
  }
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
        if (parts.length > 0) {
          lines.push(`  ${ROLE_LABELS[role]} (${role}): ${parts.join(" ")}`);
        }
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
      const config: AgentsFilesConfig = existing ?? { version: 2, documents: {} };
      const agentConfig = loadAgentConfig(ctx.cwd);
      const filesConfig = loadFilesConfig(ctx.cwd);
      const candidates = buildDocumentCandidates(ctx.cwd, filesConfig);

      const pickerItems: RolePickerItem[] = ORCHESTRA_ROLES.map((role) => {
        const agent = resolveAgentName(agentConfig, role);
        const docs = config.documents[role];
        let summary: string;
        let assigned = false;
        if (docs?.primary) {
          summary = `truth=${docs.primary}${docs.reads?.length ? ` reads=${docs.reads.length}` : ""}`;
          assigned = true;
        } else if (docs?.reads?.length) {
          summary = `reads=${docs.reads.length}`;
          assigned = true;
        } else {
          summary = "not set";
        }
        return {
          id: role,
          label: ROLE_LABELS[role],
          agent,
          summary,
          assigned,
        };
      });

      let editing = true;
      while (editing) {
        const action = await runRolePicker(ctx, {
          title: "Configure agent documents",
          items: pickerItems,
        });

        if (action.kind === "back" || action.kind === "finish") {
          editing = false;
        } else {
          await editRoleDocuments(
            ctx,
            action.role as OrchestraRole,
            config,
            candidates,
            filesConfig?.excludedPaths ?? [],
          );
          // Refresh the summary/assigned state for the selected role.
          const docs = config.documents[action.role as OrchestraRole];
          const item = pickerItems.find((i) => i.id === action.role);
          if (item) {
            if (docs?.primary) {
              item.summary = `truth=${docs.primary}${docs.reads?.length ? ` reads=${docs.reads.length}` : ""}`;
              item.assigned = true;
            } else if (docs?.reads?.length) {
              item.summary = `reads=${docs.reads.length}`;
              item.assigned = true;
            } else {
              item.summary = "not set";
              item.assigned = false;
            }
          }
        }
      }

      saveAgentsFilesConfig(ctx.cwd, config);
      ctx.ui.notify("Agent document assignments saved to .pi/orchestra/agents_files.json", "info");
    },
  });
}

async function editRoleDocuments(
  ctx: ExtensionContext,
  role: OrchestraRole,
  config: AgentsFilesConfig,
  candidates: string[],
  excludedPaths: string[],
): Promise<void> {
  const docs = config.documents[role] ?? {};
  let primary = docs.primary;
  let reads = [...(docs.reads ?? [])];
  let filterQuery = "";

  let editing = true;
  while (editing) {
    const customActions: ListEditorCustomAction[] = [
      { id: "set-truth", label: "Set truth document" },
      { id: "add-custom-read", label: "Add custom path" },
    ];
    if (primary) {
      customActions.unshift({ id: "clear-truth", label: "Clear truth" });
    }

    const action = await runListEditor(ctx, {
      title: `${ROLE_LABELS[role]} (${role})${primary ? ` — truth: ${primary}` : ""}`,
      items: buildRoleDocumentItems(primary, reads, candidates),
      filterQuery,
      enableFilter: true,
      customActions,
      pageSize: SUGGESTION_PAGE_SIZE,
    });

    switch (action.kind) {
      case "back":
        editing = false;
        break;
      case "done":
        reads = action.paths;
        updateRoleDocs(config, role, primary, reads);
        editing = false;
        break;
      case "filter":
        reads = action.paths;
        filterQuery = action.query;
        updateRoleDocs(config, role, primary, reads);
        break;
      case "custom": {
        reads = action.paths;
        updateRoleDocs(config, role, primary, reads);
        if (action.id === "set-truth") {
          const truth = await pickTruthDocument(ctx, primary, reads, candidates);
          if (truth !== undefined) primary = truth;
          updateRoleDocs(config, role, primary, reads);
        } else if (action.id === "clear-truth") {
          primary = undefined;
          updateRoleDocs(config, role, primary, reads);
        } else if (action.id === "add-custom-read") {
          const picked = await browsePath(ctx, ctx.cwd, "both", excludedPaths);
          if (picked) {
            const normalized = normalizePath(picked);
            if (!reads.includes(normalized) && normalized !== primary) {
              reads.push(normalized);
              updateRoleDocs(config, role, primary, reads);
            }
          }
        }
        break;
      }
    }
  }
}

function buildRoleDocumentItems(
  primary: string | undefined,
  reads: string[],
  candidates: string[],
): ListEditorItem[] {
  const items: ListEditorItem[] = [];
  const used = new Set<string>();
  if (primary) used.add(primary);
  for (const r of reads) used.add(r);

  for (const r of reads) {
    items.push({
      id: `read:${r}`,
      kind: "selected",
      label: `✅ Read: ${r}`,
      value: r,
    });
  }
  for (const c of candidates) {
    if (used.has(c)) continue;
    items.push({
      id: `suggest:${c}`,
      kind: "suggestion",
      label: `⬜ Suggest: ${c}`,
      value: c,
    });
  }
  return items;
}

function updateRoleDocs(
  config: AgentsFilesConfig,
  role: OrchestraRole,
  primary: string | undefined,
  reads: string[],
): void {
  if (!primary && reads.length === 0) {
    delete config.documents[role];
    return;
  }
  const docs: AgentFilesDocuments = {};
  if (primary) docs.primary = primary;
  if (reads.length > 0) docs.reads = [...reads];
  config.documents[role] = docs;
}

async function pickTruthDocument(
  ctx: ExtensionContext,
  current: string | undefined,
  reads: string[],
  candidates: string[],
): Promise<string | undefined> {
  const options: string[] = [];
  if (current) options.push("(clear truth document)");
  for (const c of candidates) {
    if (c === current || reads.includes(c)) continue;
    options.push(c);
  }
  const choice = await ctx.ui.select("Select truth document", options);
  if (!choice) return current;
  if (choice === "(clear truth document)") return undefined;
  return choice;
}
