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
  SENAI_ROLES,
  ROLE_LABELS,
  type SenaiRole,
} from "./agent-suggestions.js";
import { loadArchitectInputsConfig } from "./architect-inputs-config.js";
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
import { getArchitectStateDir } from "./constants.js";
import {
  GENERATED_ROLES,
  getBundledTechnologiesDir,
  getProjectSlug,
  getProjectTechnologiesDir,
  parseKeywords,
} from "./agent-generator.js";

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

interface ResolvedAgent {
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

const READONLY_ROLES: SenaiRole[] = [
  "scout-2",
  "scout-3",
  "scout-4",
  "discussion",
  "plan-overview",
  "security-gate",
];

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

  sections.push(checkConfigFiles(cwd, agentConfig, filesConfig, agentsFilesConfig, filesConfigError, agentConfigError, agentsFilesConfigError));

  const resolvedAgents = resolveAllAgents(cwd, agentConfig);
  sections.push(checkAgentMappings(resolvedAgents));
  sections.push(checkAgentCapabilities(resolvedAgents));

  if (filesConfig) {
    sections.push(checkFileScope(cwd, filesConfig));
  }

  if (agentsFilesConfig) {
    sections.push(checkAgentsFiles(cwd, agentsFilesConfig, filesConfig));
  }

  sections.push(checkEnvironment());
  sections.push(checkArchitectureSetup(cwd));
  sections.push(checkArchitectureAgentMapping(cwd, agentConfig));
  sections.push(checkGeneratedAgentContent(cwd));
  sections.push(checkArchitectureDrift(cwd));
  sections.push(checkGeneratedTeamContent(cwd, agentConfig));
  sections.push(checkTechnologyResources(cwd));
  sections.push(checkAgentSkillReferences(cwd, resolvedAgents));
  sections.push(checkAgentFileIntegrity(cwd, resolvedAgents));
  sections.push(checkSecretScan(cwd));

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
      details: ["Run /senai-configure-agents to create it."],
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

  return { title: "Agent mapping sources", items };
}

function checkAgentCapabilities(resolved: Record<SenaiRole, ResolvedAgent>): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  for (const role of SENAI_ROLES) {
    const agent = resolved[role];
    const label = ROLE_LABELS[role];

    // Default mappings and built-ins are the documented pre-generation
    // fallback (Pi ships its planner/scout/reviewer agents read-only by
    // design; the main session compensates writes). Capability checks apply
    // to custom-mapped agents only.
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

  return { title: "Runtime environment", items };
}

function isPathConflict(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.endsWith("/") && b.startsWith(a)) return true;
  if (b.endsWith("/") && a.startsWith(b)) return true;
  return false;
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

  const inputsConfig = loadArchitectInputsConfig(cwd);
  if (!inputsConfig) {
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
        details: [`Fix: run /senai-configure-agents and map ${role} to ${expected}.`],
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
  for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
    const filePath = path.resolve(cwd, relPath);
    if (!fs.existsSync(filePath)) {
      problems.push({
        status: "warning",
        message: `Generated file was deleted: ${relPath}`,
        details: ["If this was not intentional, re-run /senai-generate-architect."],
      });
      continue;
    }
    const actualHash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    if (actualHash !== expectedHash) {
      problems.push({
        status: "warning",
        message: `${relPath} was modified after generation.`,
        details: ["If this was not intentional, re-run /senai-generate-architect."],
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
      items.push({ status: "ok", message: `${expectedName}: content complete` });
    } else {
      items.push({
        status: "error",
        message: `${expectedName}: content is incomplete`,
        details: [...problems, "Fix: delete the file and re-run /senai-generate-sub-agents."],
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
