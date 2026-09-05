import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { STAGE_TRANSITIONS, type Stage } from "../core/paths.js";
import { collectImplementSignals, formatImplementSignals, signalsBlockAdvance } from "../implement/signals.js";

import { buildStagePrompt } from "../prompt.js";
import {
	listMissingStageArtifacts,
	COMPLETED_STAGE_ARTIFACT,
} from "./_helpers.js";

import {
  runSimpleConfirm,
} from "../ui/simple-picker.js";
import {
  advanceStage,
  loadState,
  resetState,
} from "../core/state.js";

import * as StageCmds from "./stage-commands.js";

import { withRunLock, describeHolder, forceStealLock, lockInfo } from "../io/lock.js";
import {
  buildCadenceBlock,
  loadCadenceState,
  recordCleanRun,
  resetCadence,
} from "../implement/cadence.js";


import * as StatusCmds from "./status.js";
import { NEXT_COMMAND } from "./_commands-constants.js";

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

export function registerCommands(pi: ExtensionAPI) {
	StageCmds.registerPlanCommand(pi);
	StageCmds.registerImplementCommand(pi);
	StageCmds.registerDocumentCommand(pi);
	StageCmds.registerDeliverCommand(pi);

	StatusCmds.registerStatusCommand(pi);

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

      const confirmed = await runSimpleConfirm(
        ctx,
        "Approve stage",
        `Approve '${state.currentStage}' and run the next stage?`,
      );
      if (!confirmed) return;

      // Acquire the project-wide run lock for the duration of the mutation.
      // Two concurrent Pi sessions, or a double-click inside one session,
      // will surface here as a busy lock with the holder info; the user
      // can retry, run /senai-doctor, or wait for the holder to finish.
      // The user-confirmation is intentionally outside the lock so a cancel
      // never touches the lock directory.
      let pendingSignalSummary: string | null = null;
      const lockResult = await withRunLock(
        { cwd: ctx.cwd, mode: "approve", command: "/senai-approve", runId: state.runId },
        async () => {
          // Re-read state under the lock so we see the freshest snapshot.
          const fresh = loadState(ctx.cwd);
          const current = fresh.currentStage;
          if (current === "none" || current === "delivered") {
            return { kind: "noop" as const, message: `Run is '${current}'.` };
          }
          const expectedNext = STAGE_TRANSITIONS[current][0];
          if (!expectedNext) {
            return { kind: "noop" as const, message: `No next stage from '${current}'.` };
          }

          // Verify the completed stage actually produced its artifacts before
          // advancing. Missing artifacts warn and ask instead of blocking:
          // some stages (document) may legitimately write outside the run dir.
          const artifactStage = COMPLETED_STAGE_ARTIFACT[current];
          const missingArtifacts =
            artifactStage && fresh.runId
              ? listMissingStageArtifacts(ctx.cwd, fresh.runId, artifactStage)
              : [];
          if (missingArtifacts.length > 0) {
            const proceed = await runSimpleConfirm(
              ctx,
              "Artifacts missing",
              `Stage '${current}' is missing artifact(s):\n${missingArtifacts.join("\n")}\n\nAdvance anyway?`,
            );
            if (!proceed) {
              return { kind: "noop" as const, message: "Cancelled by user at artifact check." };
            }
          }

          // Phase 2 discipline signals — collected when leaving the implement
          // stage. In strict mode, blocking findings halt advance; in advisory
          // mode they are surfaced for the user to decide.
          if (current === "implementing" && fresh.runId) {
            const signals = await collectImplementSignals(ctx.cwd, fresh);
            const summary = formatImplementSignals(signals);
            const block = signalsBlockAdvance(signals);
            if (block.blocked) {
              const proceed = await runSimpleConfirm(
                ctx,
                "Discipline findings",
                `${summary}\n\nBlocking reasons:\n${block.reasons.slice(0, 10).join("\n")}\n\nAdvance anyway?`,
              );
              if (!proceed) {
                return { kind: "noop" as const, message: `Cancelled by user at discipline check.\n${summary}` };
              }
            }
            // Always surface the summary alongside the approval notification.
            // The notify handler in the post-lock section concatenates it.
            pendingSignalSummary = summary;
          }

          // Advance from current working stage to completed stage, recording the
          // outcome (approval time + artifact check) in state.stageResults.
          const firstAdvance = advanceStage(
            ctx.cwd,
            fresh,
            expectedNext,
            `approved ${new Date().toISOString()}; artifacts: ${
              missingArtifacts.length === 0
                ? "verified"
                : `missing ${missingArtifacts.length} (user confirmed)`
            }`,
          );
          if (!firstAdvance.ok) {
            return { kind: "error" as const, message: firstAdvance.reason };
          }

          // Adaptive spawn cadence: count a clean Plan-stage approval so the
          // tier can promote after 3 consecutive clean runs. Other stages
          // don't affect the cadence — only the Plan stage has scouts that
          // need adaptive dispatch.
          if (current === "planning") {
            try {
              recordCleanRun(ctx.cwd);
            } catch {
              // Best-effort: a cadence write failure must not block approval.
            }
          }

          const completedStage = expectedNext;
          const nextCommand = NEXT_COMMAND[completedStage];
          const nextWorkingStage = STAGE_COMMANDS[completedStage];

          if (!nextWorkingStage) {
            return { kind: "final" as const, message: `Stage '${current}' approved. Advanced to '${completedStage}'.\nAll stages are complete.` };
          }

          // Auto-advance to the next working stage and run it.
          const secondAdvance = advanceStage(ctx.cwd, firstAdvance.state, nextWorkingStage);
          if (!secondAdvance.ok) {
            return { kind: "error" as const, message: secondAdvance.reason };
          }

          return {
            kind: "advance" as const,
            fromStage: current,
            completedStage,
            nextCommand,
            nextWorkingStage,
            secondState: secondAdvance.state,
          };
        },
      );

      if (!lockResult.ok) {
        ctx.ui.notify(
          `Lock busy — could not acquire the run lock.\n${lockResult.reason}` +
            (lockResult.holder ? `\nHolder: ${describeHolder(lockResult.holder)}` : "") +
            `\nWait a moment, or run /senai-doctor to inspect the lock.`,
          "error",
        );
        return;
      }

      const result = lockResult.value;
      if (result.kind === "noop" || result.kind === "error") {
        ctx.ui.notify(result.message, "error");
        return;
      }
      if (result.kind === "final") {
        ctx.ui.notify(result.message, "info");
        return;
      }
      // result.kind === "advance"
      const signalSuffix = pendingSignalSummary ? `\n\n${pendingSignalSummary}` : "";
      ctx.ui.notify(
        `Stage '${result.fromStage}' approved. Advanced to '${result.completedStage}'.\n` +
          `Automatically running the next stage: ${result.nextCommand}${signalSuffix}`,
        "info",
      );

      // Stage boundary: compact a large parent context before injecting the
      // next stage prompt. The senai session_before_compact hook supplies a
      // deterministic summary, so run state survives compaction.
      // percent is null right after a compaction, so also check absolute
      // tokens: 40% of the context window keeps us below pi's own auto-compact
      // threshold (contextWindow - 16384) even on large-context models.
      const usage = ctx.getContextUsage();
      const overBudget =
        usage != null &&
        ((usage.percent != null && usage.percent >= 50) ||
          (usage.tokens != null && usage.tokens >= 0.4 * usage.contextWindow));
      if (overBudget) {
        ctx.compact({
          customInstructions: "Pi Senai stage boundary. Preserve the run state summary.",
        });
      }

      const { prompt } = buildStagePrompt(ctx.cwd, result.secondState, STAGE_SKILL[result.nextWorkingStage]);
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
