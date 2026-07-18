import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { addToGeneratedManifest, loadArchitectReport, slugify, type ArchitectReport } from "./architect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GeneratedRoleDef {
  role: string;
  label: string;
  tools: string[];
  mandate: string;
}

// The 14 non-architecture Senai roles. The 7 architecture-bound roles are
// owned by the architecture factory and are never generated here.
export const GENERATED_ROLES: GeneratedRoleDef[] = [
  { role: "scout-2", label: "Scout 2 — Code Search", tools: ["read"], mandate: "Search the codebase and report relevant code locations, existing implementations, and reusable patterns." },
  { role: "scout-3", label: "Scout 3 — Code Risk / Dependency Audit", tools: ["read"], mandate: "Audit code risks, fragile areas, and dependency health before planning." },
  { role: "scout-4", label: "Scout 4 — PRD / Documentation Audit", tools: ["read"], mandate: "Audit requirements and documentation coverage against the mission." },
  { role: "discussion", label: "Discussion", tools: ["read"], mandate: "Interview the user, consolidate scout findings, and record decisions in discussion notes." },
  { role: "plan-overview", label: "Plan Overview", tools: ["read"], mandate: "Write the user-friendly plan overview: mission, approach, key decisions, and expected outcome." },
  { role: "test-skeleton", label: "Test Skeleton", tools: ["read", "write"], mandate: "Write failing test skeletons derived from the approved plan before implementation starts." },
  { role: "linter", label: "Linter", tools: ["read", "bash"], mandate: "Run the project's linters and report violations with file and line references." },
  { role: "full-test", label: "Full Test", tools: ["read", "bash"], mandate: "Run the full test suite and report failures with exact error output." },
  { role: "readme-writer", label: "README Writer", tools: ["read", "write"], mandate: "Update the README so it matches what was actually built." },
  { role: "changelog-writer", label: "Changelog Writer", tools: ["read", "write"], mandate: "Update the CHANGELOG with the changes made in this run." },
  { role: "api-docs-writer", label: "API Docs Writer", tools: ["read", "write"], mandate: "Update API documentation to match the implemented interfaces." },
  { role: "other-docs-writer", label: "Other Docs Writer", tools: ["read", "write"], mandate: "Update the remaining project docs (guides, design docs) to match the implementation." },
  { role: "security-gate", label: "Security Gate", tools: ["read"], mandate: "Run the final security audit and write the security report." },
  { role: "archive", label: "Archive", tools: ["read", "write", "bash"], mandate: "Archive run artifacts and keep the run directory tidy." },
];

export interface TechnologyResource {
  id: string;
  name: string;
  keywords: string[];
  body: string;
  source: "bundle" | "project";
}

export interface GeneratedAgentPlan {
  role: string;
  agentName: string;
  description: string;
  tools: string[];
  content: string;
}

export interface WriteAgentsResult {
  created: string[];
  skipped: string[];
}

export function getBundledTechnologiesDir(): string {
  // resources/ is at repo root. Source layout: pi-extension/src is directly under repo root.
  // Dist layout: pi-extension/src is under dist/. Check both so the function works in both.
  const sourceLayout = path.resolve(__dirname, "../..", "resources", "technologies");
  if (fs.existsSync(path.join(sourceLayout, "generic.md"))) {
    return sourceLayout;
  }
  return path.resolve(__dirname, "../../..", "resources", "technologies");
}

export function getProjectTechnologiesDir(cwd: string): string {
  return path.join(cwd, ".pi", "technologies");
}

function parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function loadResourcesFromDir(dir: string, source: TechnologyResource["source"]): TechnologyResource[] {
  if (!fs.existsSync(dir)) return [];
  const resources: TechnologyResource[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md") || entry === "_template.md") continue;
    const filePath = path.join(dir, entry);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
      const id = String(frontmatter.id ?? "").trim() || entry.slice(0, -3);
      const name = String(frontmatter.name ?? "").trim() || id;
      const keywords = parseKeywords(frontmatter.keywords);
      const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
      if (!body) continue;
      resources.push({ id, name, keywords, body, source });
    } catch {
      // Skip unreadable resource files.
    }
  }
  return resources;
}

// Bundled resources ship with the extension; a project can add or override
// them in .pi/technologies/ (project wins on matching id).
export function discoverTechnologyResources(cwd: string): TechnologyResource[] {
  const bundled = loadResourcesFromDir(getBundledTechnologiesDir(), "bundle");
  const project = loadResourcesFromDir(getProjectTechnologiesDir(cwd), "project");
  const projectIds = new Set(project.map((r) => r.id));
  return [...bundled.filter((r) => !projectIds.has(r.id)), ...project];
}

