import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parseFrontmatter, getAgentDir } from "@mariozechner/pi-coding-agent";
import {
  findNearestProjectAgentsDir,
  getUserAgentsDir,
  parseAgentFileFull,
  type AgentFrontmatter,
} from "./agent-discovery.js";
import { loadAgentConfig, resolveAgentName, type AgentConfig } from "./agent-config.js";
import { loadFilesConfig, type FilesConfig } from "./files-config.js";
import { loadAgentsFilesConfig, type AgentsFilesConfig } from "./agents-files-config.js";
import {
  DEFAULT_AGENTS,
  DOCUMENT_ROLES,
  SENAI_ROLES,
  ROLE_LABELS,
  type SenaiRole,
} from "./agent-suggestions.js";
import { loadArchitectInputsConfig } from "./architect-inputs-config.js";
import { suggestTruthDocuments } from "./document-suggestions.js";
import {
  ARCHITECT_ROLES,
  ARCHITECT_STAGES,
  ARCHITECTURE_AGENT_MAPPING,
  discoverArchitectureLibrary,
  loadArchitectProfile,
  loadArchitectReport,
  loadGeneratedManifest,
  slugify,
  type ArchitectProfile,
  type ArchitectReport,
} from "./architect.js";
import { loadDrivers } from "./driver-extractor.js";
import { getArchitectStateDir, getArtifactPaths } from "./constants.js";
import { loadState, type SenaiState } from "./state.js";
import {
  GENERATED_ROLES,
  GENERATOR_VERSION,
  getBundledTechnologiesDir,
  getProjectSlug,
  getProjectTechnologiesDir,
  parseKeywords,
} from "./agent-generator.js";
import { DOC_TYPES, isDocStub, type DocTypeId } from "./doc-catalog.js";
import { validateBriefSections } from "./mission-brief.js";

export type DiagnosticStatus = "ok" | "warning" | "error" | "info";

export interface DiagnosticItem {
  status: DiagnosticStatus;
  message: string;
  details?: string[];
}

export interface DiagnosticSection {
  title: string;
  items: DiagnosticItem[];
}

export interface DiagnosticReport {
  ok: boolean;
  summary: { ok: number; warning: number; error: number; info: number };
  sections: DiagnosticSection[];
}

export interface ResolvedAgent {
  name: string;
  source: "project" | "user" | "builtin" | "not found";
  filePath: string | null;
  frontmatter: AgentFrontmatter | null;
  shadowed: Array<{ source: "project" | "user" | "builtin"; filePath?: string }>;
}

const BUILTIN_AGENT_NAMES = Array.from(new Set(Object.values(DEFAULT_AGENTS)));

// Tool requirements for the 14 generator roles come from GENERATED_ROLES
// (single source of truth); architecture-bound roles are listed explicitly.
const ROLE_REQUIRED_TOOLS: Partial<Record<SenaiRole, string[]>> = {
  ...Object.fromEntries(GENERATED_ROLES.map((def) => [def.role, def.tools])),
  "scout-1": ["read", "write"],
  planner: ["read", "write"],
  "reviewer-correctness": ["read", "write"],
  "reviewer-security": ["read", "write"],
  "reviewer-tests": ["read", "write"],
  implementer: ["read", "write", "edit"],
  "code-review": ["read", "write"],
};

// Roles that only report via their final message and never write artifact
// files. All artifact-writing roles require (and may have) the write tool.
// Currently empty: linter and full-test write report artifacts since
// generator v3. Keep the mechanism for future read-only roles.
const READONLY_ROLES: SenaiRole[] = [];

const CONFLICTING_READONLY_PATTERNS = [
  { pattern: /fix only/i, reason: "Agent mandate is 'fix only'" },
  { pattern: /do not build/i, reason: "Agent mandate is 'do not build'" },
  { pattern: /do not write/i, reason: "Agent mandate is 'do not write'" },
  { pattern: /do not implement/i, reason: "Agent mandate is 'do not implement'" },
  { pattern: /only diagnoses/i, reason: "Agent is diagnostic-only" },
  { pattern: /only reviews/i, reason: "Agent is review-only" },
];

export function runSenaiDiagnostic(cwd: string): DiagnosticReport {
  const sections: DiagnosticSection[] = [];

  let agentConfig: AgentConfig | null = null;
  let agentConfigError: string | null = null;
  try {
    agentConfig = loadAgentConfig(cwd);
  } catch (err: any) {
    agentConfigError = err.message;
  }

  let filesConfig: FilesConfig | null = null;
  let filesConfigError: string | null = null;
  try {
    filesConfig = loadFilesConfig(cwd);
  } catch (err: any) {
    filesConfigError = err.message;
  }

  let agentsFilesConfig: AgentsFilesConfig | null = null;
  let agentsFilesConfigError: string | null = null;
  try {
    agentsFilesConfig = loadAgentsFilesConfig(cwd);
  } catch (err: any) {
    agentsFilesConfigError = err.message;
  }

  sections.push(checkSetupProgress(cwd));
  sections.push(checkConfigFiles(cwd, agentConfig, filesConfig, agentsFilesConfig, filesConfigError, agentConfigError, agentsFilesConfigError));
  sections.push(checkDiscussions(cwd));

  const resolvedAgents = resolveAllAgents(cwd, agentConfig);
  sections.push(checkAgentMappings(resolvedAgents));
  sections.push(checkAgentCapabilities(resolvedAgents));
  sections.push(checkRunArtifacts(cwd));

  if (filesConfig) {
    sections.push(checkFileScope(cwd, filesConfig));
  }

  if (agentsFilesConfig) {
    sections.push(checkAgentsFiles(cwd, agentsFilesConfig, filesConfig, resolvedAgents));
  }

  sections.push(checkEnvironment());
  sections.push(checkSubagentExtension());
  sections.push(checkStrayFiles(cwd));
  sections.push(checkArchitectureSetup(cwd));
  sections.push(checkArchitectureAgentMapping(cwd, agentConfig));
  sections.push(checkGeneratedAgentContent(cwd));
  sections.push(checkArchitectureDrift(cwd));
  sections.push(checkGeneratedTeamContent(cwd, agentConfig));
  sections.push(checkTechnologyResources(cwd));
  sections.push(checkAgentSkillReferences(cwd, resolvedAgents));
  sections.push(checkAgentFileIntegrity(cwd, resolvedAgents));
  sections.push(checkSecretScan(cwd));
  sections.push(checkDocsFactory(cwd));

  const summary = sections.reduce(
    (acc, section) => {
      for (const item of section.items) {
        acc[item.status]++;
      }
      return acc;
    },
    { ok: 0, warning: 0, error: 0, info: 0 },
  );

  const ok = summary.error === 0;

  return { ok, summary, sections };
}

/** Setup-progress guide: detects which of the documented one-time setup steps
 *  are complete and names the one next command. Guidance only — never emits
 *  errors, so it cannot change the report's pass/fail verdict. */
function checkSetupProgress(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  let filesDone = false;
  try {
    filesDone = loadFilesConfig(cwd) !== null;
  } catch {
    filesDone = false; // corrupted counts as not done; the config section reports it
  }

  let inputsDone = false;
  try {
    inputsDone = loadArchitectInputsConfig(cwd) !== null;
  } catch {
    inputsDone = false;
  }

  let architectDone = false;
  try {
    architectDone = loadArchitectReport(cwd) !== null;
  } catch {
    architectDone = false;
  }

  let agentsDone = false;
  try {
    const agentConfig = loadAgentConfig(cwd);
    if (agentConfig) {
      const slug = getProjectSlug(cwd);
      agentsDone = GENERATED_ROLES.some((def) => {
        const expectedName = `${slug}-${def.role}`;
        return (
          resolveAgentName(agentConfig, def.role as SenaiRole) === expectedName &&
          fs.existsSync(path.join(cwd, ".pi", "agents", `${expectedName}.md`))
        );
      });
    }
  } catch {
    agentsDone = false;
  }

  let agentsFilesDone = false;
  try {
    // Done means at least one real assignment (truth or reads) — an empty
    // agents_files.json means the step was never actually performed.
    const agentsFilesConfig = loadAgentsFilesConfig(cwd);
    agentsFilesDone =
      agentsFilesConfig !== null &&
      Object.values(agentsFilesConfig.documents).some(
        (docs) => docs?.primary !== undefined || (docs?.reads?.length ?? 0) > 0,
      );
  } catch {
    agentsFilesDone = false;
  }

  const steps: Array<{ done: boolean; label: string; command: string }> = [
    { done: filesDone, label: "Project files configured", command: "/senai-configure-files" },
    { done: inputsDone, label: "Architect inputs selected", command: "/senai-configure-architect-inputs" },
    { done: architectDone, label: "Architecture generated", command: "/senai-generate-architect" },
    { done: agentsDone, label: "Sub-agent team generated", command: "/senai-generate-sub-agents" },
    { done: agentsFilesDone, label: "Agent documents assigned", command: "/senai-configure-agents-files" },
  ];

  const completed = steps.filter((s) => s.done).length;
  const allDone = completed === steps.length;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    items.push({
      status: step.done ? "ok" : "info",
      message: `${i + 1}. ${step.label} — ${step.done ? "done" : `pending (run ${step.command})`}`,
    });
  }
  items.push({ status: "info", message: "6. Doctor verification — this command" });
  items.push({
    status: allDone ? "ok" : "info",
    message: `7. First run — ${allDone ? "ready (/senai-plan <mission>)" : "pending"}`,
  });
  items.push({
    status: "info",
    message: "8. Optional: /senai-discussion — refine the mission in a conversational pass before /senai-plan.",
  });

  if (allDone) {
    items.push({ status: "ok", message: "Setup complete — run /senai-plan <mission> to start your first run (or /senai-discussion first to refine the mission)." });
  } else {
    const next = steps.find((s) => !s.done)!;
    items.push({ status: "info", message: `Setup progress: ${completed}/5 checks complete. Next: run ${next.command}.` });
  }

  return { title: "Setup progress", items };
}

