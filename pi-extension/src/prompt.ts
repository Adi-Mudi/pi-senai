import * as fs from "node:fs";
import * as path from "node:path";
import { loadAgentConfig } from "./core/agents-config/config.js";
import { buildAgentRegistryBlock } from "./agents/registry.js";
import { SENAI_ROLES, ROLE_LABELS } from "./core/agents-config/suggestions.js";
import {
  loadAgentsFilesConfig,
  type AgentsFilesConfig,
  type AgentFilesDocuments,
} from "./core/agents-config/agents-files-config.js";
import { loadFilesConfig, type FilesConfig } from "./core/agents-config/files-config.js";
import { getArtifactPaths, getDefaultArtifactPaths, getRunMissionBriefPath, type StageArtifactPaths } from "./core/paths.js";
import { parseBriefMissionType } from "./core/mission-brief.js";
import { buildDocSelectionBlock } from "./docs-factory/selection.js";
import { atomicWriteFile } from "./io/atomic-write.js";
import { getPackageAssetDir } from "./io/package-dir.js";
import { buildCadenceBlock, loadCadenceState } from "./implement/cadence.js";
import { readFrameworkConfigSafe } from "@adi-mudi/pi-chirpi";
import type { SenaiState } from "./core/state.js";

export interface StageContext {
  mission: string;
  runId: string;
  stage: string;
  artifacts: StageArtifactPaths;
}

export function resolveSkillPath(stage: string): string {
  // package root is the parent of pi-extension/ in both dist and source layouts
  const root = getPackageAssetDir();
  const candidates = [
    path.resolve(root, "skills", `senai-${stage}.md`),
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
  ["<reviewArchitecture>", "reviewArchitecture"],
  ["<manifestDiffReport>", "manifestDiffReport"],
  ["<archRulesReport>", "archRulesReport"],
  ["<frameworkRulesReport>", "frameworkRulesReport"],
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
    atomicWriteFile(missionPath, mission, "utf8");
  }
  return (
    `Mission (preview): ${mission.slice(0, MISSION_PREVIEW_CHARS)}…\n` +
    `Full mission file (read when needed; pass this path to subagents instead of pasting the mission): ${missionPath}`
  );
}

/** Framework lock line for the plan stage: the planner must know the locked
 *  framework (chirpi's .pi/senai/framework.json) before writing the plan's
 *  `## Framework` field — the approve gate enforces an exact match. The safe
 *  reader never throws; a missing or malformed lock reads as "none locked". */
export function buildFrameworkLockBlock(cwd: string): string {
  let locked: string | null = null;
  try {
    const { config } = readFrameworkConfigSafe(cwd);
    locked = config ? config.id : null;
  } catch {
    locked = null;
  }
  if (locked && locked !== "none") {
    return (
      `Framework lock: ${locked}\n` +
      `The framework ${locked} is locked for this project (.pi/senai/framework.json) — the plan's \`## Framework\` field MUST record \`${locked}\`; the approve gate rejects any other value.`
    );
  }
  if (locked === "none") {
    return (
      `Framework lock: none (architecture-only)\n` +
      `The project is locked to architecture-only (.pi/senai/framework.json) — the plan's \`## Framework\` field MUST record \`none\`.`
    );
  }
  return (
    `Framework lock: none locked\n` +
    `No framework is locked. If dependency detection or the tech stack points to one, record it in the plan's \`## Framework\` field.`
  );
}

/** Header lines for the mission type + brief path. Type comes from
 *  state.missionType; when absent, falls back to parsing the brief's own
 *  `## Mission type` section. All I/O is fail-open — an unreadable brief
 *  just omits the lines. */
function missionTypeLines(cwd: string, state: SenaiState): string[] {
  let briefPath = state.missionBriefPath;
  if (!briefPath && state.runId) {
    const runBrief = getRunMissionBriefPath(cwd, state.runId);
    if (fs.existsSync(runBrief)) briefPath = runBrief;
  }
  let missionType = state.missionType;
  if (!missionType && briefPath) {
    try {
      missionType = parseBriefMissionType(fs.readFileSync(path.resolve(cwd, briefPath), "utf8"));
    } catch {
      // Brief unreadable — the header simply omits the lines.
    }
  }
  const lines: string[] = [];
  if (missionType) lines.push(`Mission type: ${missionType}`);
  if (briefPath) lines.push(`Mission brief: ${briefPath}`);
  return lines;
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
    ...missionTypeLines(cwd, state),
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
    `    review-architecture.md: ${artifacts.reviewArchitecture}`,
    `  Implement directory: ${artifacts.implementDir}`,
    `    manifest-diff-report.md: ${artifacts.manifestDiffReport}`,
    `    arch-rules-report.md: ${artifacts.archRulesReport}`,
    `    framework-rules-report.md: ${artifacts.frameworkRulesReport}`,
    `  Document directory: ${artifacts.documentDir}`,
    `  Deliver directory: ${artifacts.deliverDir}`,
    `    security-report.md: ${artifacts.securityReport}`,
    `    deliver-summary.md: ${artifacts.deliverSummary}`,
    `</pi-senai>`,
    ``,
    registryBlock,
    ``,
    documentScopeBlock,
    ...(stage === "planning" ? [``, buildCadenceBlock(loadCadenceState(cwd))] : []),
    // stage is the skill name ("plan"), not the state stage ("planning").
    ...(stage === "plan" ? [``, buildFrameworkLockBlock(cwd)] : []),
    ...(stage === "document" ? [``, buildDocSelectionBlock(cwd)] : []),
    ``,
    skill,
  ].join("\n");

  return { skill, context, prompt };
}


