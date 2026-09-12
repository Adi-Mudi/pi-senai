import * as fs from "node:fs";
import { getArtifactPaths, getBrainstormDiscussionDir, getBrainstormMissionBriefPath } from "./paths.js";
import { loadState } from "./state.js";

// Builds a deterministic compaction summary from the senai run state.
// Artifact CONTENTS stay on disk; the summary keeps only paths and stage
// status, so a compacted parent session can continue without re-reading.
// Returns null when no senai run is active (pi's default compaction then applies).
export function buildSenaiCompactionSummary(cwd: string): string | null {
  let state;
  try {
    state = loadState(cwd);
  } catch {
    // A corrupted state.json must never break pi's compaction pipeline:
    // no summary, pi's default compaction applies. The corruption error
    // still surfaces on the next explicit /senai-* command.
    return null;
  }
  if (state.currentStage === "none" && !state.brainstormRunId) return null;

  const lines = [
    "Pi Senai run state (deterministic summary — artifact contents live on disk; read them by path when needed).",
    `Run ID: ${state.runId || "(none)"}`,
    `Current stage: ${state.currentStage}`,
    `Started: ${state.startedAt}`,
  ];

  if (state.mission) {
    const short =
      state.mission.length > 300 ? `${state.mission.slice(0, 300)}…` : state.mission;
    lines.push(`Mission: ${short}`);
  }

  // Brainstorm handoff: the discussion document (decisions ledger) and the
  // brief are the truth a fresh or compacted session must reload by path.
  if (state.brainstormRunId) {
    lines.push(
      "",
      "Brainstorm session:",
      `  Brainstorm run ID: ${state.brainstormRunId}`,
      `  Understanding confirmed: ${state.understandingConfirmed === true ? "yes" : "no"}`,
      `  Mission type: ${state.missionType ?? "(not picked)"}`,
      `  Mission brief: ${getBrainstormMissionBriefPath(cwd, state.brainstormRunId)}`,
    );
    try {
      const dir = getBrainstormDiscussionDir(cwd, state.brainstormRunId);
      const docs = fs
        .readdirSync(dir)
        .filter((n) => /^discussion-\d{2}-/.test(n))
        .sort();
      if (docs.length > 0) {
        lines.push(
          `  Discussion document (Agreed / Not wanted / Open): ${dir}/${docs[docs.length - 1]}`,
        );
      }
    } catch {
      // No discussions recorded yet.
    }
  }

  if (state.discussionDocPath) {
    lines.push(`Discussion document adopted into run: ${state.discussionDocPath}`);
  }

  if (state.runId) {
    const a = getArtifactPaths(cwd, state.runId);
    lines.push(
      "Artifact paths:",
      `  Run directory: ${a.runDir}`,
      `  mission.md (full mission, if present): ${a.runDir}/mission.md`,
      `  plan.md: ${a.plan}`,
      `  plan-overview.md: ${a.planOverview}`,
      `  discussion-notes.md: ${a.discussionNotes}`,
      `  scouts dir: ${a.planScoutsDir}`,
      `  reviews dir: ${a.planReviewsDir}`,
      `  implement dir: ${a.implementDir}`,
      `  document dir: ${a.documentDir}`,
      `  security-report.md: ${a.securityReport}`,
      `  deliver-summary.md: ${a.deliverSummary}`,
    );
  }

  lines.push("Run /senai-status to see the next command for this stage.");
  return lines.join("\n");
}
