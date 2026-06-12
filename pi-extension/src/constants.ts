import * as path from "node:path";

export const ORCHESTRA_DIR = ".pi/orchestra";
export const STATE_FILE = "state.json";
export const RUNS_DIR = "runs";

export type Stage =
  | "none"
  | "planning"
  | "planned"
  | "implementing"
  | "implemented"
  | "documenting"
  | "documented"
  | "delivering"
  | "delivered";

export const STAGES: Stage[] = [
  "none",
  "planning",
  "planned",
  "implementing",
  "implemented",
  "documenting",
  "documented",
  "delivering",
  "delivered",
];

/** Valid stage transitions. Each key lists the stages that may follow it. */
export const STAGE_TRANSITIONS: Record<Stage, Stage[]> = {
  none: ["planning"],
  planning: ["planned"],
  planned: ["implementing"],
  implementing: ["implemented"],
  implemented: ["documenting"],
  documenting: ["documented"],
  documented: ["delivering"],
  delivering: ["delivered"],
  delivered: [],
};

export interface StageArtifactPaths {
  planDir: string;
  plan: string;
  discussionNotes: string;
  scoutAngle1: string;
  scoutAngle2: string;
  scoutAngle3: string;
  reviewCorrectness: string;
  reviewSecurity: string;
  reviewTests: string;
  securityReport: string;
  deliverSummary: string;
}

export function getOrchestraDir(cwd: string): string {
  return path.join(cwd, ORCHESTRA_DIR);
}

export function getStatePath(cwd: string): string {
  return path.join(getOrchestraDir(cwd), STATE_FILE);
}

export function getRunDir(cwd: string, runId: string): string {
  return path.join(getOrchestraDir(cwd), RUNS_DIR, runId);
}

export function getArtifactPaths(cwd: string, runId: string): StageArtifactPaths {
  const planDir = getRunDir(cwd, runId);
  return {
    planDir,
    plan: path.join(planDir, "plan.md"),
    discussionNotes: path.join(planDir, "discussion-notes.md"),
    scoutAngle1: path.join(planDir, "scout-angle_1.md"),
    scoutAngle2: path.join(planDir, "scout-angle_2.md"),
    scoutAngle3: path.join(planDir, "scout-angle_3.md"),
    reviewCorrectness: path.join(planDir, "review-correctness.md"),
    reviewSecurity: path.join(planDir, "review-security.md"),
    reviewTests: path.join(planDir, "review-tests.md"),
    securityReport: path.join(planDir, "security-report.md"),
    deliverSummary: path.join(planDir, "deliver-summary.md"),
  };
}

export function getDefaultArtifactPaths(): StageArtifactPaths {
  return {
    planDir: ".pi/orchestra/runs/<run-id>",
    plan: ".pi/orchestra/runs/<run-id>/plan.md",
    discussionNotes: ".pi/orchestra/runs/<run-id>/discussion-notes.md",
    scoutAngle1: ".pi/orchestra/runs/<run-id>/scout-angle_1.md",
    scoutAngle2: ".pi/orchestra/runs/<run-id>/scout-angle_2.md",
    scoutAngle3: ".pi/orchestra/runs/<run-id>/scout-angle_3.md",
    reviewCorrectness: ".pi/orchestra/runs/<run-id>/review-correctness.md",
    reviewSecurity: ".pi/orchestra/runs/<run-id>/review-security.md",
    reviewTests: ".pi/orchestra/runs/<run-id>/review-tests.md",
    securityReport: ".pi/orchestra/runs/<run-id>/security-report.md",
    deliverSummary: ".pi/orchestra/runs/<run-id>/deliver-summary.md",
  };
}

export function makeRunId(mission: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = mission
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${date}-${slug || "run"}`;
}

export function formatStageStatus(state: {
  currentStage: Stage;
  mission?: string;
  runId?: string;
}): string {
  const lines = [
    `<pi-orchestra_status>`,
    `Active stage: ${state.currentStage}`,
  ];
  if (state.mission) lines.push(`Mission: ${state.mission}`);
  if (state.runId) lines.push(`Run ID: ${state.runId}`);
  lines.push(
    ``,
    `Available commands:`,
    `  /orchestra-plan <mission>`,
    `  /orchestra-implement`,
    `  /orchestra-document`,
    `  /orchestra-deliver`,
    `  /orchestra-status`,
    `  /orchestra-reset`,
    `</pi-orchestra_status>`,
  );
  return lines.join("\n");
}