// Scores resources by keyword hits against the stack hints. Returns matched
// resources ordered by score; falls back to the "generic" resource when
// nothing matches, so generation never dead-ends.
export function matchTechnologies(stackHints: string[], resources: TechnologyResource[]): TechnologyResource[] {
  const haystack = stackHints.join(" ").toLowerCase();
  const scored = resources
    .filter((r) => r.id !== "generic" && r.id !== "_template")
    .map((r) => ({
      resource: r,
      score: r.keywords.reduce((acc, keyword) => (keyword && haystack.includes(keyword) ? acc + 1 : acc), 0),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return scored.map((s) => s.resource);
  }
  const generic = resources.find((r) => r.id === "generic");
  return generic ? [generic] : [];
}

export function getProjectSlug(cwd: string): string {
  const pkgPath = path.join(cwd, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
    if (typeof pkg.name === "string" && pkg.name.trim()) {
      return slugify(pkg.name);
    }
  } catch {
    // Fall through to the folder name.
  }
  return slugify(path.basename(cwd));
}

function buildProjectContextBlock(report: ArchitectReport | null): string {
  if (!report) return "";
  const lines: string[] = ["## Project context", ""];
  if (report.techStack.length > 0) {
    lines.push("Technology stack:");
    for (const tech of report.techStack) lines.push(`- ${tech}`);
    lines.push("");
  }
  if (report.atomicFunctions.length > 0) {
    lines.push("Key functions in this project:");
    for (const fn of report.atomicFunctions) lines.push(`- ${fn}`);
    lines.push("");
  }
  if (report.constraints.length > 0) {
    lines.push("Constraints you must respect:");
    for (const constraint of report.constraints) lines.push(`- ${constraint}`);
  }
  return lines.join("\n").trim();
}

export function buildGeneratedAgentMarkdown(
  def: GeneratedRoleDef,
  agentName: string,
  projectName: string,
  resources: TechnologyResource[],
  report: ArchitectReport | null,
): string {
  const lines = [
    "---",
    `name: ${agentName}`,
    `description: ${def.label} for ${projectName}. Generated by pi-senai.`,
    `tools: ${def.tools.join(", ")}`,
    "---",
    "",
    `# ${agentName}`,
    "",
    `You are the ${def.label} for the ${projectName} project.`,
    "",
    "## Your mandate",
    "",
    `- ${def.mandate}`,
    "- Report results with exact file paths and evidence. Do not modify anything outside your mandate.",
  ];

  const contextBlock = buildProjectContextBlock(report);
  if (contextBlock) {
    lines.push("", contextBlock);
  }

  for (const resource of resources) {
    lines.push("", `## Technology craft (${resource.name})`, "", resource.body);
  }

  const resourceIds = resources.map((r) => `\`${r.id}\``).join(", ");
  lines.push("", `---`, `_Generated by pi-senai from technology resource(s): ${resourceIds}._`);

  return lines.join("\n");
}

export function planAgentGeneration(
  cwd: string,
  roles: GeneratedRoleDef[],
  resources: TechnologyResource[],
  report: ArchitectReport | null,
): GeneratedAgentPlan[] {
  const slug = getProjectSlug(cwd);
  const projectName = slug;
  return roles.map((def) => {
    const agentName = `${slug}-${def.role}`;
    return {
      role: def.role,
      agentName,
      description: `${def.label} for ${projectName}. Generated by pi-senai.`,
      tools: def.tools,
      content: buildGeneratedAgentMarkdown(def, agentName, projectName, resources, report),
    };
  });
}

// Writes agent files into .pi/agents/. Existing files are NEVER overwritten —
// they are reported as skipped so the user keeps their own custom agents.
// Created files are added to the generation manifest for drift tracking.
export function writeGeneratedAgents(cwd: string, plans: GeneratedAgentPlan[]): WriteAgentsResult {
  const agentsDir = path.join(cwd, ".pi", "agents");
  fs.mkdirSync(agentsDir, { recursive: true });

  const created: string[] = [];
  const skipped: string[] = [];
  const createdAbsolute: string[] = [];
  for (const plan of plans) {
    const filePath = path.join(agentsDir, `${plan.agentName}.md`);
    if (fs.existsSync(filePath)) {
      skipped.push(path.relative(cwd, filePath));
      continue;
    }
    fs.writeFileSync(filePath, plan.content, "utf8");
    created.push(path.relative(cwd, filePath));
    createdAbsolute.push(filePath);
  }
  if (createdAbsolute.length > 0) {
    addToGeneratedManifest(cwd, createdAbsolute);
  }
  return { created, skipped };
}
