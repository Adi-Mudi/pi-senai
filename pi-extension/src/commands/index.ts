import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	SUGGESTION_PAGE_SIZE,
	browsePath,
	normalizePath,
} from "./_shared.js";
import { buildDocumentCandidates } from "./configure-files.js";
import {
  loadAgentConfig,
  resolveAgentName,
  validateMappedAgents,
} from "../agents/config.js";
import {
  loadAgentsFilesConfig,
  saveAgentsFilesConfig,
  validateAgentsFilesConfig,
  type AgentsFilesConfig,
  type AgentFilesDocuments,
} from "../agents/agents-files-config.js";
import { loadFilesConfig, validateFilesConfig } from "../agents/files-config.js";
import {
  PICKER_ROLES,
  SENAI_ROLES,
  ROLE_GUIDANCE,
  ROLE_LABELS,
  type SenaiRole,
} from "../agents/suggestions.js";
import { getArtifactPaths, STAGE_TRANSITIONS, type Stage } from "../core/paths.js";
import { collectImplementSignals, formatImplementSignals, signalsBlockAdvance } from "../implement/signals.js";
import { roleDocumentNeed, suggestTruthDocuments } from "../agents/document-suggestions.js";
import {
  formatDiagnosticReport,
  runSenaiDiagnostic,
} from "../doctor/index.js";

import { buildStagePrompt, loadSkill } from "../prompt.js";
import {
  runListEditor,
  type ListEditorCustomAction,
  type ListEditorItem,
} from "../ui/list-editor.js";
import {
  runRolePicker,
  type RolePickerItem,
} from "../ui/role-picker.js";
import {
  runSimpleConfirm,
  runSimplePicker,
  type SimplePickerItem,
} from "../ui/simple-picker.js";
import {
  advanceStage,
  loadState,
  recordDiscussion,
  resetState,
  setMissionBriefPath,
  startRun,
  type DiscussionEvent,
  type SenaiState,
} from "../core/state.js";
import {
  getPreRunDiscussionDir,
  getPreRunMissionBriefPath,
  getRunDiscussionsDir,
  getRunMissionBriefPath,
} from "../core/paths.js";
import { purgeCache as purgeCommunityCache } from "../scouts/community-research.js";
import {
  finalizeMissionBrief,
  validateBriefSections,
} from "../core/mission-brief.js";
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

