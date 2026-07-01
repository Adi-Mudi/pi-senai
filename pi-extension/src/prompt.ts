import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentConfig } from "./agent-config.js";
import { buildAgentRegistryBlock } from "./agent-registry.js";
import { ORCHESTRA_ROLES, ROLE_LABELS, type OrchestraRole } from "./agent-suggestions.js";
import {
  loadAgentsFilesConfig,
  type AgentsFilesConfig,
  type AgentFilesDocuments,
} from "./agents-files-config.js";
import { loadFilesConfig, type FilesConfig } from "./files-config.js";
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

function formatAgentDocuments(docs: AgentFilesDocuments | undefined): string {
  if (!docs) return "";
  const parts: string[] = [];
  if (docs.primary) parts.push(`truth="${docs.primary}"`);
  if (docs.reads && docs.reads.length > 0) parts.push(`reads="${docs.reads.join(", ")}"`);
  return parts.join(" ");
}

function buildDocumentScopeBlock(
  filesConfig: FilesConfig | null,
  agentsFilesConfig: AgentsFilesConfig | null,
): string {
  const lines = ["## Document Scope", ""];

  if (agentsFilesConfig?.documents && Object.keys(agentsFilesConfig.documents).length > 0) {
    lines.push("Per-agent document assignments:");
    for (const role of ORCHESTRA_ROLES) {
      const docs = agentsFilesConfig.documents[role];
      const docPart = formatAgentDocuments(docs);
      if (docPart) lines.push(`- ${ROLE_LABELS[role]} (${role}): ${docPart}`);
    }
    lines.push("");
  }

  if (filesConfig && getAllSelectedPaths(filesConfig).length > 0) {
    lines.push("Default project context:");
    if (filesConfig.codePaths.length > 0) {
      lines.push(`- Code paths: ${filesConfig.codePaths.join(", ")}`);
    }
    if (filesConfig.inputDocuments.length > 0) {
      lines.push(`- Input documents: ${filesConfig.inputDocuments.join(", ")}`);
    }
    if (filesConfig.testPaths.length > 0) {
      lines.push(`- Test paths: ${filesConfig.testPaths.join(", ")}`);
    }
    lines.push(
      "For roles without assignments, read the relevant category plus current stage artifacts when needed.",
    );
  } else {
    lines.push("No default project files configured.");
  }

  return lines.join("\n");
}

function getAllSelectedPaths(config: FilesConfig): string[] {
  return [...config.codePaths, ...config.inputDocuments, ...config.testPaths];
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
  const agentConfig = loadAgentConfig(cwd);
  const filesConfig = loadFilesConfig(cwd);
  const agentsFilesConfig = loadAgentsFilesConfig(cwd);
  const registryBlock = buildAgentRegistryBlock(agentConfig);
  const documentScopeBlock = buildDocumentScopeBlock(filesConfig, agentsFilesConfig);

  const prompt = [
    `<pi-orchestra stage="${stage}">`,
    `Mission: ${state.mission || "(none)"}`,
    `Run ID: ${state.runId || "(none)"}`,
    ``,
    `Artifact paths for this run:`,
    `  Run directory: ${artifacts.runDir}`,
    `  Plan directory: ${artifacts.planDir}`,
    `    plan.md: ${artifacts.plan}`,
    `    plan-overview.md: ${artifacts.planOverview}`,
    `    discussion-notes.md: ${artifacts.discussionNotes}`,
    `  Plan scouts directory: ${artifacts.planScoutsDir}`,
    `    scout-angle_1.md: ${artifacts.scoutAngle1}`,
    `    scout-angle_2.md: ${artifacts.scoutAngle2}`,
    `    scout-angle_3.md: ${artifacts.scoutAngle3}`,
    `    scout-angle_4.md: ${artifacts.scoutAngle4}`,
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
    registryBlock,
    ``,
    documentScopeBlock,
    ``,
    skill,
  ].join("\n");

  return { skill, context, prompt };
}