function checkConfigFiles(
  cwd: string,
  agentConfig: AgentConfig | null,
  filesConfig: FilesConfig | null,
  agentsFilesConfig: AgentsFilesConfig | null,
  filesConfigError: string | null,
  agentConfigError: string | null,
  agentsFilesConfigError: string | null,
): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const agentPath = path.join(cwd, ".pi", "senai", "agents.json");
  if (agentConfigError) {
    items.push({
      status: "error",
      message: agentConfigError,
      details: ["Run /senai-configure-agents to recreate the file."],
    });
  } else if (agentConfig) {
    items.push({ status: "ok", message: `agents.json found and valid at ${agentPath}` });
    if (agentConfig.version !== 1) {
      items.push({
        status: "warning",
        message: `agents.json version is ${agentConfig.version}; expected 1`,
      });
    }
  } else {
    items.push({
      status: "error",
      message: `agents.json missing or invalid at ${agentPath}`,
      details: ["Run /senai-generate-sub-agents (or /senai-generate-architect) to create it, or /senai-configure-agents to configure agents manually."],
    });
  }

  const filesPath = path.join(cwd, ".pi", "senai", "files.json");
  if (filesConfigError) {
    items.push({
      status: "error",
      message: filesConfigError,
      details: ["Run /senai-configure-files to recreate the file."],
    });
  } else if (filesConfig) {
    items.push({ status: "ok", message: `files.json found and valid at ${filesPath}` });
  } else {
    items.push({
      status: "error",
      message: `files.json missing or invalid at ${filesPath}`,
      details: ["Run /senai-configure-files to create it."],
    });
  }

  const agentsFilesPath = path.join(cwd, ".pi", "senai", "agents_files.json");
  if (agentsFilesConfigError) {
    items.push({
      status: "error",
      message: agentsFilesConfigError,
      details: ["Run /senai-configure-agents-files to recreate the file."],
    });
  } else if (agentsFilesConfig) {
    items.push({
      status: "ok",
      message: `agents_files.json found and valid at ${agentsFilesPath}`,
    });
    if (agentsFilesConfig.version !== 2) {
      items.push({
        status: "warning",
        message: `agents_files.json version is ${agentsFilesConfig.version}; expected 2`,
      });
    }
  } else {
    items.push({
      status: "error",
      message: `agents_files.json missing or invalid at ${agentsFilesPath}`,
      details: ["Run /senai-configure-agents-files to create it."],
    });
  }

  return { title: "Configuration files", items };
}

function resolveAllAgents(
  cwd: string,
  agentConfig: AgentConfig | null,
): Record<SenaiRole, ResolvedAgent> {
  const result = {} as Record<SenaiRole, ResolvedAgent>;

  const projectDir = findNearestProjectAgentsDir(cwd);
  const userDir = getUserAgentsDir();

  for (const role of SENAI_ROLES) {
    const name = resolveAgentName(agentConfig, role);

    const projectPath = projectDir ? path.join(projectDir, `${name}.md`) : null;
    const userPath = path.join(userDir, `${name}.md`);

    const foundProject = projectPath && fs.existsSync(projectPath);
    const foundUser = fs.existsSync(userPath);
    const isBuiltin = BUILTIN_AGENT_NAMES.includes(name);

    let source: ResolvedAgent["source"] = "not found";
    let filePath: string | null = null;
    let frontmatter: AgentFrontmatter | null = null;
    const shadowed: ResolvedAgent["shadowed"] = [];

    if (foundProject) {
      source = "project";
      filePath = projectPath;
      frontmatter = parseAgentFileFull(projectPath) ?? null;
      if (foundUser) shadowed.push({ source: "user", filePath: userPath });
      if (isBuiltin) shadowed.push({ source: "builtin" });
    } else if (foundUser) {
      source = "user";
      filePath = userPath;
      frontmatter = parseAgentFileFull(userPath) ?? null;
      if (isBuiltin) shadowed.push({ source: "builtin" });
    } else if (isBuiltin) {
      source = "builtin";
    }

    result[role] = { name, source, filePath, frontmatter, shadowed };
  }

  return result;
}

function checkAgentMappings(resolved: Record<SenaiRole, ResolvedAgent>): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  for (const role of SENAI_ROLES) {
    const agent = resolved[role];
    const label = ROLE_LABELS[role];

    if (agent.source === "not found") {
      items.push({
        status: "error",
        message: `${label} (${role}) → ${agent.name}: NOT FOUND`,
        details: [
          "No matching agent file in project or user agents, and not a known built-in default.",
          `Create .pi/agents/${agent.name}.md or map this role to an existing agent.`,
        ],
      });
      continue;
    }

    const location =
      agent.source === "builtin"
        ? "built-in default"
        : `${agent.source} agent at ${agent.filePath}`;

    const details: string[] = [`Source: ${location}`];

    if (agent.shadowed.length > 0) {
      for (const shadow of agent.shadowed) {
        if (shadow.source === "builtin") {
          details.push("Note: a built-in agent with the same name is shadowed by this file.");
        } else {
          details.push(
            `Note: ${shadow.source} agent ${shadow.filePath ?? ""} is shadowed by the project file.`,
          );
        }
      }
    }

    if (!agent.frontmatter && agent.source !== "builtin") {
      items.push({
        status: "error",
        message: `${label} (${role}) → ${agent.name}: found but frontmatter is unreadable`,
        details: ["The .md file may be missing name/description or be malformed."],
      });
      continue;
    }

    items.push({
      status: "info",
      message: `${label} (${role}) → ${agent.name}: ${location}`,
      details,
    });
  }

  // Strict collision warning: roles remapped off their built-in default mean
  // the bare default name (e.g. "planner") silently loads the built-in
  // read-only agent. A spawn with the bare name can never write artifacts.
  const collisions: string[] = [];
  for (const role of SENAI_ROLES) {
    const agent = resolved[role];
    if (agent.source === "not found") continue;
    const bare = DEFAULT_AGENTS[role];
    if (agent.name !== bare) {
      collisions.push(`${role}: spawn with "${agent.name}" — the bare name "${bare}" loads the built-in read-only agent`);
    }
  }
  if (collisions.length > 0) {
    items.push({
      status: "warning",
      message: `${collisions.length} role(s) remap a built-in default name — spawns MUST use the exact mapped name`,
      details: [
        ...collisions,
        "During an active run the spawn guard blocks bare names, but outside a run (or in other tools) the wrong agent still loads silently.",
      ],
    });
  }

  return { title: "Agent mapping sources", items };
}

/** Stage ranking for the run artifact audit: which stages imply the plan
 *  artifacts must already exist. */
const STAGE_RANK: Record<string, number> = {
  none: 0,
  planning: 1,
  planned: 2,
  implementing: 3,
  implemented: 4,
  documenting: 5,
  documented: 6,
  delivering: 7,
  delivered: 8,
};

function artifactMissing(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size === 0;
  } catch {
    return true;
  }
}

/** Post-hoc audit of the recorded run: verifies that every artifact a stage
 *  was supposed to produce actually exists and is non-empty. Catches the
 *  "subagent reported completed but wrote nothing" failure seen in real
 *  sessions, which the parent only noticed after user prodding. */
function checkRunArtifacts(cwd: string): DiagnosticSection {
  const title = "Run artifacts";
  let state: SenaiState;
  try {
    state = loadState(cwd);
  } catch {
    return {
      title,
      items: [{ status: "info", message: "state.json unreadable — run artifact audit skipped." }],
    };
  }
  if (!state.runId) {
    return { title, items: [{ status: "info", message: "No senai run recorded yet." }] };
  }

  const artifacts = getArtifactPaths(cwd, state.runId);
  const planArtifacts: Array<[string, string]> = [
    ["plan/plan.md", artifacts.plan],
    ["plan/plan-overview.md", artifacts.planOverview],
    ["plan/discussion-notes.md", artifacts.discussionNotes],
    ["plan/scouts/scout-angle_1.md", artifacts.scoutAngle1],
    ["plan/scouts/scout-angle_2.md", artifacts.scoutAngle2],
    ["plan/scouts/scout-angle_3.md", artifacts.scoutAngle3],
    ["plan/scouts/scout-angle_4.md", artifacts.scoutAngle4],
    ["plan/reviews/review-correctness.md", artifacts.reviewCorrectness],
    ["plan/reviews/review-security.md", artifacts.reviewSecurity],
    ["plan/reviews/review-tests.md", artifacts.reviewTests],
  ];
  const deliverArtifacts: Array<[string, string]> = [
    ["deliver/security-report.md", artifacts.securityReport],
    ["deliver/deliver-summary.md", artifacts.deliverSummary],
  ];
  const missingLabels = (list: Array<[string, string]>) =>
    list.filter(([, p]) => artifactMissing(p)).map(([label]) => label);

  const items: DiagnosticItem[] = [];
  const rank = STAGE_RANK[state.currentStage] ?? 0;

  if (rank >= STAGE_RANK.planned) {
    const missing = missingLabels(planArtifacts);
    if (missing.length > 0) {
      items.push({
        status: "warning",
        message: `Plan stage is marked complete but ${missing.length} artifact(s) are missing or empty`,
        details: [
          ...missing,
          "A writer subagent reported completion without writing its file. Do not trust 'completed' — verify artifacts.",
        ],
      });
    } else {
      items.push({ status: "ok", message: "All 10 plan-stage artifacts exist and are non-empty." });
    }
  } else if (state.currentStage === "planning") {
    const missing = missingLabels(planArtifacts);
    if (missing.length > 0) {
      items.push({
        status: "info",
        message: `Run '${state.runId}' is in 'planning' with ${missing.length}/10 plan artifacts still missing`,
        details: [
          ...missing,
          "If no subagent is actively working on these, the run may be stuck — check the live subagent widget.",
        ],
      });
    }
  }

  if (state.currentStage === "delivered") {
    const missing = missingLabels(deliverArtifacts);
    if (missing.length > 0) {
      items.push({
        status: "error",
        message: `Run is delivered but ${missing.length} deliver artifact(s) are missing or empty`,
        details: missing,
      });
    } else {
      items.push({ status: "ok", message: "Both deliver-stage artifacts exist and are non-empty." });
    }

    // A delivered run must have document-stage output; "delivered" with an
    // empty document/ directory means stages were skipped or state drifted.
    let documentEmpty = true;
    try {
      documentEmpty = fs.readdirSync(artifacts.documentDir).length === 0;
    } catch {
      documentEmpty = true;
    }
    if (documentEmpty) {
      items.push({
        status: "error",
        message: "Run is delivered but the document/ directory is empty or missing.",
        details: ["Stage state and artifacts disagree — inspect the run before trusting it."],
      });
    }

    // Implement-stage reports must live in implement/, never in deliver/.
    let deliverEntries: string[] = [];
    try {
      deliverEntries = fs.readdirSync(artifacts.deliverDir);
    } catch {
      deliverEntries = [];
    }
    const misplaced = deliverEntries.filter((name) =>
      ["lint-report.md", "test-report.md", "full-test-report.md"].includes(name),
    );
    if (misplaced.length > 0) {
      items.push({
        status: "error",
        message: `deliver/ contains implement-stage file(s): ${misplaced.join(", ")}`,
        details: ["Move them into the run's implement/ directory."],
      });
    }
  }

  // plan.md is injected into every later stage prompt — flag token bloat.
  const PLAN_SIZE_WARN_BYTES = 50 * 1024;
  if (rank >= STAGE_RANK.planned) {
    try {
      const size = fs.statSync(artifacts.plan).size;
      if (size > PLAN_SIZE_WARN_BYTES) {
        items.push({
          status: "warning",
          message: `plan.md is ${Math.round(size / 1024)}KB (>${PLAN_SIZE_WARN_BYTES / 1024}KB) — token bloat.`,
          details: [
            "plan.md is injected into every later stage prompt. Slim it down and move detail into referenced files under the plan directory.",
          ],
        });
      }
    } catch {
      /* missing plan.md is already reported above */
    }
  }

  if (items.length === 0) {
    items.push({
      status: "ok",
      message: `Run '${state.runId}' (${state.currentStage}): artifact audit clean.`,
    });
  }
  return { title, items };
}

