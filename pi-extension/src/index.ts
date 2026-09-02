import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { formatStageStatus, getSenaiDir } from "./constants.js";
import {
  registerAgentCommands,
  registerAgentGeneratorCommand,
  registerAgentsFilesCommands,
  registerArchitectCommand,
  registerArchitectInputsCommands,
  registerCommands,
  registerDiscussionCommands,
  registerDoctorCommand,
  registerDocsStructureCommand,
  registerFilesCommands,
} from "./commands.js";
import { loadState } from "./state.js";
import { buildSenaiCompactionSummary } from "./compaction.js";
import { guardSpawnCall } from "./spawn-guard.js";
import { completionWarning, recordSpawnArtifacts } from "./completion-guard.js";
import { isRateLimitError, record429 } from "./spawn-cadence.js";
import { migrateLegacyArchitectState } from "./architect.js";
import { registerArchitectTools } from "./architect-tools.js";
import { migrateLegacyOrchestraDirs } from "./migrate.js";
import { cleanupTempFiles } from "./atomic-write.js";
import { releaseStaleLockIfHeldByUs, lockInfo } from "./lock.js";
import { describeHolder } from "./lock.js";

export default function piSenaiExtension(pi: ExtensionAPI) {
  // Do not load inside subagent processes to avoid recursive orchestration.
  if (process.env.PI_SUBAGENT_NAME) {
    return;
  }

  // Migrate any architecture state created before the move to .pi/architect/.
  const moved = migrateLegacyArchitectState(process.cwd());
  if (moved.length > 0) {
    console.log(`[pi-senai] Migrated ${moved.length} architecture file(s) to .pi/architect/.`);
  }

  // Migrate legacy Orchestra directories to Senai directories.
  const migratedDirs = migrateLegacyOrchestraDirs(process.cwd());
  if (migratedDirs.length > 0) {
    console.log(`[pi-senai] Migrated legacy directories: ${migratedDirs.join(", ")}`);
  }

  registerCommands(pi);
  registerDiscussionCommands(pi);
  registerAgentCommands(pi);
  registerFilesCommands(pi);
  registerAgentsFilesCommands(pi);
  registerDoctorCommand(pi);
  registerArchitectInputsCommands(pi);
  registerArchitectCommand(pi);
  registerAgentGeneratorCommand(pi);
  registerDocsStructureCommand(pi);
  registerArchitectTools(pi);

  // Per-project defensive recovery on every session_start:
  //   1. Release any lock whose recorded pid is ours (process reuse edge case).
  //   2. Remove orphan `.tmp-*` files left over by a previous session that
  //      crashed between writing the temp file and the atomic rename.
  //   3. Surface the current lock state to the user when a run is active.
  // Runs against `ctx.cwd` so multi-project workspaces get the right cleanup.
  pi.on("session_start", async (_event, ctx) => {
    releaseStaleLockIfHeldByUs(ctx.cwd, process.pid);
    const cleaned = cleanupTempFiles(getSenaiDir(ctx.cwd));
    if (cleaned > 0) {
      console.log(
        `[pi-senai] Cleaned ${cleaned} orphan temp file(s) from a previous session in ${ctx.cwd}.`,
      );
    }
    const state = loadState(ctx.cwd);
    if (state.currentStage === "none") return;
    const lines = [formatStageStatus(state)];
    const holder = lockInfo(ctx.cwd);
    if (holder) {
      lines.push("", `Lock held by ${describeHolder(holder)}.`);
    }
    ctx.ui.notify(lines.join("\n"), "info");
  });

  // Supply a deterministic compaction summary while a senai run is active,
  // so compaction costs no extra LLM call and run/artifact paths survive.
  pi.on("session_before_compact", async (event, ctx) => {
    const summary = buildSenaiCompactionSummary(ctx.cwd);
    if (!summary) return;
    return {
      compaction: {
        summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      },
    };
  });

  // Block subagent spawns that use a bare role/built-in name while a custom
  // agent is mapped for that role — the built-in is read-only and stalls the
  // run. Only active during a senai run; everything else passes through.
  // Also record the artifact paths each spawn is expected to write, so the
  // completion guard below can verify them.
  pi.on("tool_call", (event, ctx) => {
    recordSpawnArtifacts(
      event.toolName,
      event.input as Record<string, unknown> | undefined,
      ctx.cwd,
    );
    return guardSpawnCall(
      event.toolName,
      event.input as Record<string, unknown> | undefined,
      ctx.cwd,
    );
  });

  // Artifact-based completion guard: pi-interactive-subagents reports a
  // subagent "completed" on process exit even when its artifact was never
  // written. Completion notices arrive as extension steer messages, which
  // pass through the input hook. When the recorded artifact is missing or
  // empty, append a resume instruction so the parent never stalls waiting.
  // Also detect rate-limit-style errors in the same steer stream so the
  // adaptive spawn cadence can demote for the rest of this run.
  pi.on("input", (event, ctx) => {
    if (event.source !== "extension") return;
    if (isRateLimitError(event.text)) {
      try {
        record429(ctx.cwd);
      } catch {
        // Best-effort: a cadence write failure must not break the steer.
      }
    }
    const warning = completionWarning(event.text, ctx.cwd);
    if (!warning) return;
    return { action: "transform" as const, text: `${event.text}${warning}` };
  });

  // Inject senai status into the system prompt when a run is active.
  pi.on("before_agent_start", async (_event, ctx) => {
    const state = loadState(ctx.cwd);
    if (state.currentStage === "none") {
      return { systemPrompt: _event.systemPrompt };
    }

    const rules: string[] = [];
    if (state.currentStage === "planning") {
      rules.push(
        `Plan stage rule: You MUST spawn four fresh scout subagents using the subagent tool. ` +
          `Do NOT reuse, copy, or read scout reports from any previous run folder. ` +
          `Do not write scout reports yourself.`,
      );
    }

    const statusBlock = formatStageStatus(state);
    const extra = rules.length > 0 ? `\n\n${rules.join("\n\n")}` : "";
    return {
      systemPrompt: `${_event.systemPrompt}${extra}\n\n${statusBlock}`,
    };
  });
}
