import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";

// Types and the pure path helper live in core/agents-config/ (Layer 0).
// Re-exported here for backwards compatibility with existing call sites
// that import them from agents/discovery.js.
import {
  getUserAgentsDir,
  type AgentSource,
  type DiscoveredAgent,
} from "../core/agents-config/discovery.js";
export { getUserAgentsDir, type AgentSource, type DiscoveredAgent };

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];
  const seen = new Set<string>();

  // Project agents (highest priority)
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  if (projectAgentsDir) {
    for (const agent of loadAgentsFromDir(projectAgentsDir, "project")) {
      if (!seen.has(agent.name)) {
        agents.push(agent);
        seen.add(agent.name);
      }
    }
  }

  // User/global agents
  const userDir = getUserAgentsDir();
  for (const agent of loadAgentsFromDir(userDir, "user")) {
    if (!seen.has(agent.name)) {
      agents.push(agent);
      seen.add(agent.name);
    }
  }

  // Built-in defaults
  for (const name of ["scout", "planner", "worker", "reviewer", "security-auditor"]) {
    if (!seen.has(name)) {
      agents.push({ name, description: `Built-in ${name} agent`, source: "builtin" });
    }
  }

  return agents;
}

function loadAgentsFromDir(dir: string, source: "project" | "user"): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];
  if (!fs.existsSync(dir)) return agents;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    const parsed = parseAgentFile(filePath);
    if (parsed) {
      agents.push({ ...parsed, source });
    }
  }

  return agents;
}

export interface AgentFrontmatter {
  name: string;
  description: string;
  filePath: string;
  tools?: string[];
  output?: string;
  skills?: string[];
  maxSubagentDepth?: number;
  thinking?: string;
  model?: string;
}

export function parseAgentFile(
  filePath: string,
): { name: string; description: string; filePath: string } | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const { frontmatter } = parseFrontmatter<Record<string, string>>(content);
    const name = frontmatter.name?.trim();
    const description = frontmatter.description?.trim();
    if (!name || !description) return undefined;
    return { name, description, filePath };
  } catch {
    return undefined;
  }
}

export function parseAgentFileFull(filePath: string): AgentFrontmatter | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
    const name = String(frontmatter.name ?? "").trim();
    const description = String(frontmatter.description ?? "").trim();
    if (!name || !description) return undefined;

    const tools = parseStringArray(frontmatter.tools);
    const skills = parseStringArray(frontmatter.skills);
    const output = frontmatter.output ? String(frontmatter.output) : undefined;
    const thinking = frontmatter.thinking ? String(frontmatter.thinking) : undefined;
    const model = frontmatter.model ? String(frontmatter.model) : undefined;
    const maxSubagentDepth =
      typeof frontmatter.maxSubagentDepth === "number"
        ? frontmatter.maxSubagentDepth
        : undefined;

    return { name, description, filePath, tools, output, skills, maxSubagentDepth, thinking, model };
  } catch {
    return undefined;
  }
}

function parseStringArray(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean);
  }
  return undefined;
}
