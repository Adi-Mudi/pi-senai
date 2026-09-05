import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadAgentConfig, validateMappedAgents } from "../agents/config.js";

import {
  loadAgentsFilesConfig,
  validateAgentsFilesConfig,
  type AgentsFilesConfig,
} from "../agents/agents-files-config.js";
import { loadFilesConfig, validateFilesConfig } from "../agents/files-config.js";
import {
  SENAI_ROLES,
  ROLE_LABELS,
} from "../agents/suggestions.js";
import { getArtifactPaths, STAGE_TRANSITIONS, type Stage } from "../core/paths.js";
import { collectImplementSignals, formatImplementSignals, signalsBlockAdvance } from "../implement/signals.js";
import {
  formatDiagnosticReport,
  runSenaiDiagnostic,
} from "../doctor/index.js";

import { buildStagePrompt } from "../prompt.js";

import {
  runSimpleConfirm,
} from "../ui/simple-picker.js";
import {
  advanceStage,
  loadState,
  resetState,
  setMissionBriefPath,
  startRun,
  type SenaiState,
} from "../core/state.js";

import {
  getPreRunMissionBriefPath,
} from "../core/paths.js";

import { atomicWriteFile } from "../io/atomic-write.js";
import { withRunLock, describeHolder, forceStealLock, lockInfo } from "../io/lock.js";
import {
  buildCadenceBlock,
  loadCadenceState,
  recordCleanRun,
  resetCadence,
} from "../implement/cadence.js";


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

      // Warn-and-confirm when a run is already in flight. state.json.stage
      // is the source of truth — none and delivered are the only safe
      // starting points; every active stage has artifacts the user might
      // lose by overwriting. Default = cancel (the user re-reads state and
      // chooses again). Note: /senai-plan does NOT touch stage — the warn
      // runs before startRun, never mutates state.
      const existing = loadState(ctx.cwd);
      const activeStage = existing.currentStage;
      if (activeStage !== "none" && activeStage !== "delivered") {
        const proceed = await runSimpleConfirm(
          ctx,
          "Active run in progress",
          `Run "${existing.mission}" (${existing.runId}) is in stage '${activeStage}'.\n\n` +
            `Starting /senai-plan will REPLACE state.json with a new run.\n` +
            `To refine the active run without replacing it, run /senai-discussion instead.\n\n` +
            `Start a new run anyway?`,
        );
        if (!proceed) {
          ctx.ui.notify("Cancelled. Run /senai-discussion to update the active run.", "info");
          return;
        }
      }

      const state = startRun(ctx.cwd, mission);

      // Consume a pre-run discussion if one exists; reference it in state.
      const preRunBrief = getPreRunMissionBriefPath(ctx.cwd);
      let nextState = state;
      if (fs.existsSync(preRunBrief)) {
        nextState = setMissionBriefPath(ctx.cwd, state, path.relative(ctx.cwd, preRunBrief));
      }

      const advance = advanceStage(ctx.cwd, nextState, "planning");
      if (!advance.ok) {
        ctx.ui.notify(advance.reason, "error");
        return;
      }

      const briefNote = advance.state.missionBriefPath
        ? `\nPre-run mission brief consumed: ${advance.state.missionBriefPath}`
        : "";
      ctx.ui.notify(
        `Plan stage started for: ${mission}\n` +
          `When the plan is ready and you approve it, run /senai-approve to continue.` +
          briefNote,
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

/** Working stage -> the artifact group it must have produced. */
const COMPLETED_STAGE_ARTIFACT: Record<string, "plan" | "implement" | "document" | "deliver"> = {
  planning: "plan",
  implementing: "implement",
  documenting: "document",
  delivering: "deliver",
};

function isNonEmptyFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

/** Missing-or-empty artifacts for a completed stage. Mirrors the expectations
 *  of checkStageArtifact, but returns labels instead of notifying, so the
 *  approve flow can warn-and-confirm. */
export function listMissingStageArtifacts(
  cwd: string,
  runId: string,
  stage: "plan" | "implement" | "document" | "deliver",
): string[] {
  const artifacts = getArtifactPaths(cwd, runId);
  if (stage === "plan") {
    const required: Array<[string, string]> = [
      ["plan/plan.md", artifacts.plan],
      ["plan/scouts/scout-angle_1.md", artifacts.scoutAngle1],
      ["plan/scouts/scout-angle_2.md", artifacts.scoutAngle2],
      ["plan/scouts/scout-angle_3.md", artifacts.scoutAngle3],
      ["plan/scouts/scout-angle_4.md", artifacts.scoutAngle4],
    ];
    return required.filter(([, p]) => !isNonEmptyFile(p)).map(([label]) => label);
  }
  if (stage === "implement") {
    return dirHasFiles(artifacts.implementDir) ? [] : ["implement/ (no files)"];
  }
  if (stage === "document") {
    return dirHasFiles(artifacts.documentDir) ? [] : ["document/ (no files)"];
  }
  const required: Array<[string, string]> = [
    ["deliver/security-report.md", artifacts.securityReport],
    ["deliver/deliver-summary.md", artifacts.deliverSummary],
  ];
  return required.filter(([, p]) => !isNonEmptyFile(p)).map(([label]) => label);
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
      "No Pi Senai agent configuration found. Run /senai-generate-sub-agents to generate your team, or /senai-configure-agents to configure agents manually.",
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

export { registerAgentCommands } from "./configure-agents.js";

export { registerFilesCommands } from "./configure-files.js";

export { registerAgentsFilesCommands } from "./configure-agents-files.js";

export function registerDoctorCommand(pi: ExtensionAPI) {
  pi.registerCommand("senai-doctor", {
    description: "Run a full diagnostic check on Senai configuration",
    handler: async (_args, ctx) => {
      const report = runSenaiDiagnostic(ctx.cwd);
      const text = formatDiagnosticReport(report);
      const reportPath = path.join(ctx.cwd, ".IDE_Plans", "pi-senai", "doctor-report.md");
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      atomicWriteFile(reportPath, text, "utf8");
      pi.sendUserMessage(`${text}\n\nReport saved to .IDE_Plans/pi-senai/doctor-report.md`);
    },
  });
}

export { registerDocsStructureCommand } from "./generate-docs-structure.js";

export { registerArchitectInputsCommands } from "./configure-architect-inputs.js";

export { registerArchitectCommand, defaultArchitectSkill } from "./generate-architect.js";

// Re-export shared helpers so callers (including tests) can still import them
// from commands/index.ts. The actual implementations live in _shared.ts.
// Re-export shared helpers so callers (including tests) can still import them
// from commands/index.ts. The actual implementations live in _shared.ts and
// configure-files.ts.
// Re-export shared helpers so callers (including tests) can still import them
// from commands/index.ts. The actual implementations live in _shared.ts and
// configure-files.ts.
export { SUGGESTION_PAGE_SIZE, browsePath, normalizePath, isFolderLike, isPathConflict } from "./_shared.js";
export { buildCategoryItems, matchesFilter, buildDocumentCandidates } from "./configure-files.js";

export { registerAgentGeneratorCommand } from "./generate-sub-agents.js";
