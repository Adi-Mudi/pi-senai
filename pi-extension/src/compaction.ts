import { getArtifactPaths } from "./constants.js";
import { loadState } from "./state.js";

// Builds a deterministic compaction summary from the senai run state.
// Artifact CONTENTS stay on disk; the summary keeps only paths and stage
// status, so a compacted parent session can continue without re-reading.
// Returns null when no senai run is active (pi's default compaction then applies).
export function buildSenaiCompactionSummary(cwd: string): string | null {
  const state = loadState(cwd);
  if (state.currentStage === "none") return null;

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