function checkAgentCapabilities(resolved: Record<SenaiRole, ResolvedAgent>): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  for (const role of SENAI_ROLES) {
    const agent = resolved[role];
    const label = ROLE_LABELS[role];

    // Default mappings and built-ins are the documented pre-generation
    // fallback (Pi ships its planner/scout/reviewer agents read-only by
    // design; for those, the main session compensates writes). Custom-mapped
    // and generated agents must carry the tools their role needs — artifact-
    // writing roles include the write tool. Checks apply to custom agents only.
    const isDefaultMapping = agent.name === DEFAULT_AGENTS[role];
    if (agent.source === "not found" || agent.source === "builtin" || isDefaultMapping || !agent.frontmatter) continue;

    const requiredTools = ROLE_REQUIRED_TOOLS[role] ?? [];
    const tools = agent.frontmatter.tools;

    if (tools === undefined || tools === null) {
      items.push({
        status: "info",
        message: `${label} (${role}) → ${agent.name}: no explicit tools list`,
        details: [
          "The agent frontmatter does not declare tools.",
          "The subagent extension will use its own defaults; capability cannot be verified here.",
        ],
      });
    } else if (tools.length === 0) {
      items.push({
        status: "warning",
        message: `${label} (${role}) → ${agent.name}: explicit tools list is empty`,
        details: ["This agent may not have any tools available."],
      });
    } else {
      const missingTools = requiredTools.filter((t) => !tools.includes(t));
      if (missingTools.length > 0) {
        items.push({
          status: "error",
          message: `${label} (${role}) → ${agent.name}: MISSING REQUIRED TOOLS`,
          details: [
            `Required: ${requiredTools.join(", ")}`,
            `Found: ${tools.join(", ")}`,
            `Missing: ${missingTools.join(", ")}`,
            `Add the missing tools to the agent frontmatter.`,
          ],
        });
      }
    }

    if (READONLY_ROLES.includes(role) && tools && tools.includes("write")) {
      items.push({
        status: "warning",
        message: `${label} (${role}) → ${agent.name}: has write tool but role is read-only`,
        details: [
          "This role should only read and report. The write tool is not needed and may cause unwanted edits.",
        ],
      });
    }

    const description = `${agent.frontmatter.name} ${agent.frontmatter.description}`;
    for (const { pattern, reason } of CONFLICTING_READONLY_PATTERNS) {
      if (pattern.test(description)) {
        items.push({
          status: "error",
          message: `${label} (${role}) → ${agent.name}: ROLE CONFLICT`,
          details: [
            reason,
            `This agent is mapped to ${label}, but its mandate conflicts with that role.`,
            `Map it to a different role or choose a more suitable agent.`,
          ],
        });
        break;
      }
    }

    // scout-1 is excluded: it is architecture-factory-defined and may
    // intentionally map to the architecture planner agent.
    if (role !== "scout-1" && role.startsWith("scout-") && /planner|planning/i.test(description)) {
      items.push({
        status: "warning",
        message: `${label} (${role}) → ${agent.name}: agent looks like a planner`,
        details: [
          "A scout role is mapped to an agent whose name/description indicates planning.",
          "Scouts should search and report. Map a scout/search agent instead.",
        ],
      });
    }

    if (agent.frontmatter.output) {
      items.push({
        status: "warning",
        message: `${label} (${role}) → ${agent.name}: has output="${agent.frontmatter.output}"`,
        details: [
          "The agent may write to its preferred output path instead of the Senai artifact path.",
          "Make sure the agent task explicitly overrides this with the Senai artifact path.",
        ],
      });
    }
  }

  if (items.length === 0) {
    items.push({ status: "ok", message: "All mapped agents have suitable capabilities for their roles." });
  }

  return { title: "Agent-role capability fit", items };
}

function checkFileScope(cwd: string, config: FilesConfig): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const categories: Array<{
    key: keyof FilesConfig;
    label: string;
  }> = [
    { key: "codePaths", label: "Code paths" },
    { key: "inputDocuments", label: "Input documents" },
    { key: "testPaths", label: "Test paths" },
  ];

  for (const { key, label } of categories) {
    const paths = config[key] as string[];
    if (paths.length === 0) {
      items.push({
        status: "warning",
        message: `${label}: none configured`,
      });
      continue;
    }

    const missing: string[] = [];
    for (const p of paths) {
      const fullPath = path.resolve(cwd, p);
      if (!fs.existsSync(fullPath)) {
        missing.push(p);
      }
    }

    if (missing.length > 0) {
      items.push({
        status: "error",
        message: `${label}: ${paths.length} configured, ${missing.length} not found`,
        details: missing,
      });
    } else {
      items.push({
        status: "ok",
        message: `${label}: ${paths.length} configured, all exist`,
      });
    }
  }

  const allSelected = [...config.codePaths, ...config.inputDocuments, ...config.testPaths];
  const conflicts: string[] = [];
  for (let i = 0; i < allSelected.length; i++) {
    for (let j = i + 1; j < allSelected.length; j++) {
      const a = allSelected[i];
      const b = allSelected[j];
      if (isPathConflict(a, b)) {
        conflicts.push(`${a} overlaps ${b}`);
      }
    }
  }

  if (conflicts.length > 0) {
    items.push({
      status: "error",
      message: "Path conflicts detected",
      details: conflicts,
    });
  }

  return { title: "Project file scope", items };
}