export function registerDiscussionCommands(pi: ExtensionAPI) {
  // /senai-discussion is conversational: the parent LLM runs the
  // AskUserQuestion loops driven by skills/senai-discussion.md, then
  // calls recordDiscussion from mission-brief.ts. This slash command
  // emits the stage prompt that loads the skill; the parent does the
  // actual Q&A and writes the brief via its own tool calls.
  pi.registerCommand("senai-discussion", {
    description: "Open a discussion with the user to refine the mission: /senai-discussion <topic>",
    handler: async (args, ctx) => {
      const topic = args.trim();
      const state = loadState(ctx.cwd);
      const location = state.runId ? `run ${state.runId}` : "pre-run";
      const stage = state.currentStage;
      ctx.ui.notify(
        `Opening /senai-discussion (${location}, stage '${stage}').\n` +
          `The parent will ask the mission-type question first, then 2-5 focused questions.\n` +
          `Use /senai-discussion-approve to finalize the mission-brief.md.`,
        "info",
      );
      const briefLocation = state.runId
        ? getRunMissionBriefPath(ctx.cwd, state.runId)
        : getPreRunMissionBriefPath(ctx.cwd);
      const prompt = [
        `<pi-senai stage="discussion">`,
        `Topic: ${topic || "(no topic — start with the mission-type question)"}`,
        `Run: ${state.runId || "(none — pre-run)"}`,
        `Stage: ${state.currentStage}`,
        `Brief location: ${briefLocation}`,
        `</pi-senai>`,
        ``,
        loadSkill("discussion"),
        // Community-research is an optional side-channel inside discussion.
        // The parent loads this skill on demand when a trigger path matches.
        loadSkill("community-research"),
      ].join("\n");
      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("senai-discussion-approve", {
    description: "Finalize the current mission-brief.md (clears the draft marker, logs the event)",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      const briefPath = state.runId
        ? getRunMissionBriefPath(ctx.cwd, state.runId)
        : getPreRunMissionBriefPath(ctx.cwd);

      if (!fs.existsSync(briefPath)) {
        ctx.ui.notify(
          "No mission-brief.md found. Run /senai-discussion first.",
          "warning",
        );
        return;
      }

      // Idempotency pre-check (cheap, outside the lock): if the brief is
      // already finalized AND the most recent recorded event references this
      // exact brief, the second call is a no-op and we never touch the lock.
      const preRaw = fs.readFileSync(briefPath, "utf8");
      if (!preRaw.startsWith("<!-- pi-senai mission-brief: draft -->")) {
        const lastEvent = (state.discussionEvents ?? []).at(-1);
        // lastEvent.briefPath is stored relative to ctx.cwd; resolve against
        // ctx.cwd so the comparison is independent of the test process cwd.
        const sameBrief =
          lastEvent &&
          path.resolve(ctx.cwd, lastEvent.briefPath) === path.resolve(briefPath);
        if (sameBrief) {
          ctx.ui.notify(
            `Mission brief is already finalized. Discussions so far: ${state.discussions ?? 1}.`,
            "info",
          );
          return;
        }
      }

      const lockResult = await withRunLock(
        {
          cwd: ctx.cwd,
          mode: "discussion-approve",
          command: "/senai-discussion-approve",
          runId: state.runId,
        },
        async () => {
          // Re-read both state and brief under the lock so concurrent
          // finalize calls cannot race.
          const fresh = loadState(ctx.cwd);
          const liveBriefPath = fresh.runId
            ? getRunMissionBriefPath(ctx.cwd, fresh.runId)
            : getPreRunMissionBriefPath(ctx.cwd);
          if (!fs.existsSync(liveBriefPath)) {
            return { kind: "missing" as const };
          }
          const raw = fs.readFileSync(liveBriefPath, "utf8");

          // Idempotency under the lock too: re-check in case a sibling
          // command finalized between the pre-check and now.
          if (!raw.startsWith("<!-- pi-senai mission-brief: draft -->")) {
            const lastEvent = (fresh.discussionEvents ?? []).at(-1);
            const sameBrief =
              lastEvent &&
              path.resolve(ctx.cwd, lastEvent.briefPath) === path.resolve(liveBriefPath);
            if (sameBrief) {
              return { kind: "already" as const, count: fresh.discussions ?? 1 };
            }
          }

          const missing = validateBriefSections(raw);
          if (missing.length > 0) {
            const proceed = await runSimpleConfirm(
              ctx,
              "Mission brief has gaps",
              `The brief is missing required sections:\n${missing.join("\n")}\n\nFinalize anyway?`,
            );
            if (!proceed) {
              return { kind: "cancelled" as const };
            }
          }

          finalizeMissionBrief(liveBriefPath);

          // Log the event. Re-read the transcript directory under the lock
          // to find the most recent transcript file (the parent just wrote
          // one). The directory may be missing if no transcript was written.
          const transcriptsDir = fresh.runId
            ? getRunDiscussionsDir(ctx.cwd, fresh.runId)
            : getPreRunDiscussionDir(ctx.cwd);
          let transcriptPath = "";
          try {
            const files = fs
              .readdirSync(transcriptsDir)
              .filter((n) => /^discussion-\d{2}-/.test(n))
              .sort();
            const last = files[files.length - 1];
            if (last) transcriptPath = path.join(transcriptsDir, last);
          } catch {
            transcriptPath = "";
          }

          const event: DiscussionEvent = {
            ts: new Date().toISOString(),
            transcriptPath: path.relative(ctx.cwd, transcriptPath) || transcriptPath,
            briefPath: path.relative(ctx.cwd, liveBriefPath),
            afterStage: fresh.runId ? fresh.currentStage : undefined,
          };

          const recorded = recordDiscussion(ctx.cwd, fresh, event);
          if (!recorded.ok) {
            return { kind: "error" as const, message: recorded.reason };
          }
          return {
            kind: "ok" as const,
            state: recorded.state,
            runId: fresh.runId,
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

      const outcome = lockResult.value;
      if (outcome.kind === "missing") {
        ctx.ui.notify("No mission-brief.md found. Run /senai-discussion first.", "warning");
        return;
      }
      if (outcome.kind === "cancelled") {
        ctx.ui.notify(
          "Cancelled. Fill the missing sections, then re-run /senai-discussion-approve.",
          "info",
        );
        return;
      }
      if (outcome.kind === "error") {
        ctx.ui.notify(outcome.message, "error");
        return;
      }
      if (outcome.kind === "already") {
        ctx.ui.notify(
          `Mission brief was finalized by a concurrent call. Discussions so far: ${outcome.count}.`,
          "info",
        );
        return;
      }
      // outcome.kind === "ok"
      ctx.ui.notify(
        `Mission brief finalized. Discussions so far: ${outcome.state.discussions ?? 1}.\n` +
          (outcome.runId
            ? "Next: run /senai-plan again or /senai-approve to continue the run."
            : "Next: run /senai-plan <mission> to start a run that consumes this brief."),
        "info",
      );
    },
  });

  pi.registerCommand("senai-purge-community-cache", {
    description:
      "Clear all community-research cache entries (.IDE_Plans/pi-senai/.cache/community-research/).",
    handler: async (_args, ctx) => {
      const state = loadState(ctx.cwd);
      const lockResult = await withRunLock(
        {
          cwd: ctx.cwd,
          mode: "discussion-research",
          command: "/senai-purge-community-cache",
          runId: state.runId,
        },
        async () => {
          const purged = purgeCommunityCache(ctx.cwd);
          return { kind: "ok" as const, count: purged };
        },
      );

      if (!lockResult.ok) {
        ctx.ui.notify(
          `Lock busy — could not acquire the run lock.\n${lockResult.reason}` +
            (lockResult.holder ? `\nHolder: ${describeHolder(lockResult.holder)}` : ""),
          "error",
        );
        return;
      }

      ctx.ui.notify(
        `Community-research cache purged: ${lockResult.value.count} file(s) removed.`,
        "info",
      );
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

      // Only picker-visible document roles are shown (PICKER_ROLES).
      // Sequence roles (discussion, planner, code-review, security-gate) and
      // artifact-driven roles are hidden; JSON stays valid for all roles.
      const truthSuggestions = new Map(
        suggestTruthDocuments(ctx.cwd).map((s) => [s.role, s.path]),
      );
      const pickerItems: RolePickerItem[] = PICKER_ROLES.map((role) => {
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
          const suggested = truthSuggestions.get(role);
          summary = suggested ? `not set, suggested: ${suggested}` : "not set";
        }
        return {
          id: role,
          label: ROLE_LABELS[role],
          agent,
          summary,
          assigned,
          guidance: ROLE_GUIDANCE[role],
          needs: roleDocumentNeed(role),
        };
      });

      let editing = true;
      while (editing) {
        const action = await runRolePicker(ctx, {
          title: "Configure agent documents",
          subtitle: " Sequence roles (discussion, planner, code review, security gate) follow stage artifacts automatically — assign them by editing agents_files.json directly.",
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
          const result = await pickTruthDocument(ctx, primary, reads, candidates);
          if (result.action === "set") primary = result.value;
          else if (result.action === "clear") primary = undefined;
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

type TruthPickResult =
  | { action: "set"; value: string }
  | { action: "clear" }
  | { action: "cancel" };

async function pickTruthDocument(
  ctx: ExtensionContext,
  current: string | undefined,
  reads: string[],
  candidates: string[],
): Promise<TruthPickResult> {
  const pickerItems: SimplePickerItem[] = [];
  if (current) pickerItems.push({ id: "__clear__", label: "(clear truth document)" });
  for (const c of candidates) {
    if (c === current || reads.includes(c)) continue;
    pickerItems.push({ id: c, label: c });
  }
  const choice = await runSimplePicker(ctx, { title: "Select truth document", items: pickerItems });
  if (choice === undefined) return { action: "cancel" };
  if (choice === "__clear__") return { action: "clear" };
  return { action: "set", value: choice };
}


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
