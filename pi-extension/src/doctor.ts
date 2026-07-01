import * as fs from "node:fs";
import * as path from "node:path";
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
  ORCHESTRA_ROLES,
  ROLE_LABELS,
  type OrchestraRole,
} from "./agent-suggestions.js";

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

const ROLE_REQUIRED_TOOLS: Partial<Record<OrchestraRole, string[]>> = {
  "scout-1": ["read"],
  "scout-2": ["read"],
  "scout-3": ["read"],
  "scout-4": ["read"],
  discussion: ["read"],
  planner: ["read"],
  "plan-overview": ["read"],
  "reviewer-correctness": ["read"],
  "reviewer-security": ["read"],
  "reviewer-tests": ["read"],
  "test-skeleton": ["read", "write"],
  implementer: ["read", "write", "edit"],
  linter: ["read", "bash"],
  "code-review": ["read"],
  "full-test": ["read", "bash"],
  "readme-writer": ["read", "write"],
  "changelog-writer": ["read", "write"],
  "api-docs-writer": ["read", "write"],
  "other-docs-writer": ["read", "write"],
  "security-gate": ["read"],
  archive: ["read", "write", "bash"],
};

const READONLY_ROLES: OrchestraRole[] = [
  "scout-1",
  "scout-2",
  "scout-3",
  "scout-4",
  "discussion",
  "planner",
  "plan-overview",
  "reviewer-correctness",
  "reviewer-security",
  "reviewer-tests",
  "code-review",
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

export function runOrchestraDiagnostic(cwd: string): DiagnosticReport {
  const sections: DiagnosticSection[] = [];

  const agentConfig = loadAgentConfig(cwd);
  const filesConfig = loadFilesConfig(cwd);
  const agentsFilesConfig = loadAgentsFilesConfig(cwd);

  sections.push(checkConfigFiles(cwd, agentConfig, filesConfig, agentsFilesConfig));

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
): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const agentPath = path.join(cwd, ".pi", "orchestra", "agents.json");
  if (agentConfig) {
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
      details: ["Run /orchestra-configure-agents to create it."],
    });
  }

  const filesPath = path.join(cwd, ".pi", "orchestra", "files.json");
  if (filesConfig) {
    items.push({ status: "ok", message: `files.json found and valid at ${filesPath}` });
    if (filesConfig.version !== 2) {
      items.push({
        status: "warning",
        message: `files.json version is ${filesConfig.version}; expected 2`,
      });
    }
  } else {
    items.push({
      status: "error",
      message: `files.json missing or invalid at ${filesPath}`,
      details: ["Run /orchestra-configure-files to create it."],
    });
  }

  const agentsFilesPath = path.join(cwd, ".pi", "orchestra", "agents_files.json");
  if (agentsFilesConfig) {
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
      details: ["Run /orchestra-configure-agents-files to create it."],
    });
  }

  return { title: "Configuration files", items };
}

function resolveAllAgents(
  cwd: string,
  agentConfig: AgentConfig | null,
): Record<OrchestraRole, ResolvedAgent> {
  const result = {} as Record<OrchestraRole, ResolvedAgent>;

  const projectDir = findNearestProjectAgentsDir(cwd);
  const userDir = getUserAgentsDir();

  for (const role of ORCHESTRA_ROLES) {
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

function checkAgentMappings(resolved: Record<OrchestraRole, ResolvedAgent>): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  for (const role of ORCHESTRA_ROLES) {
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

function checkAgentCapabilities(resolved: Record<OrchestraRole, ResolvedAgent>): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  for (const role of ORCHESTRA_ROLES) {
    const agent = resolved[role];
    const label = ROLE_LABELS[role];

    if (agent.source === "not found" || !agent.frontmatter) continue;

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
          "The agent may write to its preferred output path instead of the Orchestra artifact path.",
          "Make sure the agent task explicitly overrides this with the Orchestra artifact path.",
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

  for (const role of ORCHESTRA_ROLES) {
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
        "Start Pi inside tmux or Zellij before running Orchestra stages.",
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

export function formatDiagnosticReport(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push("# Pi Orchestra Diagnostic Report");
  lines.push("");
  lines.push(
    `Summary: ${report.summary.ok} OK, ${report.summary.warning} warnings, ${report.summary.error} errors, ${report.summary.info} info`,
  );
  lines.push("");
  lines.push(report.ok ? "✅ Configuration looks good." : "❌ Please fix the errors above before running Orchestra stages.");
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