function checkAgentsFiles(
  cwd: string,
  config: AgentsFilesConfig,
  filesConfig: FilesConfig | null,
  resolved: Record<SenaiRole, ResolvedAgent>,
): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const allConfiguredDocs = new Set<string>();
  if (filesConfig) {
    for (const p of filesConfig.inputDocuments) allConfiguredDocs.add(path.resolve(cwd, p));
  }

  for (const role of SENAI_ROLES) {
    const docs = config.documents[role];
    if (!docs) continue;
    const label = ROLE_LABELS[role];

    if (docs.primary) {
      const fullPath = path.resolve(cwd, docs.primary);
      if (fs.existsSync(fullPath)) {
        const inScope = allConfiguredDocs.has(fullPath);
        items.push({
          status: inScope ? "ok" : "warning",
          message: `${label} (${role}) truth document: ${docs.primary}`,
          details: inScope
            ? ["File exists and is in the inputDocuments scope."]
            : ["File exists but is NOT in the inputDocuments scope. Add it to files.json if you want agents to discover it."],
        });
      } else {
        items.push({
          status: "error",
          message: `${label} (${role}) truth document MISSING: ${docs.primary}`,
          details: ["The configured truth document does not exist in the project."],
        });
      }
    }

    if (docs.reads) {
      for (const readPath of docs.reads) {
        const fullPath = path.resolve(cwd, readPath);
        if (fs.existsSync(fullPath)) {
          items.push({
            status: "ok",
            message: `${label} (${role}) comparison document: ${readPath}`,
          });
        } else {
          items.push({
            status: "error",
            message: `${label} (${role}) comparison document MISSING: ${readPath}`,
          });
        }
      }
    }
  }

  // Artifact-driven roles consume stage outputs, not project documents. A
  // hand-edited assignment on one of these roles is a configuration error
  // (the /senai-configure-agents-files picker hides these roles by design).
  for (const role of SENAI_ROLES) {
    if ((DOCUMENT_ROLES as readonly string[]).includes(role)) continue;
    const docs = config.documents[role];
    if (!docs) continue;
    const hasAssignment =
      docs.primary !== undefined || (docs.reads?.length ?? 0) > 0;
    if (!hasAssignment) continue;
    const label = ROLE_LABELS[role];
    items.push({
      status: "error",
      message: `${label} (${role}) has document assignments, but this role reads stage artifacts, not project documents.`,
      details: [
        ...(docs.primary ? [`Truth document assigned: ${docs.primary}`] : []),
        ...(docs.reads?.length
          ? [`Comparison documents assigned: ${docs.reads.join(", ")}`]
          : []),
        "Fix: remove this role from agents_files.json (run /senai-configure-agents-files; artifact-driven roles are hidden there by design).",
      ],
    });
  }

  // A truth document that contradicts the suggestion rules is a
  // misassignment: the file exists, so the existence check passes, but the
  // role should follow a different document type. Strict error per user
  // decision; roles without a confident suggestion are not judged.
  const allSuggestions = suggestTruthDocuments(cwd);
  for (const s of allSuggestions) {
    const assigned = config.documents[s.role]?.primary;
    if (!assigned || assigned === s.path) continue;
    if (!fs.existsSync(path.resolve(cwd, assigned))) continue; // the MISSING error above already covers this
    const label = ROLE_LABELS[s.role];
    items.push({
      status: "error",
      message: `${label} (${s.role}) truth document mismatch: assigned ${assigned}, but the expected ${s.reason} looks like ${s.path}.`,
      details: [
        "The assigned file exists, but it does not match the document type this role should follow.",
        `Fix: run /senai-configure-agents-files and set the truth document to ${s.path}. If the assignment is intentional, re-classify the document type via /senai-configure-architect-inputs.`,
      ],
    });
  }

  // Layer 2 — mandate check for roles the suggestion rules do not cover.
  // Compare what the agent does (mandate/description) with what the document
  // is (type, filename, first heading). No overlap = clear contradiction =
  // error. Not enough signal = reported as unverifiable, never silent.
  const unverifiable: string[] = [];
  for (const role of MANDATE_CHECK_ROLES) {
    const assigned = config.documents[role]?.primary;
    if (!assigned) continue;
    const fullPath = path.resolve(cwd, assigned);
    if (!fs.existsSync(fullPath)) continue; // the MISSING error above already covers this
    const docWords = documentSignalWords(cwd, assigned, fullPath);
    const mandateWords = significantWords(mandateTextForRole(resolved[role], role));
    if (docWords.size === 0 || mandateWords.size === 0) {
      unverifiable.push(`${ROLE_LABELS[role]} (${role}) → ${assigned}`);
      continue;
    }
    if (!wordsOverlap(docWords, mandateWords)) {
      const label = ROLE_LABELS[role];
      items.push({
        status: "error",
        message: `${label} (${role}) truth document does not match the agent's mandate: ${assigned}.`,
        details: [
          `Agent mandate: ${mandateTextForRole(resolved[role], role)}`,
          "The document shows no overlap with what this agent does.",
          "Fix: run /senai-configure-agents-files and assign a document that fits the role, or remove the assignment.",
        ],
      });
    }
  }
  if (unverifiable.length > 0) {
    items.push({
      status: "warning",
      message: `Doctor cannot verify ${unverifiable.length} document assignment(s) (not enough signal to judge).`,
      details: [
        ...unverifiable,
        "These assignments pass, but they are YOUR responsibility — doctor has no rule for them.",
        "Tip: classify the document type via /senai-configure-architect-inputs and give the file a meaningful name and top heading to make it verifiable.",
      ],
    });
  }

  // Recommended roles without a truth document get a warning with concrete
  // suggestions; the user approves by running /senai-configure-agents-files.
  // Assignments stay optional. One item per role (not one aggregated item) so
  // every missing assignment is visible in the summary, with the exact
  // default path to assign.
  const suggestions = allSuggestions.filter(
    (s) => !config.documents[s.role]?.primary,
  );
  for (const s of suggestions) {
    items.push({
      status: "warning",
      message: `${ROLE_LABELS[s.role]} (${s.role}) has no truth document. Assign: ${s.path}`,
      details: [
        `Why: ${s.reason}.`,
        "Without a truth document this role reads whatever it finds — the main source of doc bloat and contradictions.",
        `Fix: run /senai-configure-agents-files and set the truth document to ${s.path}.`,
      ],
    });
  }

  if (items.length === 0) {
    items.push({ status: "info", message: "No per-role document assignments configured." });
  }

  return { title: "Agent document assignments", items };
}

function checkEnvironment(): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const inTmux = !!process.env.TMUX;
  const inZellij = !!process.env.ZELLIJ;

  if (inTmux) {
    items.push({ status: "ok", message: "Running inside tmux." });
  } else if (inZellij) {
    items.push({ status: "ok", message: "Running inside Zellij." });
  } else {
    items.push({
      status: "warning",
      message: "Not running inside tmux or Zellij.",
      details: [
        "pi-interactive-subagents needs a terminal multiplexer to spawn subagent panes.",
        "Start Pi inside tmux or Zellij before running Senai stages.",
      ],
    });
  }

  try {
    const settingsPath = path.join(getAgentDir(), "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
        retry?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number };
        compaction?: { enabled?: boolean; reserveTokens?: number };
      };
      if (settings.retry?.enabled === false) {
        items.push({
          status: "warning",
          message: "pi retry is disabled (retry.enabled = false).",
          details: [
            "Subagents that hit provider overload or rate limits fail immediately instead of retrying.",
            "Re-enable retries in settings.json for reliable orchestration.",
          ],
        });
      } else {
        items.push({ status: "ok", message: "pi retry settings are enabled." });
        const maxRetries = settings.retry?.maxRetries;
        if (maxRetries === undefined || maxRetries < 5) {
          items.push({
            status: "info",
            message: `retry.maxRetries is ${maxRetries ?? "default (3)"} — recommend >= 5 for senai runs.`,
            details: [
              "Parallel subagent spawns can hit provider 429s; pi's default backoff (3 attempts at 2/4/8s) is too short.",
              `Set "retry": { "maxRetries": 5, "baseDelayMs": 5000 } in ${settingsPath}.`,
            ],
          });
        }
      }
      if (settings.compaction?.enabled === false) {
        items.push({
          status: "warning",
          message: "pi compaction is disabled (compaction.enabled = false).",
          details: [
            "Long senai runs will overflow the context window instead of compacting.",
            "Re-enable compaction or remove the flag in settings.json.",
          ],
        });
      } else {
        const reserve = settings.compaction?.reserveTokens ?? 16384;
        items.push({
          status: "info",
          message: `pi auto-compacts when context exceeds contextWindow - ${reserve} tokens.`,
          details: [
            "Senai's stage-boundary compaction targets 40% of the window so it fires before this threshold.",
          ],
        });
      }
    }
  } catch {
    items.push({
      status: "info",
      message: "Could not read pi settings.json to verify retry settings.",
    });
  }

  return { title: "Runtime environment", items };
}

/** Known extensions that provide a `subagent` tool. More than one installed
 *  means ambiguous tool resolution and conflicting behavior. */
const SUBAGENT_PROVIDER_PACKAGES = [
  "pi-interactive-subagents",
  "pi-subagents",
  "pi-teams",
  "extensions/subagent",
];

/** Compares dotted versions; returns negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Reads pi's user-level package list (read-only) and verifies the subagent
 *  extension senai depends on: present, new enough, and not shadowed by
 *  dead entries or competing providers. */
function checkSubagentExtension(): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const agentDir = getAgentDir();
  const settingsPath = path.join(agentDir, "settings.json");

  let packages: string[] = [];
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { packages?: string[] };
    packages = Array.isArray(settings.packages) ? settings.packages : [];
  } catch {
    return {
      title: "Subagent extension",
      items: [{ status: "info", message: "Could not read pi settings.json — subagent extension check skipped." }],
    };
  }

  // Dead local-path package entries (non npm:/git: sources that don't exist).
  for (const pkg of packages) {
    if (pkg.startsWith("npm:") || pkg.startsWith("git:")) continue;
    const pkgPath = path.isAbsolute(pkg) ? pkg : path.join(agentDir, pkg);
    if (!fs.existsSync(pkgPath)) {
      items.push({
        status: "warning",
        message: `Dead package entry in settings.json: "${pkg}"`,
        details: [
          `Resolved path does not exist: ${pkgPath}`,
          "A stale entry that later reappears can shadow the real subagent extension. Remove it from settings.json.",
        ],
      });
    }
  }

  // Multiple subagent providers installed.
  const providers = packages.filter((pkg) =>
    SUBAGENT_PROVIDER_PACKAGES.some((known) => pkg.includes(known)),
  );
  if (providers.length > 1) {
    items.push({
      status: "warning",
      message: `Multiple subagent-providing extensions installed: ${providers.join(", ")}`,
      details: [
        "Senai is tested against pi-interactive-subagents; other providers may register conflicting `subagent` tools.",
        "Keep exactly one subagent provider in the packages list.",
      ],
    });
  }

  // pi-interactive-subagents presence and version (git packages live in <agentDir>/git/<host>/<owner>/<repo>/).
  const hasHazAT = packages.some((pkg) => pkg.includes("pi-interactive-subagents"));
  if (!hasHazAT) {
    items.push({
      status: "error",
      message: "pi-interactive-subagents is not in pi's packages list.",
      details: ["Senai delegates all subagent spawning to it. Install: pi install git:github.com/HazAT/pi-interactive-subagents"],
    });
  } else {
    let version: string | null = null;
    try {
      const pkgJson = path.join(agentDir, "git", "github.com", "HazAT", "pi-interactive-subagents", "package.json");
      version = (JSON.parse(fs.readFileSync(pkgJson, "utf8")) as { version?: string }).version ?? null;
    } catch {
      version = null;
    }
    if (version === null) {
      items.push({ status: "info", message: "pi-interactive-subagents is listed but its installed version could not be read." });
    } else if (compareVersions(version, "3.7.2") < 0) {
      items.push({
        status: "warning",
        message: `pi-interactive-subagents ${version} is older than 3.7.2.`,
        details: ["Update it — older versions lack the failure reporting senai relies on."],
      });
    } else {
      items.push({ status: "ok", message: `pi-interactive-subagents ${version} installed.` });
    }
  }

  return { title: "Subagent extension", items };
}

