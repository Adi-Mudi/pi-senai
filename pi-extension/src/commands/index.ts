import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { runSimpleConfirm } from "../ui/simple-picker.js";
import { loadState, resetState } from "../core/state.js";

import * as StageCmds from "./stage-commands.js";

import { describeHolder, forceStealLock, lockInfo } from "../io/lock.js";
import {
	buildCadenceBlock,
	loadCadenceState,
	resetCadence,
} from "../implement/cadence.js";

import * as StatusCmds from "./status.js";
import * as ApproveCmds from "./approve.js";

export function registerCommands(pi: ExtensionAPI) {
	StageCmds.registerPlanCommand(pi);
	StageCmds.registerImplementCommand(pi);
	StageCmds.registerDocumentCommand(pi);
	StageCmds.registerDeliverCommand(pi);

	StatusCmds.registerStatusCommand(pi);

  ApproveCmds.registerApproveCommand(pi);

  pi.registerCommand("senai-reset", {
    description: "Clear the current senai run state",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      if (state.currentStage === "none") {
        ctx.ui.notify("No active senai run to reset.", "info");
        return;
      }
      const confirmed = await runSimpleConfirm(
        ctx,
        "Reset senai run",
        `Reset run "${state.mission}"? This only deletes the state file; artifacts are preserved.`,
      );
      if (!confirmed) return;
      resetState(ctx.cwd);
      ctx.ui.notify("Senai state reset.", "info");
    },
  });

  // Lock inspection + recovery. /senai-doctor already shows a Lock state
  // section, but these two commands are the single-purpose escape hatches
  // when the user just wants to see or clear the lock without running the
  // full diagnostic.
  pi.registerCommand("senai-lock-info", {
    description: "Show the current senai run lock holder, or report it as free",
    handler: async (_args, ctx) => {
      const holder = lockInfo(ctx.cwd);
      if (!holder) {
        ctx.ui.notify("Senai run lock: free (no holder).", "info");
        return;
      }
      ctx.ui.notify(`Senai run lock: held by ${describeHolder(holder)}.`, "info");
    },
  });

  pi.registerCommand("senai-lock-force", {
    description:
      "Force-take the senai run lock. Use only when /senai-doctor reports a stale lock.",
    handler: async (_args, ctx) => {
      const holder = lockInfo(ctx.cwd);
      const lines: string[] = [];
      if (holder) {
        lines.push(`Current holder: ${describeHolder(holder)}`);
      } else {
        lines.push("Current lock: free (no holder).");
      }
      lines.push(
        "Force-take overwrites the holder metadata with this process. " +
          "Use only when the previous holder has truly exited.",
      );
      const confirmed = await runSimpleConfirm(ctx, "Force-take run lock", lines.join("\n"));
      if (!confirmed) return;
      const meta = forceStealLock(ctx.cwd);
      ctx.ui.notify(`Lock force-taken. New holder: ${describeHolder(meta)}.`, "info");
    },
  });

  pi.registerCommand("senai-cadence-status", {
    description:
      "Show the current adaptive spawn cadence (Plan-stage dispatch tier). Read-only.",
    handler: async (_args, ctx) => {
      const state = loadCadenceState(ctx.cwd);
      const lines: string[] = [
        `Spawn cadence: tier ${state.tier}` +
          (state.consecutiveCleanRuns > 0
            ? ` (${state.consecutiveCleanRuns} clean run${state.consecutiveCleanRuns === 1 ? "" : "s"} since last 429)`
            : " (fresh)"),
        `Last rate-limit error: ${state.last429At ?? "none recorded"}`,
        `Last promotion-eligible: ${state.lastPromotableAt ?? "n/a"}`,
      ];
      if (state.history.length > 0) {
        lines.push("", "Recent history:");
        for (const entry of state.history.slice(-5)) {
          lines.push(`  ${entry.ts}  ${entry.from} → ${entry.to}  (${entry.reason})`);
        }
      }
      lines.push("", buildCadenceBlock(state));
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("senai-cadence-reset", {
    description:
      "Reset the adaptive spawn cadence to tier A (parallel burst). Use when the provider has recovered after tier D.",
    handler: async (_args, ctx) => {
      const prev = loadCadenceState(ctx.cwd);
      const lines = [
        `Current tier: ${prev.tier}` +
          (prev.consecutiveCleanRuns > 0
            ? ` (${prev.consecutiveCleanRuns} clean run${prev.consecutiveCleanRuns === 1 ? "" : "s"} since last 429)`
            : ""),
        `Last rate-limit error: ${prev.last429At ?? "none"}`,
        "",
        "Reset sets tier = A and clears all counters. Future rate-limit errors will demote again.",
      ];
      const confirmed = await runSimpleConfirm(ctx, "Reset spawn cadence", lines.join("\n"));
      if (!confirmed) return;
      const fresh = resetCadence(ctx.cwd);
      ctx.ui.notify(`Cadence reset. Now at tier ${fresh.tier}.`, "info");
    },
  });
}

export { registerDiscussionCommands } from "./discussion.js";

export { registerAgentCommands } from "./configure-agents.js";

export { registerFilesCommands } from "./configure-files.js";

export { registerAgentsFilesCommands } from "./configure-agents-files.js";

export { registerDoctorCommand } from "./doctor.js";

export { registerDocsStructureCommand } from "./generate-docs-structure.js";

export { registerArchitectInputsCommands } from "./configure-architect-inputs.js";

export { registerArchitectCommand, defaultArchitectSkill } from "./generate-architect.js";

// Re-export shared helpers so callers (including tests) can still import them
// from commands/index.ts.
export {
	ensureStage,
	checkStageArtifact,
	listMissingStageArtifacts,
	ensureAgentConfig,
	COMPLETED_STAGE_ARTIFACT,
} from "./_helpers.js";
export { SUGGESTION_PAGE_SIZE, browsePath, normalizePath, isFolderLike, isPathConflict } from "./_shared.js";
export { buildCategoryItems, matchesFilter, buildDocumentCandidates } from "./configure-files.js";

export { registerAgentGeneratorCommand } from "./generate-sub-agents.js";
