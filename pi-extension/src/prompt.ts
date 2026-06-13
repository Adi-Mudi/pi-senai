import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getArtifactPaths, getDefaultArtifactPaths, type StageArtifactPaths } from "./constants.js";
import type { OrchestraState } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StageContext {
  mission: string;
  runId: string;
  stage: string;
  artifacts: StageArtifactPaths;
}

function resolveSkillPath(stage: string): string {
  // skills/ is at repo root; pi-extension/src/ is two levels below repo root
  return path.resolve(__dirname, "../../..", "skills", `orchestra-${stage}.md`);
}

export function loadSkill(stage: string): string {
  const skillPath = resolveSkillPath(stage);
  try {
    let content = fs.readFileSync(skillPath, "utf8");
    // Strip YAML frontmatter if present
    content = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
    return content.trim();
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return `# Orchestra ${stage} stage\n\nNo detailed skill file found at ${skillPath}. Follow the Senai sequence from Doc/senai-full-sequence.md.`;
    }
    throw err;
  }
}

export function buildStagePrompt(
  cwd: string,
  state: OrchestraState,
  stage: string,
): { skill: string; context: StageContext; prompt: string } {
  const artifacts = state.runId
    ? getArtifactPaths(cwd, state.runId)
    : getDefaultArtifactPaths();

  const context: StageContext = {
    mission: state.mission,
    runId: state.runId,
    stage,
    artifacts,
  };

  const skill = loadSkill(stage);

  const prompt = [
    `<pi-orchestra stage="${stage}">`,
    `Mission: ${state.mission || "(none)"}`,
    `Run ID: ${state.runId || "(none)"}`,
    ``,
    `Artifact paths for this run:`,
    `  Run directory: ${artifacts.runDir}`,
    `  Plan directory: ${artifacts.planDir}`,
    `    plan.md: ${artifacts.plan}`,
    `    discussion-notes.md: ${artifacts.discussionNotes}`,
    `  Plan scouts directory: ${artifacts.planScoutsDir}`,
    `    scout-angle_1.md: ${artifacts.scoutAngle1}`,
    `    scout-angle_2.md: ${artifacts.scoutAngle2}`,
    `    scout-angle_3.md: ${artifacts.scoutAngle3}`,
    `  Plan reviews directory: ${artifacts.planReviewsDir}`,
    `    review-correctness.md: ${artifacts.reviewCorrectness}`,
    `    review-security.md: ${artifacts.reviewSecurity}`,
    `    review-tests.md: ${artifacts.reviewTests}`,
    `  Implement directory: ${artifacts.implementDir}`,
    `  Document directory: ${artifacts.documentDir}`,
    `  Deliver directory: ${artifacts.deliverDir}`,
    `    security-report.md: ${artifacts.securityReport}`,
    `    deliver-summary.md: ${artifacts.deliverSummary}`,
    `</pi-orchestra>`,
    ``,
    skill,
  ].join("\n");

  return { skill, context, prompt };
}