/** Leftover helper scripts (tmp_*.sh / tmp_*.ts) in the project root or run
 *  directories — debris from subagent heredoc workarounds. */
function checkStrayFiles(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const stray: string[] = [];
  const isStray = (name: string) => /^tmp_.*\.(sh|ts)$/.test(name);

  try {
    for (const entry of fs.readdirSync(cwd)) {
      if (isStray(entry)) stray.push(entry);
    }
  } catch {
    /* unreadable root — nothing to report */
  }

  const runsDir = path.join(cwd, ".IDE_Plans", "senai", "runs");
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), entryRel, depth + 1);
      } else if (isStray(entry.name)) {
        stray.push(path.join(".IDE_Plans", "senai", "runs", entryRel).replace(/\\/g, "/"));
      }
    }
  };
  walk(runsDir, "", 0);

  if (stray.length > 0) {
    items.push({
      status: "warning",
      message: `${stray.length} stray tmp_* helper file(s) found`,
      details: [...stray, "Leftovers from subagent heredoc workarounds. Review and delete them."],
    });
  } else {
    items.push({ status: "ok", message: "No stray tmp_* helper files." });
  }
  return { title: "Stray files", items };
}

function isPathConflict(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.endsWith("/") && b.startsWith(a)) return true;
  if (b.endsWith("/") && a.startsWith(b)) return true;
  return false;
}

/** Roles verified by the mandate layer: roles the suggestion rules
 *  (ROLE_TYPE_RULES in document-suggestions.ts) do not cover. scout-3 is
 *  excluded per user decision — it keeps existence-only checking. */
const MANDATE_CHECK_ROLES: SenaiRole[] = ["scout-2", "plan-overview"];

const MANDATE_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "their",
  "them", "they", "will", "shall", "must", "before", "after", "against", "about",
  "report", "write", "reads", "read", "user", "agent", "role",
]);

/** Lowercase word set: drops stopwords and words shorter than 4 chars. */
export function significantWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue;
    if (MANDATE_STOPWORDS.has(raw)) continue;
    words.add(raw);
  }
  return words;
}

/** Exact match, or one word prefixing the other (code/codebase, test/testing). */
export function wordsOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const wa of a) {
    for (const wb of b) {
      if (wa === wb) return true;
      const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
      if (shorter.length >= 4 && longer.startsWith(shorter)) return true;
    }
  }
  return false;
}

/** What the agent does: frontmatter description + generator mandate + label. */
export function mandateTextForRole(agent: ResolvedAgent, role: SenaiRole): string {
  const parts: string[] = [];
  if (agent.frontmatter?.description) parts.push(agent.frontmatter.description);
  const generated = GENERATED_ROLES.find((def) => def.role === role);
  if (generated) parts.push(generated.mandate);
  parts.push(ROLE_LABELS[role]);
  return parts.join(". ");
}

/** What the document is: classified type + filename + first markdown heading. */
export function documentSignalWords(cwd: string, relPath: string, fullPath: string): Set<string> {
  const words = new Set<string>();
  try {
    const inputs = loadArchitectInputsConfig(cwd);
    const entry = inputs?.documents.find((d) => d.path === relPath);
    if (entry?.type) for (const w of significantWords(entry.type)) words.add(w);
  } catch {
    // Invalid architect inputs are reported in the architecture setup section.
  }
  const base = path.basename(relPath).replace(/\.[^.]+$/, "");
  for (const w of significantWords(base)) words.add(w);
  try {
    const content = fs.readFileSync(fullPath, "utf8");
    const heading = content.match(/^#\s+(.+)$/m);
    if (heading) for (const w of significantWords(heading[1])) words.add(w);
  } catch {
    // Unreadable file: fall back to filename/type signals only.
  }
  return words;
}

function checkArchitectureSetup(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const architectStateDir = getArchitectStateDir(cwd);

  const library = discoverArchitectureLibrary(cwd);
  if (library.length === 0) {
    items.push({
      status: "warning",
      message: "Architecture library is empty or missing.",
      details: ["Create .pi/architecture-library/*.md or *.json files with architecture references."],
    });
  } else {
    items.push({
      status: "ok",
      message: `Architecture library has ${library.length} entries.`,
    });
  }

  let inputsConfig: ReturnType<typeof loadArchitectInputsConfig> = null;
  let inputsConfigError: string | null = null;
  try {
    inputsConfig = loadArchitectInputsConfig(cwd);
  } catch (err: any) {
    inputsConfigError = err.message;
  }
  if (inputsConfigError) {
    items.push({
      status: "error",
      message: inputsConfigError,
      details: ["Run /senai-configure-architect-inputs to recreate it, or fix the JSON manually."],
    });
  } else if (!inputsConfig) {
    items.push({
      status: "info",
      message: "No architect inputs configured. Run /senai-configure-architect-inputs to set them.",
    });
  } else {
    const missingFiles: string[] = [];
    for (const doc of inputsConfig.documents) {
      const fullPath = path.resolve(cwd, doc.path);
      if (!fs.existsSync(fullPath)) {
        missingFiles.push(doc.path);
      }
    }
    if (missingFiles.length > 0) {
      items.push({
        status: "error",
        message: `${missingFiles.length} configured architect input documents are missing.`,
        details: missingFiles,
      });
    } else {
      items.push({
        status: "ok",
        message: `Architect inputs configured with ${inputsConfig.documents.length} documents.`,
      });
    }
  }

  try {
    const drivers = loadDrivers(cwd);
    if (!drivers) {
      items.push({
        status: "info",
        message: "No architectural drivers generated yet. Run /senai-generate-architect.",
      });
    } else {
      items.push({
        status: "ok",
        message: `Architectural drivers file exists at .pi/architect/architectural-drivers.json.`,
      });
    }
  } catch (err: any) {
    items.push({
      status: "error",
      message: `Invalid architectural drivers at .pi/architect/architectural-drivers.json: ${err.message}`,
      details: ["Run /senai-generate-architect to regenerate the drivers, or fix the JSON manually."],
    });
  }

  // Warn about stale intermediate driver files in the old root location.
  const oldRootDrivers = path.join(cwd, ".pi", "senai");
  if (fs.existsSync(oldRootDrivers)) {
    const stale = fs.readdirSync(oldRootDrivers).filter((f) => f.startsWith("drivers-") && f.endsWith(".json"));
    if (stale.length > 0) {
      items.push({
        status: "warning",
        message: `${stale.length} stale intermediate driver files found in .pi/senai/.`,
        details: stale.map((f) => `.pi/senai/${f} — move or delete this file`),
      });
    }
  }

  let profile: ArchitectProfile | null = null;
  try {
    profile = loadArchitectProfile(cwd);
    if (!profile) {
      items.push({
        status: "info",
        message: "No architect profile generated yet.",
      });
    } else {
      items.push({
        status: "ok",
        message: `Architect profile exists: ${profile.projectName} → ${profile.selectedArchitecture}.`,
      });
    }
  } catch (err: any) {
    items.push({
      status: "error",
      message: `Invalid architect profile at .pi/architect/architect-profile.json: ${err.message}`,
      details: ["Run /senai-generate-architect to regenerate the profile, or fix the JSON manually."],
    });
  }

  let report: ArchitectReport | null = null;
  try {
    report = loadArchitectReport(cwd);
    if (!report) {
      items.push({
        status: "info",
        message: "No architect report generated yet.",
      });
    } else {
      items.push({
        status: report.confidence === "high" ? "ok" : "warning",
        message: `Architect report exists with ${report.confidence} confidence for ${report.selectedArchitecture}.`,
      });
    }
  } catch (err: any) {
    items.push({
      status: "error",
      message: `Invalid architect report at .pi/architect/architect-report.json: ${err.message}`,
      details: ["Run /senai-generate-architect to regenerate the report, or fix the JSON manually."],
    });
  }

  if (profile) {
    const agentsDir = path.join(cwd, ".pi", "agents");
    const expectedAgentNames = ARCHITECT_ROLES.map((role) => `${profile.projectSlug}-${profile.selectedArchitecture}-${role}`);
    const expectedAgentPaths = expectedAgentNames.map((name) => path.join(agentsDir, `${name}.md`));
    const missingAgents: string[] = [];
    for (const filePath of expectedAgentPaths) {
      if (!fs.existsSync(filePath)) {
        missingAgents.push(path.relative(cwd, filePath));
      }
    }

    const misnamedAgents: string[] = [];
    if (fs.existsSync(agentsDir)) {
      const prefix = `${profile.projectSlug}-${profile.selectedArchitecture}-`;
      for (const entry of fs.readdirSync(agentsDir)) {
        if (!entry.endsWith(".md")) continue;
        if (!entry.startsWith(prefix)) continue;
        const name = entry.slice(0, -3);
        if (!expectedAgentNames.includes(name)) {
          misnamedAgents.push(path.relative(cwd, path.join(agentsDir, entry)));
        }
      }
    }

    if (missingAgents.length === 0 && misnamedAgents.length === 0) {
      items.push({ status: "ok", message: `Found all ${expectedAgentNames.length} expected architecture agents in .pi/agents/.` });
    } else {
      if (missingAgents.length > 0) {
        items.push({
          status: "error",
          message: `${missingAgents.length} expected architecture agents are missing.`,
          details: missingAgents,
        });
      }
      if (misnamedAgents.length > 0) {
        items.push({
          status: "error",
          message: `${misnamedAgents.length} misnamed architecture agents found.`,
          details: misnamedAgents,
        });
      }
    }

    const skillsDir = path.join(cwd, ".pi", "skills");
    const expectedSkillNames = ARCHITECT_STAGES.map((stage) => `${profile.projectSlug}-${profile.selectedArchitecture}-${stage}`);
    const expectedSkillPaths = expectedSkillNames.map((name) => path.join(skillsDir, name, "SKILL.md"));
    const missingSkills: string[] = [];
    for (const filePath of expectedSkillPaths) {
      if (!fs.existsSync(filePath)) {
        missingSkills.push(path.relative(cwd, filePath));
      }
    }

    const misnamedSkills: string[] = [];
    if (fs.existsSync(skillsDir)) {
      const prefix = `${profile.projectSlug}-${profile.selectedArchitecture}-`;
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith(prefix)) continue;
        if (!expectedSkillNames.includes(entry.name)) {
          misnamedSkills.push(path.relative(cwd, path.join(skillsDir, entry.name)));
        }
      }
    }

    if (missingSkills.length === 0 && misnamedSkills.length === 0) {
      items.push({ status: "ok", message: `Found all ${expectedSkillNames.length} expected architecture skills in .pi/skills/.` });
    } else {
      if (missingSkills.length > 0) {
        items.push({
          status: "error",
          message: `${missingSkills.length} expected architecture skills are missing.`,
          details: missingSkills,
        });
      }
      if (misnamedSkills.length > 0) {
        items.push({
          status: "error",
          message: `${misnamedSkills.length} misnamed architecture skills found.`,
          details: misnamedSkills,
        });
      }
    }

    const architecturePath = path.join(architectStateDir, "architecture.md");
    if (fs.existsSync(architecturePath)) {
      items.push({ status: "ok", message: "architecture.md found in .pi/architect/." });
    } else {
      items.push({
        status: "error",
        message: "No architecture.md found in .pi/architect/.",
      });
    }

    if (report && report.adrs.length > 0) {
      const adrsDir = path.join(architectStateDir, "adrs");
      let foundAdrs = 0;
      let checkedAdrs = 0;
      for (const adr of report.adrs) {
        if (!adr || typeof adr.id !== "string" || typeof adr.title !== "string" || !adr.title.trim()) {
          continue;
        }
        checkedAdrs++;
        const adrPath = path.join(adrsDir, `${adr.id}-${slugify(adr.title)}.md`);
        if (fs.existsSync(adrPath)) {
          foundAdrs++;
        }
      }
      if (checkedAdrs === 0) {
        items.push({
          status: "warning",
          message: "Architect report contains ADRs, but none have a valid id and title.",
        });
      } else if (foundAdrs === checkedAdrs) {
        items.push({
          status: "ok",
          message: `Found all ${checkedAdrs} ADRs in .pi/architect/adrs/.`,
        });
      } else {
        items.push({
          status: "error",
          message: `Found ${foundAdrs} of ${checkedAdrs} expected ADRs in .pi/architect/adrs/.`,
        });
      }
    }
  }

  return { title: "Architecture setup", items };
}

