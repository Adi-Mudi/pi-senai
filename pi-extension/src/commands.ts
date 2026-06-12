import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { getArtifactPaths, STAGE_TRANSITIONS } from "./constants.js";
import { buildStagePrompt } from "./prompt.js";
import {
  advanceStage,
  loadState,
  resetState,
  startRun,
  type OrchestraState,
} from "./state.js";

const NEXT_COMMAND: Record<string, string> = {
  planned: "/orchestra-implement",
  implemented: "/orchestra-document",
  documented: "/orchestra-deliver",
  delivered: "/orchestra-status",
};

export function registerCommands(pi: ExtensionAPI) {
  pi.registerCommand("orchestra-plan", {
    description: "Start the Plan stage: /orchestra-plan <mission>",
    handler: async (args, ctx) => {
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

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "plan");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("orchestra-implement", {
    description: "Start the Implement stage (requires approved plan)",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      const check = checkStageArtifact(state, "plan", ctx);
      if (!check.ok) return;
      if (state.currentStage !== "planned" && state.currentStage !== "implementing") {
        ctx.ui.notify(
          `Plan must be approved first. Current stage: ${state.currentStage}. Run /orchestra-approve.`,
          "warning",
        );
        return;
      }

      const advance = advanceStage(ctx.cwd, state, "implementing");
      if (!advance.ok) {
        ctx.ui.notify(advance.reason, "error");
        return;
      }

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "implement");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("orchestra-document", {
    description: "Start the Document stage (requires implemented code)",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      const check = checkStageArtifact(state, "plan", ctx);
      if (!check.ok) return;
      if (state.currentStage !== "implemented" && state.currentStage !== "documenting") {
        ctx.ui.notify(
          `Implement stage must be completed first. Current stage: ${state.currentStage}`,
          "warning",
        );
        return;
      }

      const advance = advanceStage(ctx.cwd, state, "documenting");
      if (!advance.ok) {
        ctx.ui.notify(advance.reason, "error");
        return;
      }

      const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "document");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("orchestra-deliver", {
    description: "Start the Deliver stage (requires documentation)",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      const check = checkStageArtifact(state, "plan", ctx);
      if (!check.ok) return;
      if (state.currentStage !== "documented" && state.currentStage !== "delivering") {
        ctx.ui.notify(
          `Document stage must be completed first. Current stage: ${state.currentStage}`,
          "warning",
        );
        return;
      }

      const advance = advanceStage(ctx.cwd, state, "delivering");
      if (!advance.ok) {
        ctx.ui.notify(advance.reason, "error");
        return;
      }

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
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("orchestra-approve", {
    description: "Approve the current stage and advance to the next gate",
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
        `Advance from '${state.currentStage}' to '${nextStage}'?`,
      );
      if (!confirmed) return;

      const advance = advanceStage(ctx.cwd, state, nextStage);
      if (!advance.ok) {
        ctx.ui.notify(advance.reason, "error");
        return;
      }
      const nextCommand = NEXT_COMMAND[nextStage];
      ctx.ui.notify(
        `Advanced to '${nextStage}'.${nextCommand ? ` Run ${nextCommand} to continue.` : ""}`,
        "info",
      );
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

export function checkStageArtifact(
  state: OrchestraState,
  stage: "plan",
  ctx: ExtensionContext,
): { ok: true } | { ok: false } {
  if (state.currentStage === "none") {
    ctx.ui.notify("No active run. Start with /orchestra-plan <mission>", "warning");
    return { ok: false };
  }

  if (stage === "plan") {
    if (!state.runId) {
      ctx.ui.notify("Run ID is missing. Start a new run with /orchestra-plan.", "error");
      return { ok: false };
    }
    const planPath = getArtifactPaths(ctx.cwd, state.runId).plan;
    if (!fs.existsSync(planPath)) {
      ctx.ui.notify(
        `Plan artifact not found: ${planPath}. Complete the Plan stage first.`,
        "warning",
      );
      return { ok: false };
    }
  }

  return { ok: true };
}
