import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import {
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
import {
  DEFAULT_AGENTS,
  SENAI_ROLES,
  ROLE_LABELS,
  type SenaiRole,
  buildSuggestionMap,
} from "./agent-suggestions.js";
import { getArtifactPaths, STAGE_TRANSITIONS, type Stage } from "./constants.js";
import {
  formatDiagnosticReport,
  runSenaiDiagnostic,
} from "./doctor.js";
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
  type SenaiState,
} from "./state.js";
import {
  createDefaultArchitectInputsConfig,
  getSelectedInputPaths,
  loadArchitectInputsConfig,
  saveArchitectInputsConfig,
  type ArchitectDocumentType,
  type ArchitectInputsConfig,
} from "./architect-inputs-config.js";
import { loadDrivers } from "./driver-extractor.js";
import {
  areDriversStale,
  loadArchitectReport,
  type ArchitectReport,
} from "./architect.js";
import {
  GENERATED_ROLES,
  discoverTechnologyResources,
  matchTechnologies,
  planAgentGeneration,
  writeGeneratedAgents,
} from "./agent-generator.js";

const NEXT_COMMAND: Record<string, string> = {
  planning: "/senai-approve",
  planned: "/senai-implement",
  implementing: "/senai-approve",
  implemented: "/senai-document",
  documenting: "/senai-approve",
  documented: "/senai-deliver",
  delivering: "/senai-approve",
  delivered: "/senai-status",
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
  pi.registerCommand("senai-plan", {
    description: "Start the Plan stage: /senai-plan <mission>",
    handler: async (args, ctx) => {
      if (!ensureAgentConfig(ctx.cwd, ctx)) return;
      const mission = args.trim();
      if (!mission) {
        ctx.ui.notify("Usage: /senai-plan <mission>", "warning");
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
          `When the plan is ready and you approve it, run /senai-approve to continue.`,
        "info",
      );

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "plan");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("senai-implement", {
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
          `When implementation and tests are complete and you approve, run /senai-approve to continue.`,
        "info",
      );

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "implement");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("senai-document", {
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
          `When documentation is complete and you approve, run /senai-approve to continue.`,
        "info",
      );

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "document");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("senai-deliver", {
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
          `When security audit and packaging are complete and you approve, run /senai-approve to finish.`,
        "info",
      );

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "deliver");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("senai-status", {
    description: "Show current senai stage and artifact paths",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      if (state.currentStage === "none") {
        ctx.ui.notify("No active senai run. Use /senai-plan <mission> to start.", "info");
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

  pi.registerCommand("senai-approve", {
    description: "Approve the current stage and run the next stage automatically",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      if (state.currentStage === "none") {
        ctx.ui.notify("No active senai run. Start with /senai-plan <mission>", "warning");
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

  pi.registerCommand("senai-reset", {
    description: "Clear the current senai run state",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      if (state.currentStage === "none") {
        ctx.ui.notify("No active senai run to reset.", "info");
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Reset senai run",
        `Reset run "${state.mission}"? This only deletes the state file; artifacts are preserved.`,
      );
      if (!confirmed) return;
      resetState(ctx.cwd);
      ctx.ui.notify("Senai state reset.", "info");
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
  state: SenaiState,
  targetStage: "planned" | "implemented" | "documented",
): { ok: true; state: SenaiState } | { ok: false; reason: string } {
  const required = REQUIRED_STAGE_FOR_MANUAL_COMMAND[targetStage];
  if (state.currentStage === required) {
    return { ok: true, state };
  }
  if (state.currentStage === "none") {
    return {
      ok: false,
      reason: "No active run. Start with /senai-plan <mission>.",
    };
  }
  return {
    ok: false,
    reason: `Manual '/senai-${STAGE_COMMAND_NAME[targetStage]}' can only run from '${required}'. Current stage is '${state.currentStage}'. Run /senai-status to see the next step.`,
  };
}

export function checkStageArtifact(
  state: SenaiState,
  stage: "plan" | "implement" | "document" | "deliver",
  ctx: ExtensionContext,
): { ok: true } | { ok: false } {
  if (state.currentStage === "none") {
    ctx.ui.notify("No active run. Start with /senai-plan <mission>", "warning");
    return { ok: false };
  }

  if (!state.runId) {
    ctx.ui.notify("Run ID is missing. Start a new run with /senai-plan.", "error");
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
  for (const role of SENAI_ROLES) {
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
      "No Pi Senai agent configuration found. Please run /senai-configure-agents first.",
      "warning",
    );
    return false;
  }
  const errors = validateMappedAgents(cwd, config);

  const filesConfig = loadFilesConfig(cwd);
  if (!filesConfig) {
    errors.push(
      "No project files configured. Please run /senai-configure-files first.",
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
      "No agent document assignments configured. Please run /senai-configure-agents-files first.",
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
  pi.registerCommand("senai-agents", {
    description: "Show current agent mapping and validation status",
    handler: async (_args, ctx) => {
      const config = loadAgentConfig(ctx.cwd);
      if (!config) {
        ctx.ui.notify(
          "No agent configuration found. Run /senai-configure-agents first.",
          "warning",
        );
        return;
      }

      const errors = validateMappedAgents(ctx.cwd, config);
      const lines = ["Pi Senai Agent Registry", ""];
      for (const role of SENAI_ROLES) {
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

  pi.registerCommand("senai-configure-agents", {
    description: "Interactively configure subagents for this project",
    handler: async (_args, ctx) => {
      const agents = discoverAgents(ctx.cwd);
      const suggestions = buildSuggestionMap(agents);
      const existing = loadAgentConfig(ctx.cwd);
      const mapping: Partial<Record<SenaiRole, string>> = {};
      let i = 0;

      while (i < SENAI_ROLES.length) {
        const role = SENAI_ROLES[i];
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
        if (i < SENAI_ROLES.length - 1) {
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

      const finalMapping: Partial<Record<SenaiRole, string>> = {};
      for (const role of SENAI_ROLES) {
        finalMapping[role] = mapping[role] ?? existing?.agents?.[role] ?? DEFAULT_AGENTS[role];
      }

      const config = { version: 1, agents: finalMapping };
      saveAgentConfig(ctx.cwd, config);
      ctx.ui.notify("Agent configuration saved to .pi/senai/agents.json", "info");
    },
  });
}



export function registerFilesCommands(pi: ExtensionAPI) {
  pi.registerCommand("senai-files", {
    description: "Show the configured project file list",
    handler: async (_args, ctx) => {
      const config = loadFilesConfig(ctx.cwd);
      if (!config || getAllSelectedPaths(config).length === 0) {
        ctx.ui.notify("No project files configured. Run /senai-configure-files first.", "info");
        return;
      }
      const lines = ["Pi Senai Project Files", ""];
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

  pi.registerCommand("senai-configure-files", {
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
      ctx.ui.notify("Project files saved to .pi/senai/files.json", "info");
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

export function buildCategoryItems(
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

export function matchesFilter(path: string, query: string): boolean {
  if (!query) return true;
  return path.toLowerCase().includes(query.toLowerCase());
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

export function normalizePath(input: string): string {
  // Keep trailing slash if the user included it; otherwise treat as file.
  return input.replace(/\\/g, "/");
}

export function isPathConflict(path: string, current: string[], other: string[]): boolean {
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

export function isFolderLike(dir: string, entry: fs.Dirent): boolean {
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
  pi.registerCommand("senai-agents-files", {
    description: "Show configured document assignments per role",
    handler: async (_args, ctx) => {
      const config = loadAgentsFilesConfig(ctx.cwd);
      if (!config || Object.keys(config.documents).length === 0) {
        ctx.ui.notify(
          "No agent document assignments configured. Run /senai-configure-agents-files first.",
          "info",
        );
        return;
      }
      const lines = ["Pi Senai Agent Document Assignments", ""];
      for (const role of SENAI_ROLES) {
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

  pi.registerCommand("senai-configure-agents-files", {
    description: "Configure truth and comparison documents for each role",
    handler: async (_args, ctx) => {
      const existing = loadAgentsFilesConfig(ctx.cwd);
      const config: AgentsFilesConfig = existing ?? { version: 2, documents: {} };
      const agentConfig = loadAgentConfig(ctx.cwd);
      const filesConfig = loadFilesConfig(ctx.cwd);
      const candidates = buildDocumentCandidates(ctx.cwd, filesConfig);

      const pickerItems: RolePickerItem[] = SENAI_ROLES.map((role) => {
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
            action.role as SenaiRole,
            config,
            candidates,
            filesConfig?.excludedPaths ?? [],
          );
          // Refresh the summary/assigned state for the selected role.
          const docs = config.documents[action.role as SenaiRole];
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
      ctx.ui.notify("Agent document assignments saved to .pi/senai/agents_files.json", "info");
    },
  });
}

async function editRoleDocuments(
  ctx: ExtensionContext,
  role: SenaiRole,
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
  role: SenaiRole,
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


export function registerDoctorCommand(pi: ExtensionAPI) {
  pi.registerCommand("senai-doctor", {
    description: "Run a full diagnostic check on Senai configuration",
    handler: async (_args, ctx) => {
      const report = runSenaiDiagnostic(ctx.cwd);
      const text = formatDiagnosticReport(report);
      const reportPath = path.join(ctx.cwd, ".IDE_Plans", "senai", "doctor-report.md");
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, text, "utf8");
      pi.sendUserMessage(`${text}\n\nReport saved to .IDE_Plans/senai/doctor-report.md`);
    },
  });
}

export function registerArchitectInputsCommands(pi: ExtensionAPI) {
  pi.registerCommand("senai-configure-architect-inputs", {
    description: "Select documents the architect agent reads",
    handler: async (_args, ctx) => {
      const existing = loadArchitectInputsConfig(ctx.cwd);
      const config: ArchitectInputsConfig = existing ?? createDefaultArchitectInputsConfig();
      const filesConfig = loadFilesConfig(ctx.cwd);
      const excludedPaths = filesConfig?.excludedPaths ?? [
        ".git/",
        "node_modules/",
        "__pycache__/",
        ".venv/",
        "venv/",
        "dist/",
        "build/",
        "target/",
        ".pi/",
        ".idea/",
        ".vscode/",
      ];

      const discovered = discoverProjectFiles(ctx.cwd, excludedPaths);

      const candidates = [
        ...discovered.documentFiles,
        ...discovered.documentFolders.map((f) => f.path),
        ...discovered.testFiles,
        ...discovered.testFolders.map((f) => f.path),
        "README.md",
      ];

      // Build type-aware suggestions.
      const typePatterns: Record<ArchitectDocumentType, RegExp> = {
        prd: /prd|product.requirement|requirements/i,
        mrd: /mrd|market.requirement/i,
        brd: /brd|business.requirement/i,
        rtm: /rtm|traceability|trace/i,
        nfr: /nfr|non.functional|non_functional/i,
        "test-plan": /test.plan|test.strategy|testing/i,
        adr: /adr|architecture.decision/i,
        readme: /readme/i,
        code: /src\/|app\/|lib\//i,
        feasibility: /feasib/i,
      };

      const documentsByType: Partial<Record<ArchitectDocumentType, string[]>> = {};
      for (const docType of Object.keys(typePatterns) as ArchitectDocumentType[]) {
        documentsByType[docType] = candidates.filter((p) => typePatterns[docType].test(p));
      }

      const typeLabels: Record<ArchitectDocumentType, string> = {
        prd: "PRD",
        mrd: "MRD",
        brd: "BRD",
        rtm: "RTM",
        nfr: "NFR",
        "test-plan": "Test plan",
        adr: "ADR",
        readme: "README",
        code: "Code",
        feasibility: "Feasibility",
      };

      const typeIds = Object.keys(typePatterns) as ArchitectDocumentType[];

      let lastSelectedId: string | undefined;

      while (true) {
        const pickerItems: RolePickerItem[] = typeIds.map((docType) => {
          const count = config.documents.filter((d) => d.type === docType).length;
          return {
            id: docType,
            label: typeLabels[docType],
            agent: "",
            summary: count > 0 ? `${count} selected` : "not set",
            assigned: count > 0,
          };
        });
        pickerItems.push({
          id: "additional-constraints",
          label: "Additional constraints",
          agent: "",
          summary: config.additionalConstraints.length > 0
            ? `${config.additionalConstraints.length} entries`
            : "not set",
          assigned: config.additionalConstraints.length > 0,
        });

        const action = await runRolePicker(ctx, {
          title: "Configure architect inputs",
          subtitle: " Select a document type to configure, or Finish when done.",
          items: pickerItems,
          initialSelectedId: lastSelectedId,
        });

        if (action.kind === "back") {
          ctx.ui.notify("Configuration cancelled.", "warning");
          return;
        }

        if (action.kind === "finish") {
          break;
        }

        lastSelectedId = action.role;

        if (action.role === "additional-constraints") {
          const constraints = await ctx.ui.editor(
            "Enter additional constraints (one per line)",
            config.additionalConstraints.join("\n"),
          );
          if (constraints !== undefined) {
            config.additionalConstraints = constraints
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
          }
          continue;
        }

        const docType = action.role as ArchitectDocumentType;
        if (!typeIds.includes(docType)) continue;

        const suggestions = documentsByType[docType] ?? [];
        const current = config.documents.filter((d) => d.type === docType).map((d) => d.path);
        const done = await editArchitectDocumentType(ctx, docType, suggestions, current, excludedPaths);
        if (done === null) continue;
        lastSelectedId = docType;

        config.documents = config.documents.filter((d) => d.type !== docType);
        for (const p of done) {
          config.documents.push({ type: docType, path: p });
        }
      }

      saveArchitectInputsConfig(ctx.cwd, config);
      ctx.ui.notify(
        `Architect inputs saved. ${config.documents.length} documents configured.`,
        "info",
      );
    },
  });
}

async function editArchitectDocumentType(
  ctx: ExtensionContext,
  docType: ArchitectDocumentType,
  suggestions: string[],
  current: string[],
  excludedPaths: string[],
): Promise<string[] | null> {
  let selected = [...current];
  let filterQuery = "";

  while (true) {
    const action = await runListEditor(ctx, {
      title: `${docType.toUpperCase()} inputs (${selected.length} selected)`,
      items: buildArchitectDocumentItems(suggestions, selected),
      filterQuery,
      enableFilter: true,
      customActions: [{ id: "add-custom", label: "Add custom path" }],
      pageSize: SUGGESTION_PAGE_SIZE,
    });

    switch (action.kind) {
      case "back":
        return current;
      case "done":
        return action.paths;
      case "filter":
        selected = action.paths;
        filterQuery = action.query;
        break;
      case "custom": {
        selected = action.paths;
        const picked = await browsePath(ctx, ctx.cwd, "both", excludedPaths);
        if (picked && !selected.includes(picked)) {
          selected.push(normalizePath(picked));
        }
        break;
      }
    }
  }
}

function buildArchitectDocumentItems(suggestions: string[], current: string[]): ListEditorItem[] {
  const items: ListEditorItem[] = [];
  for (const p of suggestions) {
    if (current.includes(p)) continue;
    items.push({
      id: `suggest:${p}`,
      kind: "suggestion",
      label: `⬜ Suggest: ${p}`,
      value: p,
    });
  }
  for (const p of current) {
    items.push({
      id: `selected:${p}`,
      kind: "selected",
      label: `✅ Remove: ${p}`,
      value: p,
    });
  }
  return items;
}

export function registerArchitectCommand(pi: ExtensionAPI) {
  pi.registerCommand("senai-generate-architect", {
    description: "Generate a project-specific architecture agent and skills",
    handler: async (_args, ctx) => {
      const inputsConfig = loadArchitectInputsConfig(ctx.cwd);
      if (!inputsConfig) {
        ctx.ui.notify(
          "No architect inputs configured. Run /senai-configure-architect-inputs first.",
          "warning",
        );
        return;
      }

      if (!ensureAgentConfig(ctx.cwd, ctx)) return;

      const skillPath = path.resolve(ctx.cwd, "skills", "senai-generate-architect.md");
      let skill = "";
      try {
        skill = fs.readFileSync(skillPath, "utf8").replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
      } catch {
        skill = defaultArchitectSkill();
      }

      const selectedPaths = getSelectedInputPaths(inputsConfig);
      const drivers = loadDrivers(ctx.cwd);
      const stale = areDriversStale(ctx.cwd, inputsConfig);
      let changeNote = "";
      if (stale) {
        if (drivers) {
          const proceed = await ctx.ui.confirm(
            "Architecture inputs changed",
            "Input documents are newer than the generated architecture. Re-run the full architecture factory?",
          );
          if (!proceed) {
            ctx.ui.notify("Architecture generation cancelled. Update inputs or re-run when ready.", "info");
            return;
          }
        }
        changeNote =
          "Input documents have changed. Regenerate architectural drivers, profile, report, architecture.md, ADRs, agents, and skills from scratch.";
      }

      const prompt = [
        `<pi-senai-generate-architect>`,
        ``,
        `Generate a project-specific architecture agent and skills.`,
        ``,
        `Configured input documents:`,
        ...selectedPaths.map((p) => `  - ${p}`),
        ``,
        `Additional constraints:`,
        ...inputsConfig.additionalConstraints.map((r) => `  - ${r}`),
        ` `,
        drivers
          ? `Existing architectural drivers are available at .pi/architect/architectural-drivers.json. Re-run the full flow only if the user asks for it or the inputs changed.`
          : `No architectural drivers found. Run the full architect flow.`,
        ``,
        `Expected artifacts:`,
        `  - .pi/architect/architectural-drivers.json`,
        `  - .pi/architect/architect-profile.json`,
        `  - .pi/architect/architect-report.json`,
        `  - .pi/architect/architecture.md`,
        `  - .pi/architect/adrs/*.md`,
        `  - .pi/agents/<project>-<architecture-id>-<role>.md`,
        `  - .pi/skills/<project>-<architecture-id>-<stage>/SKILL.md`,
        changeNote ? `Note: ${changeNote}` : "",
        ``,
        `</pi-senai-generate-architect>`,
        ``,
        skill,
      ].join("\n");

      pi.sendUserMessage(prompt);
    },
  });
}

export function defaultArchitectSkill(): string {
  return [
    `# Architect Generation`,
    ``,
    `Follow the sequence in Doc/architect-sequence.md.`,
    ``,
    `1. Read .pi/senai/architect-inputs.json.`,
    `2. For each configured document, spawn an architect-document-ingest subagent to extract architectural drivers. Run up to 4 subagents in parallel.`,
    `3. Each subagent must write its output to .IDE_Plans/architect-map/<sanitized-path>.json and nowhere else.`,
    `4. Call the senai_merge_architect_drivers tool to merge map outputs into .pi/architect/architectural-drivers.json.`,
    `5. Check for missing critical drivers. Use AskUserQuestion to fill gaps.`,
    `6. Save the updated profile to .pi/architect/architect-profile.json. Use the architecture id (not the long name) as selectedArchitecture.`,
    `7. Read .pi/architecture-library/ and select the best architecture.`,
    `8. Write .pi/architect/architect-report.json with selectedArchitecture (the architecture id), confidence, missingResources, reasoning, skillProfile, developmentOrder, feasibility, feasibilityReasoning, techStack, atomicFunctions, systemOverview, components, interfaces, dataFlow, dataModel, deployment, qualityAttributeMapping, adrs, and constraints.`,
    `9. Evaluate feasibility. If not-feasible, stop and notify the user. If risky, ask before proceeding.`,
    `10. If missingResources is not empty, stop and ask the user whether to search the web for resources.`,
    `11. Call the senai_finalize_architecture tool to generate .pi/architect/architecture.md, .pi/architect/adrs/*.md, .pi/agents/<project>-<architecture-id>-<role>.md, and .pi/skills/<project>-<architecture-id>-<stage>/SKILL.md.`,
    `12. Notify the user of the results.`,

  ].join("\n");
}

export function registerAgentGeneratorCommand(pi: ExtensionAPI) {
  const command = {
    description: "Generate project-specific sub-agents for the non-architecture Senai roles",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!ensureAgentConfig(ctx.cwd, ctx)) return;

      const config = loadAgentConfig(ctx.cwd)!;

      // Target only roles still on built-in defaults. Custom agents and custom
      // mappings are never touched.
      const targets = GENERATED_ROLES.filter(
        (def) => resolveAgentName(config, def.role as SenaiRole) === DEFAULT_AGENTS[def.role as SenaiRole],
      );

      if (targets.length === 0) {
        ctx.ui.notify(
          "All non-architecture roles already have custom agents. Nothing to generate.",
          "info",
        );
        return;
      }

      // Project context: reuse the architect report when it exists, otherwise
      // ask the basic questions (basic mode).
      let report: ArchitectReport | null = null;
      try {
        report = loadArchitectReport(ctx.cwd);
      } catch {
        report = null;
      }

      let stackHints: string[] = [];
      if (report) {
        stackHints = [...report.techStack, ...report.constraints];
      } else {
        const projectType = await ctx.ui.select("Project type?", [
          "automation / scripts",
          "web application",
          "cli tool",
          "library / package",
          "other",
        ]);
        const language = await ctx.ui.input("Primary language? (e.g., python, typescript, apps script)");
        const framework = await ctx.ui.input(
          "Framework or platform? (e.g., fastapi, react, google sheets) — optional, press Enter to skip",
        );
        stackHints = [projectType, language, framework].filter(
          (hint): hint is string => typeof hint === "string" && hint.trim() !== "",
        );
      }

      const resources = discoverTechnologyResources(ctx.cwd);
      const matched = matchTechnologies(stackHints, resources);
      if (matched.length === 0) {
        ctx.ui.notify(
          "No technology resources found. Check resources/technologies/ in the extension.",
          "error",
        );
        return;
      }

      const plans = planAgentGeneration(ctx.cwd, targets, matched, report);
      const resourceList = matched.map((r) => r.name).join(", ");
      const roleList = plans.map((p) => `  - ${p.role} → ${p.agentName}`).join("\n");
      const proceed = await ctx.ui.confirm(
        "Generate sub-agents",
        `Technology resources: ${resourceList}\n\nAgents to generate and map in agents.json:\n${roleList}\n\nExisting custom agents and mappings are not touched. Proceed?`,
      );
      if (!proceed) {
        ctx.ui.notify("Agent generation cancelled.", "info");
        return;
      }

      const result = writeGeneratedAgents(ctx.cwd, plans);

      // Auto-map only roles whose files were actually created.
      const createdNames = new Set(result.created.map((rel) => path.basename(rel, ".md")));
      const mapped = plans.filter((p) => createdNames.has(p.agentName));
      if (mapped.length > 0) {
        const agents = { ...config.agents } as Record<string, string>;
        for (const p of mapped) {
          agents[p.role] = p.agentName;
        }
        saveAgentConfig(ctx.cwd, { ...config, agents });
      }

      const lines = [`Generated ${result.created.length} agent(s) using: ${resourceList}.`];
      if (result.skipped.length > 0) {
        lines.push(`Skipped ${result.skipped.length} existing file(s): ${result.skipped.join(", ")}`);
      }
      if (mapped.length > 0) {
        lines.push(`Mapped ${mapped.length} role(s) in agents.json.`);
      }
      lines.push("Next: run /senai-doctor to verify the setup.");
      ctx.ui.notify(lines.join("\n"), "info");
    },
  };
  pi.registerCommand("senai-generate-sub-agents", command);
}
