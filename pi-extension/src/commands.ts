import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { getConfigPath, loadAgentConfig, saveAgentConfig, validateMappedAgents } from "./agent-config.js";
import { discoverAgents } from "./agent-discovery.js";
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
      const mapping: Partial<Record<OrchestraRole, string>> = {};

      for (const role of ORCHESTRA_ROLES) {
        const suggested = suggestions[role] ?? DEFAULT_AGENTS[role];
        const options = [`Accept: ${suggested}`, "Choose different", `Use default: ${DEFAULT_AGENTS[role]}`];
        const choice = await ctx.ui.select(`Configure agent for role "${role}"`, options);

        if (choice === options[0]) {
          mapping[role] = suggested;
        } else if (choice === options[1]) {
          const agentOptions = agents.map((a) => `${a.name} (${a.source})`);
          const selected = await ctx.ui.select(`Select agent for "${role}"`, agentOptions);
          if (selected) {
            mapping[role] = selected.split(" ")[0];
          } else {
            mapping[role] = DEFAULT_AGENTS[role];
          }
        } else {
          mapping[role] = DEFAULT_AGENTS[role];
        }
      }

      const config = { version: 1, agents: mapping };
      saveAgentConfig(ctx.cwd, config);
      ctx.ui.notify("Agent configuration saved to .pi/orchestra/agents.json", "info");
    },
  });
}

