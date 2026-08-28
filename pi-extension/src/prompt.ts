import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentConfig } from "./agent-config.js";
import { buildAgentRegistryBlock } from "./agent-registry.js";
import { SENAI_ROLES, ROLE_LABELS } from "./agent-suggestions.js";
import {
  loadAgentsFilesConfig,
  type AgentsFilesConfig,
  type AgentFilesDocuments,
} from "./agents-files-config.js";
import { loadFilesConfig, type FilesConfig } from "./files-config.js";
import { getArtifactPaths, getDefaultArtifactPaths, type StageArtifactPaths } from "./constants.js";
import { buildDocSelectionBlock } from "./doc-selection.js";
import type { SenaiState } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StageContext {
  mission: string;
  runId: string;
  stage: string;
  artifacts: StageArtifactPaths;
}

export function resolveSkillPath(stage: string): string {
  // dist layout: dist/pi-extension/src -> repo root; source layout: pi-extension/src -> repo root
  const candidates = [
    path.resolve(__dirname, "../../..", "skills", `senai-${stage}.md`),
    path.resolve(__dirname, "../..", "skills", `senai-${stage}.md`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
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
      return `# Senai ${stage} stage\n\nNo detailed skill file found at ${skillPath}. Follow the Senai sequence from Doc/senai-full-sequence.md.`;
    }
    throw err;
  }
}

// Artifact-path placeholders used in the stage skill files. Substituted with
// real run paths so the orchestrator and approval gates never render literal
// `<...>` tokens. `<mission>` is handled by missionLine; `<mapped X agent>`
// tokens are filled by the LLM from the Agent Registry block and stay as-is.
const ARTIFACT_PLACEHOLDERS: Array<[string, keyof StageArtifactPaths]> = [
  ["<planOverview>", "planOverview"],
  ["<discussionNotes>", "discussionNotes"],
  ["<scoutAngle1>", "scoutAngle1"],
  ["<scoutAngle2>", "scoutAngle2"],
  ["<scoutAngle3>", "scoutAngle3"],
  ["<scoutAngle4>", "scoutAngle4"],
  ["<reviewCorrectness>", "reviewCorrectness"],
  ["<reviewSecurity>", "reviewSecurity"],
  ["<reviewTests>", "reviewTests"],
  ["<securityReport>", "securityReport"],
  ["<deliverSummary>", "deliverSummary"],
  ["<plan>", "plan"], // last: prefix of <planOverview>
];

export function substituteArtifactPaths(text: string, artifacts: StageArtifactPaths): string {
  let out = text;
  for (const [token, key] of ARTIFACT_PLACEHOLDERS) {
    out = out.split(token).join(artifacts[key]);
  }
  return out;
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
    for (const role of SENAI_ROLES) {
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
    lines.push("");
    lines.push(
      "Verification rule: Before acting on new user input, compare it with your truth document. " +
        "If the input conflicts with the truth, stop and ask the user. Do not override the truth silently.",
    );
  } else {
    lines.push("No default project files configured.");
  }

  return lines.join("\n");
}

function getAllSelectedPaths(config: FilesConfig): string[] {
  return [...config.codePaths, ...config.inputDocuments, ...config.testPaths];
}

const MISSION_INLINE_LIMIT = 1000;
const MISSION_PREVIEW_CHARS = 200;

// Long missions (pasted PRDs, phase trees) bloat every stage prompt. Persist
// the full text once in the run directory and inject only a preview + path.
function missionLine(state: SenaiState, artifacts: StageArtifactPaths): string {
  const mission = state.mission || "";
  if (!mission) return "Mission: (none)";
  if (!state.runId || mission.length <= MISSION_INLINE_LIMIT) return `Mission: ${mission}`;
  const missionPath = path.join(artifacts.runDir, "mission.md");
  if (!fs.existsSync(missionPath)) {
    fs.mkdirSync(artifacts.runDir, { recursive: true });
    fs.writeFileSync(missionPath, mission, "utf8");
  }
  return (
    `Mission (preview): ${mission.slice(0, MISSION_PREVIEW_CHARS)}…\n` +
    `Full mission file (read when needed; pass this path to subagents instead of pasting the mission): ${missionPath}`
  );
}

export function buildStagePrompt(
  cwd: string,
  state: SenaiState,
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

  const skill = substituteArtifactPaths(loadSkill(stage), artifacts);
  const agentConfig = loadAgentConfig(cwd);
  const filesConfig = loadFilesConfig(cwd);
  const agentsFilesConfig = loadAgentsFilesConfig(cwd);
  const registryBlock = buildAgentRegistryBlock(agentConfig);
  const documentScopeBlock = buildDocumentScopeBlock(filesConfig, agentsFilesConfig);

  const prompt = [
    `<pi-senai stage="${stage}">`,
    missionLine(state, artifacts),
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
    `</pi-senai>`,
    ``,
    registryBlock,
    ``,
    documentScopeBlock,
    ...(stage === "document" ? [``, buildDocSelectionBlock(cwd)] : []),
    ``,
    skill,
  ].join("\n");

  return { skill, context, prompt };
}