// Roles that must resolve to the generated architecture agents once an
// architecture has been generated. scout-1 shares the generated planner agent.
// Role→suffix pairs come from ARCHITECTURE_AGENT_MAPPING (single source of
// truth in architect.ts); labels below are doctor-only display text.
const ARCHITECTURE_ROLE_LABELS: Record<string, string> = {
  "scout-1": "Scout Architecture",
  planner: "Architecture Planner",
  implementer: "Architecture Implementer",
  "reviewer-correctness": "Architecture Reviewer — Correctness",
  "reviewer-security": "Architecture Reviewer — Security",
  "reviewer-tests": "Architecture Reviewer — Tests",
  "code-review": "Architecture Code Review",
};

const ARCHITECTURE_MAPPED_ROLES: Array<{ role: SenaiRole; label: string; expectedSuffix: string }> =
  ARCHITECTURE_AGENT_MAPPING.map(({ role, suffix }) => ({
    role,
    label: ARCHITECTURE_ROLE_LABELS[role] ?? role,
    expectedSuffix: suffix,
  }));

function checkArchitectureAgentMapping(cwd: string, agentConfig: AgentConfig | null): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  let profile: ArchitectProfile | null = null;
  try {
    profile = loadArchitectProfile(cwd);
  } catch {
    // An invalid profile is already reported by the architecture setup section.
  }
  if (!profile) {
    items.push({
      status: "info",
      message: "No architecture generated yet. Mapping check skipped.",
      details: ["Run /senai-generate-architect to generate project-specific architecture agents."],
    });
    return { title: "Architecture agent mapping", items };
  }

  for (const { role, label, expectedSuffix } of ARCHITECTURE_MAPPED_ROLES) {
    const expected = `${profile.projectSlug}-${profile.selectedArchitecture}-${expectedSuffix}`;
    const actual = resolveAgentName(agentConfig, role);

    if (actual === expected) {
      items.push({ status: "ok", message: `${label} (${role}) → ${actual}: correctly mapped` });
    } else {
      items.push({
        status: "error",
        message: `${label} (${role}) is mapped to "${actual}" but the architecture factory generated "${expected}".`,
        details: [`Fix: re-run /senai-generate-architect to auto-map default or stale roles, or run /senai-configure-agents to map ${role} to ${expected} manually.`],
      });
    }
  }

  return { title: "Architecture agent mapping", items };
}

function checkGeneratedAgentContent(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  let profile: ArchitectProfile | null = null;
  try {
    profile = loadArchitectProfile(cwd);
  } catch {
    // An invalid profile is already reported by the architecture setup section.
  }
  if (!profile) {
    items.push({ status: "info", message: "No architecture generated yet. Content check skipped." });
    return { title: "Generated agent content", items };
  }

  const agentsDir = path.join(cwd, ".pi", "agents");
  const skillsDir = path.join(cwd, ".pi", "skills");

  for (const role of ARCHITECT_ROLES) {
    const agentName = `${profile.projectSlug}-${profile.selectedArchitecture}-${role}`;
    const filePath = path.join(agentsDir, `${agentName}.md`);
    if (!fs.existsSync(filePath)) continue; // Missing files are reported by the architecture setup section.

    const content = fs.readFileSync(filePath, "utf8");
    const problems: string[] = [];

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    if (!/^tools:/m.test(frontmatter)) {
      problems.push("frontmatter is missing a tools: line");
    }

    const skillsMatch = frontmatter.match(/^skills:(.*)$/m);
    if (!skillsMatch || !skillsMatch[1].trim()) {
      problems.push("frontmatter is missing a skills: line");
    } else {
      const skillNames = skillsMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const skillName of skillNames) {
        if (!fs.existsSync(path.join(skillsDir, skillName, "SKILL.md"))) {
          problems.push(`referenced skill "${skillName}" not found at .pi/skills/${skillName}/SKILL.md`);
        }
      }
    }

    if (!content.includes(".pi/architect/architecture.md")) {
      problems.push("body does not reference .pi/architect/architecture.md");
    }
    if (!content.includes("adrs/")) {
      problems.push("body does not reference ADRs in .pi/architect/adrs/");
    }
    if (!/^##\s+Forbidden patterns/im.test(content)) {
      problems.push("body is missing a '## Forbidden patterns' section");
    }

    if (problems.length === 0) {
      items.push({ status: "ok", message: `${agentName}: content complete` });
    } else {
      items.push({
        status: "error",
        message: `${agentName}: content is incomplete`,
        details: [...problems, "Fix: re-run /senai-generate-architect to regenerate the agent files."],
      });
    }
  }

  return { title: "Generated agent content", items };
}

function checkArchitectureDrift(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const manifest = loadGeneratedManifest(cwd);
  if (!manifest) {
    items.push({
      status: "info",
      message: "No generation manifest found. Drift check skipped.",
      details: [
        "This architecture was generated before drift tracking existed.",
        "Re-run /senai-generate-architect to enable drift detection.",
      ],
    });
    return { title: "Architecture drift", items };
  }

  const problems: DiagnosticItem[] = [];
  const slug = getProjectSlug(cwd);
  const teamAgentPaths = new Set(
    GENERATED_ROLES.map((def) => path.join(".pi", "agents", `${slug}-${def.role}.md`)),
  );
  // Advice differs per file type: the architecture factory only regenerates
  // architecture files; team agents are regenerated by the sub-agent command.
  const fixAdvice = (relPath: string): string =>
    teamAgentPaths.has(relPath)
      ? "If this was not intentional, re-run /senai-generate-sub-agents."
      : "If this was not intentional, re-run /senai-generate-architect.";
  for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
    const filePath = path.resolve(cwd, relPath);
    if (!fs.existsSync(filePath)) {
      problems.push({
        status: "warning",
        message: `Generated file was deleted: ${relPath}`,
        details: [fixAdvice(relPath)],
      });
      continue;
    }
    const actualHash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    if (actualHash !== expectedHash) {
      problems.push({
        status: "warning",
        message: `${relPath} was modified after generation.`,
        details: [fixAdvice(relPath)],
      });
    }
  }

  if (problems.length === 0) {
    items.push({
      status: "ok",
      message: `All ${Object.keys(manifest.files).length} generated files match the generation manifest.`,
    });
  } else {
    items.push(...problems);
  }

  return { title: "Architecture drift", items };
}

