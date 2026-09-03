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
  PICKER_ROLES,
  SENAI_ROLES,
  ROLE_GUIDANCE,
  ROLE_LABELS,
  type SenaiRole,
  buildSuggestionMap,
} from "./agent-suggestions.js";
import { getArtifactPaths, STAGE_TRANSITIONS, type Stage } from "./constants.js";
import { roleDocumentNeed, suggestTruthDocuments } from "./document-suggestions.js";
import {
  formatDiagnosticReport,
  runSenaiDiagnostic,
} from "./doctor.js";
import { generateDocsStructure } from "./doc-selection.js";
import { buildStagePrompt, loadSkill, resolveSkillPath } from "./prompt.js";
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
  runSimpleConfirm,
  runSimplePicker,
  type SimplePickerItem,
} from "./ui/simple-picker.js";
import {
  advanceStage,
  loadState,
  recordDiscussion,
  resetState,
  setMissionBriefPath,
  startRun,
  type DiscussionEvent,
  type SenaiState,
} from "./state.js";
import {
  getPreRunDiscussionDir,
  getPreRunMissionBriefPath,
  getRunDiscussionsDir,
  getRunMissionBriefPath,
} from "./constants.js";
import { purgeCache as purgeCommunityCache } from "./scouts/community-research.js";
import {
  finalizeMissionBrief,
  validateBriefSections,
} from "./mission-brief.js";
import { atomicWriteFile } from "./atomic-write.js";
import { withRunLock, describeHolder, forceStealLock, lockInfo } from "./lock.js";
import {
  buildCadenceBlock,
  loadCadenceState,
  recordCleanRun,
  resetCadence,
} from "./spawn-cadence.js";
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
  slugify,
  type ArchitectReport,
} from "./architect.js";
import {
  GENERATED_ROLES,
  discoverTechnologyResources,
  getProjectSlug,
  matchTechnologies,
  planAgentGeneration,
  previewRegeneration,
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
      ctx.ui.notify(
        `Stage '${result.fromStage}' approved. Advanced to '${result.completedStage}'.\n` +
          `Automatically running the next stage: ${result.nextCommand}`,
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

export function registerAgentCommands(pi: ExtensionAPI) {
  pi.registerCommand("senai-agents", {
    description: "Show current agent mapping and validation status",
    handler: async (_args, ctx) => {
      const config = loadAgentConfig(ctx.cwd);
      if (!config) {
        ctx.ui.notify(
          "No agent configuration found. Run /senai-generate-sub-agents or /senai-configure-agents to create it.",
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

      const effectiveAgent = (role: SenaiRole): string =>
        mapping[role] ?? existing?.agents?.[role] ?? suggestions[role] ?? DEFAULT_AGENTS[role];

      let lastSelectedId: string | undefined;
      let editing = true;
      while (editing) {
        const items: RolePickerItem[] = SENAI_ROLES.map((role) => {
          const effective = effectiveAgent(role);
          const suggested = suggestions[role];
          const isCustom = Boolean(mapping[role] ?? existing?.agents?.[role]);
          return {
            id: role,
            label: ROLE_LABELS[role],
            agent: effective,
            summary:
              suggested && suggested !== effective
                ? `suggested: ${suggested}`
                : isCustom
                  ? "custom"
                  : "default",
            assigned: isCustom,
          };
        });

        const action = await runRolePicker(ctx, {
          title: "Configure agents",
          subtitle: " Enter edits one role • Finish saves all • Back cancels. Unedited roles keep their current or suggested agent.",
          items,
          initialSelectedId: lastSelectedId,
          showBack: true,
        });

        if (action.kind === "back") {
          ctx.ui.notify("Agent configuration cancelled — no changes saved.", "info");
          return;
        }
        if (action.kind !== "role") {
          editing = false;
          break;
        }

        const role = action.role as SenaiRole;
        lastSelectedId = role;
        const suggested = suggestions[role] ?? DEFAULT_AGENTS[role];
        const current = effectiveAgent(role);

        const pickerItems: SimplePickerItem[] = [];
        pickerItems.push({ id: "keep", label: `Keep current: ${current}` });
        if (suggested !== current) {
          pickerItems.push({ id: "accept", label: `Accept suggestion: ${suggested}` });
        }
        pickerItems.push({ id: "choose", label: "Choose different" });
        pickerItems.push({ id: "default", label: `Use default: ${DEFAULT_AGENTS[role]}` });

        const choice = await runSimplePicker(ctx, {
          title: `Configure agent for ${ROLE_LABELS[role]} (${role})`,
          items: pickerItems,
        });

        if (choice === "keep") {
          mapping[role] = current;
        } else if (choice === "accept") {
          mapping[role] = suggested;
        } else if (choice === "choose") {
          const agentItems: SimplePickerItem[] = agents.map((a) => ({
            id: a.name,
            label: `${a.name} (${a.source})`,
          }));
          const selected = await runSimplePicker(ctx, {
            title: `Select agent for ${ROLE_LABELS[role]} (${role})`,
            items: agentItems,
          });
          mapping[role] = selected ?? DEFAULT_AGENTS[role];
        } else if (choice === "default") {
          mapping[role] = DEFAULT_AGENTS[role];
        }
        // undefined (esc): no change, back to the list.
      }

      const finalMapping: Partial<Record<SenaiRole, string>> = {};
      for (const role of SENAI_ROLES) {
        finalMapping[role] = effectiveAgent(role);
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
        const choice = await runSimplePicker(ctx, {
          title: `Project files — ${config.codePaths.length} code, ${config.inputDocuments.length} docs, ${config.testPaths.length} tests`,
          items: [
            { id: "code", label: "Edit code paths" },
            { id: "docs", label: "Edit input documents" },
            { id: "tests", label: "Edit test paths" },
            { id: "excluded", label: "Edit excluded paths" },
            { id: "finish", label: "Finish" },
          ],
        });

        if (choice === "code") {
          await editCategory(ctx, config, "codePaths", discovered.codeFolders.map((f) => f.path));
        } else if (choice === "docs") {
          await editCategory(ctx, config, "inputDocuments", [
            ...discovered.documentFolders.map((f) => f.path),
            ...discovered.documentFiles,
          ]);
        } else if (choice === "tests") {
          await editCategory(ctx, config, "testPaths", [
            ...discovered.testFolders.map((f) => f.path),
            ...discovered.testFiles,
          ]);
        } else if (choice === "excluded") {
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

    const pickerItems: SimplePickerItem[] = [];
    if (relativeDir && mode !== "file") {
      pickerItems.push({ id: "select-current", label: `📁 Select this folder (${relativeDir}/)` });
    }
    for (const entry of entries) {
      if (isFolderLike(currentDir, entry)) {
        pickerItems.push({ id: `dir:${entry.name}`, label: `📂 ${entry.name}/` });
      } else if (mode !== "folder") {
        pickerItems.push({ id: `file:${entry.name}`, label: `📄 ${entry.name}` });
      }
    }
    if (currentDir !== root) {
      pickerItems.push({ id: "up", label: "⬆️ ../" });
    }
    pickerItems.push({ id: "cancel", label: "❌ Cancel" });

    const title = relativeDir ? `Browsing ${relativeDir}/` : "Browsing project root";
    const choice = await runSimplePicker(ctx, { title, items: pickerItems });

    if (choice === "cancel") return null;
    if (choice === undefined) continue; // esc redraws the browser, same as before
    if (choice === "up") {
      currentDir = path.dirname(currentDir);
      continue;
    }
    if (choice === "select-current") {
      return `${relativeDir}/`;
    }
    if (choice.startsWith("dir:")) {
      currentDir = path.join(currentDir, choice.slice(4));
      continue;
    }
    if (choice.startsWith("file:")) {
      const name = choice.slice(5);
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

export function registerDocsStructureCommand(pi: ExtensionAPI) {
  pi.registerCommand("senai-generate-docs-structure", {
    description: "Create the docs folder skeleton and template stubs for the selected document types",
    handler: async (_args, ctx) => {
      const result = generateDocsStructure(ctx.cwd);
      const lines = [
        `Docs structure: created ${result.created.length} stub(s), kept ${result.kept.length} existing doc(s).`,
      ];
      if (result.created.length > 0) {
        lines.push("", "Created:");
        for (const p of result.created) lines.push(`  ${p}`);
      }
      if (result.kept.length > 0) {
        lines.push("", "Kept (existing, not overwritten):");
        for (const p of result.kept) lines.push(`  ${p}`);
      }
      lines.push("", "Manifest: .pi/senai/docs-structure.json", "Next: /senai-plan <mission>");
      ctx.ui.notify(lines.join("\n"), "info");
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

      const skillPath = resolveSkillPath("generate-architect");
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
          const proceed = await runSimpleConfirm(
            ctx,
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
      // agents.json is optional here: this command creates/updates it.
      // Roles without a mapping resolve to built-in defaults.
      const config = loadAgentConfig(ctx.cwd) ?? { version: 1, agents: {} };

      // Target roles still on built-in defaults (fresh generation). Custom
      // agents and custom mappings are never touched.
      const fresh = GENERATED_ROLES.filter(
        (def) => resolveAgentName(config, def.role as SenaiRole) === DEFAULT_AGENTS[def.role as SenaiRole],
      );

      // Roles mapped to their expected generated name are previously
      // generated team agents: regenerate candidates. A missing file means a
      // stale mapping — the file is recreated, never stranded.
      const slug = getProjectSlug(ctx.cwd);
      const freshRoles = new Set(fresh.map((def) => def.role));
      const regen = GENERATED_ROLES.filter(
        (def) =>
          !freshRoles.has(def.role) &&
          resolveAgentName(config, def.role as SenaiRole) === `${slug}-${def.role}`,
      );

      const targets = [...fresh, ...regen];

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
        const projectType = await runSimplePicker(ctx, {
          title: "Project type?",
          items: [
            { id: "automation / scripts", label: "automation / scripts" },
            { id: "web application", label: "web application" },
            { id: "cli tool", label: "cli tool" },
            { id: "library / package", label: "library / package" },
            { id: "other", label: "other" },
          ],
        });
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

      // When only the generic fallback matches, the user chooses: fetch real
      // documentation, use generic explicitly, or cancel. Generic is never a
      // silent default.
      const onlyGeneric = matched.every((r) => r.id === "generic");
      if (onlyGeneric) {
        const hintText = stackHints.length > 0 ? ` (${stackHints.join(", ")})` : "";
        const choice = await runSimplePicker(ctx, {
          title: `No technology resource matches this project${hintText}. What do you want to do?`,
          items: [
            { id: "fetch", label: "Fetch from official docs (recommended)" },
            { id: "generic", label: "Use generic resource" },
            { id: "cancel", label: "Cancel" },
          ],
        });
        if (!choice || choice === "cancel") {
          ctx.ui.notify("Agent generation cancelled.", "info");
          return;
        }
        if (choice === "fetch") {
          let techHint = stackHints.join(" ").trim();
          if (!techHint) {
            const answer = await ctx.ui.input(
              "Which technology should I fetch? (e.g., rust, django, react)",
            );
            techHint = (answer ?? "").trim();
            if (!techHint) {
              ctx.ui.notify("No technology given. Agent generation cancelled.", "info");
              return;
            }
          }
          const techId = slugify(techHint);
          const resourcePath = `.pi/technologies/${techId}.md`;
          const prompt = [
            `<pi-senai-fetch-technology>`,
            ``,
            `Create a technology resource file for: ${techHint}`,
            ``,
            `Steps:`,
            `1. Search the web for the OFFICIAL documentation of ${techHint} (official docs site, official guides, official API reference). Do not use blogs or unofficial sources.`,
            `2. Fetch 2-4 official pages.`,
            `3. Write ${resourcePath} following the template at resources/technologies/_template.md:`,
            `   - YAML frontmatter: id: ${techId}, name: <human-readable name>, keywords: [<lowercase keywords including "${techId}">]`,
            `   - Sections: ## Core rules, ## Testing patterns, ## Tooling and limits, ## Common mistakes`,
            `   - Cite the official source URL for every section, like (source: https://...)`,
            `   - Craft only: patterns, limits, testing, common mistakes. No generic advice.`,
            `   - End with a "_Last updated: <date>_" line.`,
            `4. Do NOT guess limits or quotas. If the official docs do not state something, leave it out.`,
            ``,
            `After writing the file, tell the user: "Technology resource created at ${resourcePath}. Re-run /senai-generate-sub-agents to generate your team."`,
            ``,
            `</pi-senai-fetch-technology>`,
          ].join("\n");
          pi.sendUserMessage(prompt);
          return;
        }
        // "Use generic resource" falls through with the generic match.
      }

      const plans = planAgentGeneration(ctx.cwd, targets, matched, report);
      const resourceList = matched.map((r) => r.name).join(", ");

      // Preview the exact write set before asking: fresh agents are created,
      // previously generated agents are classified by manifest hash so the
      // user sees what will be overwritten, kept, or skipped.
      const regenNames = new Set(regen.map((def) => `${slug}-${def.role}`));
      const freshPlans = plans.filter((p) => !regenNames.has(p.agentName));
      const regenPlans = plans.filter((p) => regenNames.has(p.agentName));
      const preview = previewRegeneration(ctx.cwd, regenPlans.map((p) => p.agentName));

      const confirmLines = [`Technology resources: ${resourceList}`, ""];
      if (freshPlans.length > 0) {
        confirmLines.push(
          `New agents to create and map in agents.json (${freshPlans.length}):`,
          ...freshPlans.map((p) => `  - ${p.role} → ${p.agentName}`),
          "",
        );
      }
      if (preview.overwrite.length > 0) {
        confirmLines.push(
          `Regenerate in place — proven untouched since generation (${preview.overwrite.length}):`,
          ...preview.overwrite.map((rel) => `  - ${rel}`),
          "",
        );
      }
      if (preview.recreate.length > 0) {
        confirmLines.push(
          `Recreate — file missing but mapping exists (${preview.recreate.length}):`,
          ...preview.recreate.map((rel) => `  - ${rel}`),
          "",
        );
      }
      if (preview.keptDrifted.length > 0) {
        confirmLines.push(
          `Kept — you edited these after generation, they are NOT overwritten (${preview.keptDrifted.length}):`,
          ...preview.keptDrifted.map((rel) => `  - ${rel}`),
          "",
        );
      }
      if (preview.unknown.length > 0) {
        confirmLines.push(
          `Skipped — existing file of unknown origin, never touched (${preview.unknown.length}):`,
          ...preview.unknown.map((rel) => `  - ${rel}`),
          "",
        );
      }
      confirmLines.push("Existing custom agents and mappings are not touched. Proceed?");
      const proceed = await runSimpleConfirm(ctx, "Generate sub-agents", confirmLines.join("\n"));
      if (!proceed) {
        ctx.ui.notify("Agent generation cancelled.", "info");
        return;
      }

      const result = writeGeneratedAgents(ctx.cwd, plans, { regenerate: true });

      // Auto-map roles whose files were actually written. Regenerated roles
      // already carry the same mapping, so re-saving it is a harmless no-op.
      const writtenNames = new Set(
        [...result.created, ...result.regenerated].map((rel) => path.basename(rel, ".md")),
      );
      const mapped = plans.filter((p) => writtenNames.has(p.agentName));
      if (mapped.length > 0) {
        const agents = { ...config.agents } as Record<string, string>;
        for (const p of mapped) {
          agents[p.role] = p.agentName;
        }
        saveAgentConfig(ctx.cwd, { ...config, agents });
      }

      const lines = [`Generated ${result.created.length} agent(s) using: ${resourceList}.`];
      if (result.regenerated.length > 0) {
        lines.push(`Regenerated ${result.regenerated.length} agent(s) in place (proven untouched).`);
      }
      if (result.keptDrifted.length > 0) {
        lines.push(
          `Kept ${result.keptDrifted.length} agent(s) you edited after generation: ${result.keptDrifted.join(", ")}`,
        );
      }
      if (result.skipped.length > 0) {
        lines.push(
          `Skipped ${result.skipped.length} existing file(s) of unknown origin: ${result.skipped.join(", ")}`,
        );
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
