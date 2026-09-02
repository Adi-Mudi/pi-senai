import * as path from "node:path";

export const SENAI_DIR = ".IDE_Plans/senai";
export const STATE_FILE = "state.json";
export const RUNS_DIR = "runs";
export const ARCHITECT_STATE_DIR = ".pi/architect";
export const ARCHITECT_MAP_DIR = ".IDE_Plans/architect-map";

/** Lock directory name under SENAI_DIR. Holds `meta.json` while a Senai
 *  command holds the run lock. The directory itself is the lock primitive
 *  on POSIX (`mkdir` is atomic); the file inside carries holder metadata. */
export const LOCK_DIR_NAME = ".lock";
export const LOCK_FILE_NAME = "meta.json";

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
  runDir: string;
  planDir: string;
  planScoutsDir: string;
  planReviewsDir: string;
  implementDir: string;
  documentDir: string;
  deliverDir: string;
  plan: string;
  planOverview: string;
  discussionNotes: string;
  scoutAngle1: string;
  scoutAngle2: string;
  scoutAngle3: string;
  scoutAngle4: string;
  reviewCorrectness: string;
  reviewSecurity: string;
  reviewTests: string;
  securityReport: string;
  deliverSummary: string;
}

export function getSenaiDir(cwd: string): string {
  return path.join(cwd, SENAI_DIR);
}

export function getLockDir(cwd: string): string {
  return path.join(getSenaiDir(cwd), LOCK_DIR_NAME);
}

export function getLockPath(cwd: string): string {
  return path.join(getLockDir(cwd), LOCK_FILE_NAME);
}

export function getArchitectStateDir(cwd: string): string {
  return path.join(cwd, ARCHITECT_STATE_DIR);
}

export function getArchitectMapDir(cwd: string): string {
  return path.join(cwd, ARCHITECT_MAP_DIR);
}

export function getStatePath(cwd: string): string {
  return path.join(getSenaiDir(cwd), STATE_FILE);
}

export function getRunDir(cwd: string, runId: string): string {
  return path.join(getSenaiDir(cwd), RUNS_DIR, runId);
}

export const PRE_RUN_DISCUSSION_DIR = ".IDE_Plans/senai/discussions/pre-run";

/** Absolute path to the pre-run discussion directory (used when no run is
 *  active yet). */
export function getPreRunDiscussionDir(cwd: string): string {
  return path.join(cwd, PRE_RUN_DISCUSSION_DIR);
}

/** Absolute path to a run's discussion directory. Created on demand by the
 *  discussion command; never created by /senai-plan. */
export function getRunDiscussionsDir(cwd: string, runId: string): string {
  return path.join(getRunDir(cwd, runId), "discussions");
}

/** Absolute path to the active run's mission-brief.md. Lives at the run
 *  root (sibling of plan/, implement/, document/, deliver/, discussions/),
 *  matching the spec-kit in-place integration. */
export function getRunMissionBriefPath(cwd: string, runId: string): string {
  return path.join(getRunDir(cwd, runId), "mission-brief.md");
}

/** Absolute path to a pre-run mission-brief.md (only one exists at a time —
 *  a new discussion overwrites it after the previous one is approved). */
export function getPreRunMissionBriefPath(cwd: string): string {
  return path.join(getPreRunDiscussionDir(cwd), "mission-brief.md");
}