function checkGeneratedTeamContent(cwd: string, agentConfig: AgentConfig | null): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const slug = getProjectSlug(cwd);
  let found = 0;

  for (const def of GENERATED_ROLES) {
    const expectedName = `${slug}-${def.role}`;
    const actual = resolveAgentName(agentConfig, def.role as SenaiRole);
    if (actual !== expectedName) continue; // custom mapping — not a generated team agent

    const filePath = path.join(cwd, ".pi", "agents", `${expectedName}.md`);
    if (!fs.existsSync(filePath)) continue; // missing files are reported by the mapping sources section

    found++;
    const content = fs.readFileSync(filePath, "utf8");
    const problems: string[] = [];

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    if (!/^tools:/m.test(frontmatter)) {
      problems.push("frontmatter is missing a tools: line");
    }
    if (!content.includes("## Your mandate")) {
      problems.push("body is missing the '## Your mandate' section");
    }
    if (!content.includes("## Technology craft")) {
      problems.push("body is missing a '## Technology craft' section");
    }

    if (problems.length === 0) {
      if (!content.includes(`(generator v${GENERATOR_VERSION})`)) {
        items.push({
          status: "warning",
          message: `${expectedName}: generated by an older pi-senai version`,
          details: [
            "Re-run /senai-generate-sub-agents to update it in place.",
            "If you edited the file after generation, your edits are detected and kept.",
          ],
        });
      } else {
        items.push({ status: "ok", message: `${expectedName}: content complete` });
      }
    } else {
      items.push({
        status: "error",
        message: `${expectedName}: content is incomplete`,
        details: [...problems, "Fix: re-run /senai-generate-sub-agents to regenerate it."],
      });
    }
  }

  // Orphaned generated agents: carry the "Generated by pi-senai" marker but
  // no generated role maps to them (e.g. the role was remapped to a custom
  // or built-in agent). Reported only — deletion stays a user decision.
  const agentsDir = path.join(cwd, ".pi", "agents");
  if (fs.existsSync(agentsDir)) {
    const mappedNames = new Set(
      GENERATED_ROLES.map((def) => resolveAgentName(agentConfig, def.role as SenaiRole)),
    );
    for (const entry of fs.readdirSync(agentsDir)) {
      if (!entry.endsWith(".md")) continue;
      const name = entry.slice(0, -3);
      if (mappedNames.has(name)) continue;
      let orphanContent = "";
      try {
        orphanContent = fs.readFileSync(path.join(agentsDir, entry), "utf8");
      } catch {
        continue;
      }
      if (!orphanContent.includes("Generated by pi-senai")) continue;
      items.push({
        status: "info",
        message: `Orphaned generated agent: ${name}`,
        details: [
          "No Senai role maps to this file.",
          `If you do not need it, delete .pi/agents/${entry}.`,
        ],
      });
    }
  }

  if (found === 0) {
    items.push({
      status: "info",
      message: "No generated team agents found. Run /senai-generate-sub-agents to create them.",
    });
  }

  return { title: "Generated team agents", items };
}

function checkTechnologyResources(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const dirs: Array<{ dir: string; label: string }> = [
    { dir: getBundledTechnologiesDir(), label: "bundled" },
    { dir: getProjectTechnologiesDir(cwd), label: "project" },
  ];

  let bundledGenericFound = false;
  let resourceCount = 0;

  for (const { dir, label } of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".md") || entry === "_template.md") continue;
      const filePath = path.join(dir, entry);
      const problems: string[] = [];
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
        const id = String(frontmatter.id ?? "").trim();
        if (!id) problems.push("frontmatter is missing an id");
        const keywords = parseKeywords(frontmatter.keywords);
        const hasKeywords = keywords.length > 0;
        if (!hasKeywords) problems.push("frontmatter has no keywords (matching will never find it)");
        const normalizeKey = (s: string) => s.toLowerCase().replace(/[-\s]+/g, " ").trim();
        if (id && hasKeywords && !keywords.some((k) => normalizeKey(k) === normalizeKey(id))) {
          problems.push(`keywords do not include the resource id "${id}" (matching by name will miss it)`);
        }
        const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
        if (!body) problems.push("body is empty");

        // Technical validation: craft sections and sourcing.
        if (body) {
          const missingSections: string[] = [];
          if (!/^##\s+Core rules/im.test(body)) missingSections.push("## Core rules");
          if (!/^##\s+Testing patterns/im.test(body)) missingSections.push("## Testing patterns");
          if (!/^##\s+(Tooling and limits|Common mistakes)/im.test(body)) {
            missingSections.push("## Tooling and limits or ## Common mistakes");
          }
          if (missingSections.length > 0) {
            problems.push(`missing template section(s): ${missingSections.join(", ")}`);
          }
          if (id !== "generic" && !/https?:\/\//.test(body)) {
            problems.push("no official source URL cited (sourcing rule)");
          }
        }

        if (label === "bundled" && id === "generic" && problems.length === 0) {
          bundledGenericFound = true;
        }
      } catch {
        problems.push("file could not be parsed");
      }

      if (problems.length === 0) {
        resourceCount++;
      } else {
        items.push({
          status: "warning",
          message: `${label} resource ${entry} has problems`,
          details: problems,
        });
      }
    }
  }

  if (!bundledGenericFound) {
    items.push({
      status: "error",
      message: "The bundled generic.md fallback resource is missing or invalid.",
      details: ["Restore resources/technologies/generic.md in the extension."],
    });
  }

  if (resourceCount > 0) {
    items.push({ status: "ok", message: `${resourceCount} technology resource(s) valid.` });
  }

  return { title: "Technology resources", items };
}

function resolveSkillFile(cwd: string, skillName: string): string | null {
  const candidates = [
    path.join(cwd, ".pi", "skills", skillName, "SKILL.md"),
    path.join(getAgentDir(), "skills", skillName, "SKILL.md"),
    path.resolve(getBundledTechnologiesDir(), "..", "..", "skills", `${skillName}.md`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function validateSkillFile(filePath: string): string[] {
  const problems: string[] = [];
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
    if (!String(frontmatter.name ?? "").trim()) problems.push("SKILL.md frontmatter is missing a name");
    if (!String(frontmatter.description ?? "").trim()) problems.push("SKILL.md frontmatter is missing a description");
    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
    if (!body) problems.push("SKILL.md body is empty");
  } catch {
    problems.push("SKILL.md could not be parsed");
  }
  return problems;
}

function checkAgentSkillReferences(
  cwd: string,
  resolved: Record<SenaiRole, ResolvedAgent>,
): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  let checked = 0;

  for (const role of SENAI_ROLES) {
    const agent = resolved[role];
    if (!agent.frontmatter || !agent.frontmatter.skills || agent.frontmatter.skills.length === 0) continue;

    for (const skillName of agent.frontmatter.skills) {
      checked++;
      const skillPath = resolveSkillFile(cwd, skillName);
      if (!skillPath) {
        items.push({
          status: "error",
          message: `${agent.name} (${role}) references missing skill "${skillName}"`,
          details: [
            `No SKILL.md found in .pi/skills/, the user skills dir, or the bundled skills.`,
            `Create the skill or remove it from the agent's skills: line.`,
          ],
        });
        continue;
      }
      const problems = validateSkillFile(skillPath);
      if (problems.length > 0) {
        items.push({
          status: "warning",
          message: `${agent.name} (${role}) references invalid skill "${skillName}"`,
          details: problems.map((p) => `${skillPath}: ${p}`),
        });
      }
    }
  }

  if (items.length === 0) {
    items.push({
      status: checked === 0 ? "info" : "ok",
      message: checked === 0 ? "No agents reference skills." : `All ${checked} skill reference(s) are valid.`,
    });
  }

  return { title: "Agent skill references", items };
}

const KNOWN_TOOL_NAMES = new Set([
  "read", "write", "edit", "bash", "grep", "find", "ls",
  "askuserquestion", "intercom", "subagent",
  "taskcreate", "taskexecute", "taskget", "tasklist", "taskoutput", "taskstop", "taskupdate",
]);

function isKnownToolName(tool: string): boolean {
  if (tool.startsWith("ext:")) return tool.length > 4;
  return KNOWN_TOOL_NAMES.has(tool.toLowerCase());
}

const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function checkAgentFileIntegrity(
  cwd: string,
  resolved: Record<SenaiRole, ResolvedAgent>,
): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  for (const role of SENAI_ROLES) {
    const agent = resolved[role];
    if (!agent.filePath || !agent.frontmatter) continue; // built-ins and missing agents are covered elsewhere

    const problems: Array<{ status: DiagnosticStatus; text: string }> = [];
    const fileName = path.basename(agent.filePath, ".md");
    const content = fs.readFileSync(agent.filePath, "utf8");

    if (agent.frontmatter.name !== fileName) {
      problems.push({
        status: "error",
        text: `frontmatter name "${agent.frontmatter.name}" does not match the filename "${fileName}"`,
      });
    }

    const tools = agent.frontmatter.tools ?? [];
    const unknownTools = tools.filter((t) => !isKnownToolName(t));
    if (unknownTools.length > 0) {
      problems.push({ status: "error", text: `unknown tool name(s): ${unknownTools.join(", ")} (typo?)` });
    }

    const thinking = agent.frontmatter.thinking;
    if (thinking && !VALID_THINKING_LEVELS.has(thinking.toLowerCase())) {
      problems.push({ status: "warning", text: `unknown thinking level "${thinking}"` });
    }

    if (agent.frontmatter.model) {
      problems.push({
        status: "warning",
        text: `frontmatter pins model "${agent.frontmatter.model}" — subagent will not inherit pi's default model; remove the model field unless intentional`,
      });
    }

    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
    if (!body) {
      problems.push({ status: "error", text: "agent body is empty — no instructions" });
    }

    if (problems.length === 0) continue;
    items.push({
      status: problems.some((p) => p.status === "error") ? "error" : "warning",
      message: `${agent.name} (${role}) at ${path.relative(cwd, agent.filePath)}`,
      details: problems.map((p) => p.text),
    });
  }

  if (items.length === 0) {
    items.push({ status: "ok", message: "All mapped agent files are internally valid." });
  }

  return { title: "Agent file integrity", items };
}

const SECRET_PATTERNS: RegExp[] = [
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/i,
  /secret\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/i,
  /password\s*[:=]\s*["']?[^\s"']{6,}/i,
  /token\s*[:=]\s*["']?[A-Za-z0-9_\-.]{10,}/i,
  /BEGIN [A-Z]+ PRIVATE KEY/,
  /sk-[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z_\-]{20,}/,
];

function checkSecretScan(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const filesToScan: string[] = [];

  const agentsDir = path.join(cwd, ".pi", "agents");
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir)) {
      if (entry.endsWith(".md")) filesToScan.push(path.join(agentsDir, entry));
    }
  }
  const skillsDir = path.join(cwd, ".pi", "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
      if (fs.existsSync(skillPath)) filesToScan.push(skillPath);
    }
  }
  const senaiDir = path.join(cwd, ".pi", "senai");
  if (fs.existsSync(senaiDir)) {
    for (const entry of fs.readdirSync(senaiDir)) {
      if (entry.endsWith(".json")) filesToScan.push(path.join(senaiDir, entry));
    }
  }

  for (const filePath of filesToScan) {
    let lines: string[];
    try {
      lines = fs.readFileSync(filePath, "utf8").split("\n");
    } catch {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      if (SECRET_PATTERNS.some((pattern) => pattern.test(lines[i]))) {
        items.push({
          status: "warning",
          message: `Possible secret at ${path.relative(cwd, filePath)}:${i + 1}`,
          details: ["Move secrets to environment variables. Never commit them."],
        });
      }
    }
  }

  if (items.length === 0) {
    items.push({ status: "ok", message: `No secrets found in ${filesToScan.length} scanned file(s).` });
  }

  return { title: "Secret scan", items };
}

interface DocsStructureManifestTarget {
  path: string;
  docType: string;
  maxLines: number;
}

/** Doc factory checks:
 *  1. For each manifest target that is filled (no longer a stub): validate the
 *     template's required sections are present, in order, and the file is
 *     within its length cap. Over cap or missing section → warning naming the
 *     file, the count/section, and the cap.
 *  2. Missing skeleton stubs → warning; unexpected non-stub files in
 *     factory-owned subfolders → info. */
function checkDocsFactory(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const manifestPath = path.join(cwd, ".pi", "senai", "docs-structure.json");
  if (!fs.existsSync(manifestPath)) {
    items.push({
      status: "info",
      message: "No docs skeleton generated.",
      details: [
        "Run /senai-generate-docs-structure to create the docs folder skeleton and template stubs for the selected document types.",
      ],
    });
    return { title: "Documentation factory", items };
  }

  let targets: DocsStructureManifestTarget[];
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const rawTargets = Array.isArray(parsed.targets) ? parsed.targets : [];
    targets = rawTargets
      .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
      .map((t) => ({
        path: String(t.path ?? ""),
        docType: String(t.docType ?? ""),
        maxLines: typeof t.maxLines === "number" ? t.maxLines : 0,
      }))
      .filter((t) => t.path.length > 0);
  } catch (err: any) {
    items.push({
      status: "warning",
      message: `Docs structure manifest is corrupt: ${err.message}`,
      details: ["Fix: re-run /senai-generate-docs-structure to rewrite .pi/senai/docs-structure.json."],
    });
    return { title: "Documentation factory", items };
  }

  const manifestPaths = new Set(targets.map((t) => t.path));

  for (const target of targets) {
    const fullPath = path.join(cwd, target.path);
    if (!fs.existsSync(fullPath)) {
      items.push({
        status: "warning",
        message: `Skeleton doc missing: ${target.path}`,
        details: [
          "The docs skeleton was generated but this stub was deleted.",
          "Fix: re-run /senai-generate-docs-structure.",
        ],
      });
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    if (isDocStub(content)) continue; // unfilled stub: nothing to validate yet
    const spec = target.docType in DOC_TYPES ? DOC_TYPES[target.docType as DocTypeId] : undefined;
    if (!spec) continue;
    const lines = content.split("\n");
    if (lines.length > spec.maxLines) {
      items.push({
        status: "warning",
        message: `${target.path} is ${lines.length} lines — over the ${spec.maxLines}-line cap (${spec.basedOn}).`,
        details: [
          "The doc factory keeps docs short and cheap in tokens. Trim to the cap; move detail into a linked page of the same type.",
        ],
      });
    }
    let cursor = -1;
    for (const section of spec.requiredSections) {
      const idx = lines.findIndex((l, i) => i > cursor && l.trim() === section);
      if (idx === -1) {
        items.push({
          status: "warning",
          message: `${target.path} is missing required section "${section}" (template: ${spec.id}).`,
          details: [`Template ${spec.id} requires, in order: ${spec.requiredSections.join(", ")}.`],
        });
      } else {
        cursor = idx;
      }
    }
  }

  const factoryDirs = ["docs/tutorials", "docs/how-to", "docs/reference", "docs/explanation", "docs/adr"];
  const stray: string[] = [];
  for (const dir of factoryDirs) {
    const fullDir = path.join(cwd, dir);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(fullDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const rel = `${dir}/${entry}`;
      if (manifestPaths.has(rel)) continue;
      let content = "";
      try {
        content = fs.readFileSync(path.join(fullDir, entry), "utf8");
      } catch {
        continue;
      }
      if (!isDocStub(content)) stray.push(rel);
    }
  }
  if (stray.length > 0) {
    items.push({
      status: "info",
      message: `${stray.length} file(s) in factory docs folders are not part of the generated skeleton.`,
      details: [
        ...stray,
        "Not an error — your own docs are fine here. Regenerate the skeleton if they should be factory-managed.",
      ],
    });
  }

  if (items.length === 0) {
    items.push({
      status: "ok",
      message: `Docs skeleton intact (${targets.length} target(s)); all filled docs within template and length limits.`,
    });
  }

  return { title: "Documentation factory", items };
}

export function formatDiagnosticReport(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push("# Pi Senai Diagnostic Report");
  lines.push("");
  lines.push(
    `Summary: ${report.summary.ok} OK, ${report.summary.warning} warnings, ${report.summary.error} errors, ${report.summary.info} info`,
  );
  lines.push("");
  lines.push(report.ok ? "✅ Configuration looks good." : "❌ Please fix the errors above before running Senai stages.");
  lines.push("");

  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    for (const item of section.items) {
      const icon =
        item.status === "ok"
          ? "✅"
          : item.status === "warning"
            ? "⚠️"
            : item.status === "error"
              ? "❌"
              : "ℹ️";
      lines.push(`${icon} ${item.message}`);
      if (item.details) {
        for (const detail of item.details) {
          lines.push(`   - ${detail}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Discussion checks:
 *  1. For each run directory containing a discussions/ folder, validate that
 *     exactly one discussion transcript subfolder is active — multiple active
 *     subfolders → warning naming the run id.
 *  2. For every existing mission-brief.md (pre-run and per-run), validate
 *     that all REQUIRED_BRIEF_SECTIONS are present, in order. Missing
 *     sections → warning naming the file and the missing section.
 *  3. Orphan pre-run discussion folder with no mission-brief.md → info
 *     (the user started a discussion but never wrote the brief). */
function checkDiscussions(cwd: string): DiagnosticSection {
  const title = "Discussions";
  const items: DiagnosticItem[] = [];

  // Per-run folders
  const runsRoot = path.join(cwd, ".IDE_Plans/senai/runs");
  let runDirs: string[] = [];
  try {
    runDirs = fs.readdirSync(runsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(runsRoot, e.name));
  } catch {
    runDirs = [];
  }

  for (const runDir of runDirs) {
    const discussionsDir = path.join(runDir, "discussions");
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(discussionsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      entries = [];
    }
    // Active folders = directories whose name starts with "discussion-".
    const active = entries.filter((n) => /^discussion-/.test(n));
    if (active.length > 1) {
      items.push({
        status: "warning",
        message: `Run ${path.basename(runDir)} has ${active.length} active discussion folders`,
        details: [
          ...active.map((a) => `  ${a}`),
          "Multiple active discussions on one run usually means a stale parent left a folder open. Archive the older ones.",
        ],
      });
    }

    const briefPath = path.join(runDir, "mission-brief.md");
    if (fs.existsSync(briefPath)) {
      const brief = fs.readFileSync(briefPath, "utf8");
      const missing = validateBriefSections(brief);
      if (missing.length > 0) {
        items.push({
          status: "warning",
          message: `Mission brief in run ${path.basename(runDir)} is missing ${missing.length} required section(s)`,
          details: [...missing.map((m) => `  ${m}`), "Run /senai-discussion to add the missing sections."],
        });
      }
    }
  }

  // Pre-run folder
  const preRunDir = path.join(cwd, ".IDE_Plans/senai/discussions/pre-run");
  let preRunEntries: string[] = [];
  try {
    preRunEntries = fs.readdirSync(preRunDir);
  } catch {
    preRunEntries = [];
  }

  const preRunHasBrief = fs.existsSync(path.join(preRunDir, "mission-brief.md"));
  const preRunHasTranscripts = preRunEntries.some((n) => /^discussion-\d{2}-/.test(n));

  if (preRunHasTranscripts && !preRunHasBrief) {
    items.push({
      status: "info",
      message: "Pre-run discussions exist but no mission-brief.md was written.",
      details: ["Run /senai-discussion-approve to finalize the brief, or delete the orphan transcripts."],
    });
  }

  if (preRunHasBrief) {
    const brief = fs.readFileSync(path.join(preRunDir, "mission-brief.md"), "utf8");
    const missing = validateBriefSections(brief);
    if (missing.length > 0) {
      items.push({
        status: "warning",
        message: `Pre-run mission brief is missing ${missing.length} required section(s)`,
        details: [...missing.map((m) => `  ${m}`), "Run /senai-discussion to add the missing sections."],
      });
    }
  }

  if (items.length === 0) {
    items.push({ status: "ok", message: "No discussion artifacts to validate (or all valid)." });
  }

  return { title, items };
}