export function getArtifactPaths(cwd: string, runId: string): StageArtifactPaths {
  const runDir = getRunDir(cwd, runId);
  const planDir = path.join(runDir, "plan");
  const planScoutsDir = path.join(planDir, "scouts");
  const planReviewsDir = path.join(planDir, "reviews");
  const implementDir = path.join(runDir, "implement");
  const documentDir = path.join(runDir, "document");
  const deliverDir = path.join(runDir, "deliver");

  return {
    runDir,
    planDir,
    planScoutsDir,
    planReviewsDir,
    implementDir,
    documentDir,
    deliverDir,
    plan: path.join(planDir, "plan.md"),
    planOverview: path.join(planDir, "plan-overview.md"),
    discussionNotes: path.join(planDir, "discussion-notes.md"),
    scoutAngle1: path.join(planScoutsDir, "scout-angle_1.md"),
    scoutAngle2: path.join(planScoutsDir, "scout-angle_2.md"),
    scoutAngle3: path.join(planScoutsDir, "scout-angle_3.md"),
    scoutAngle4: path.join(planScoutsDir, "scout-angle_4.md"),
    reviewCorrectness: path.join(planReviewsDir, "review-correctness.md"),
    reviewSecurity: path.join(planReviewsDir, "review-security.md"),
    reviewTests: path.join(planReviewsDir, "review-tests.md"),
    securityReport: path.join(deliverDir, "security-report.md"),
    deliverSummary: path.join(deliverDir, "deliver-summary.md"),
  };
}

export function getDefaultArtifactPaths(): StageArtifactPaths {
  const runDir = ".IDE_Plans/senai/runs/<run-id>";
  const planDir = path.join(runDir, "plan");
  const planScoutsDir = path.join(planDir, "scouts");
  const planReviewsDir = path.join(planDir, "reviews");
  const implementDir = path.join(runDir, "implement");
  const documentDir = path.join(runDir, "document");
  const deliverDir = path.join(runDir, "deliver");

  return {
    runDir,
    planDir,
    planScoutsDir,
    planReviewsDir,
    implementDir,
    documentDir,
    deliverDir,
    plan: path.join(planDir, "plan.md"),
    planOverview: path.join(planDir, "plan-overview.md"),
    discussionNotes: path.join(planDir, "discussion-notes.md"),
    scoutAngle1: path.join(planScoutsDir, "scout-angle_1.md"),
    scoutAngle2: path.join(planScoutsDir, "scout-angle_2.md"),
    scoutAngle3: path.join(planScoutsDir, "scout-angle_3.md"),
    scoutAngle4: path.join(planScoutsDir, "scout-angle_4.md"),
    reviewCorrectness: path.join(planReviewsDir, "review-correctness.md"),
    reviewSecurity: path.join(planReviewsDir, "review-security.md"),
    reviewTests: path.join(planReviewsDir, "review-tests.md"),
    securityReport: path.join(deliverDir, "security-report.md"),
    deliverSummary: path.join(deliverDir, "deliver-summary.md"),
  };
}

export function makeRunId(mission: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const slug = mission
    .toLowerCase()
    // Drop path-like tokens (/tmp/foo, ./bar, C:\baz) that come from pasted
    // temp paths, and UUID-like / long-hex segments — they make unreadable
    // run ids like "q1-tmp-pi-clipboard-cbcbf548-849e-4918-a".
    // The long-hex rule requires at least one digit so plain long words
    // (which can consist of a-f letters only) are never stripped.
    .replace(/[a-z]:?[\\/][\w./\\-]*/g, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, " ")
    .replace(/\b(?=[0-9a-f]*[0-9])[0-9a-f]{16,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${year}-${month}-${day}-${hours}-${minutes}-${slug || "run"}`;
}

export function formatStageStatus(state: {
  currentStage: Stage;
  mission?: string;
  runId?: string;
}): string {
  const lines = [
    `<pi-senai_status>`,
    `Active stage: ${state.currentStage}`,
  ];
  if (state.mission) lines.push(`Mission: ${state.mission}`);
  if (state.runId) lines.push(`Run ID: ${state.runId}`);
  lines.push(
    ``,
    `Available commands:`,
    `  /senai-plan <mission>`,
    `  /senai-approve`,
    `  /senai-implement`,
    `  /senai-document`,
    `  /senai-deliver`,
    `  /senai-status`,
    `  /senai-reset`,
    `</pi-senai_status>`,
  );
  return lines.join("\n");
}
