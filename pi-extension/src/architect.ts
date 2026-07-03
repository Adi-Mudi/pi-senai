import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import type { ArchitectInputsConfig } from "./architect-inputs-config.js";
import type { ArchitecturalDrivers } from "./driver-extractor.js";

export const ARCHITECT_PROFILE_FILE = "architect-profile.json";
export const ARCHITECT_REPORT_FILE = "architect-report.json";

export interface ArchitectureLibraryEntry {
  name: string;
  filePath: string;
  domain: string[];
  teamSize: string;
  complexity: string;
  bestForDrivers: string[];
  notForDrivers: string[];
  content: string;
}

export interface ArchitectProfile {
  projectName: string;
  projectSlug: string;
  selectedArchitecture: string;
  drivers: ArchitecturalDrivers;
  additionalConstraints: string[];
}

export interface ArchitectReport {
  selectedArchitecture: string;
  confidence: "high" | "medium" | "low";
  missingResources: string[];
  reasoning: string;
  skillProfile: {
    recommendedAgents: string[];
    forbiddenPatterns: string[];
  };
  developmentOrder: string[];
  feasibility: "feasible" | "risky" | "not-feasible";
  feasibilityReasoning: string;
  techStack: string[];
  atomicFunctions: string[];
}

export const ARCHITECT_ROLES = [
  "planner",
  "implementer",
  "reviewer-correctness",
  "reviewer-security",
  "reviewer-tests",
] as const;

export const ARCHITECT_STAGES = ["plan", "implement", "document", "deliver"] as const;

export function getArchitectProfilePath(cwd: string): string {
  return path.join(cwd, ".pi", "orchestra", ARCHITECT_PROFILE_FILE);
}

export function getArchitectReportPath(cwd: string): string {
  return path.join(cwd, ".pi", "orchestra", ARCHITECT_REPORT_FILE);
}

export function loadArchitectProfile(cwd: string): ArchitectProfile | null {
  const profilePath = getArchitectProfilePath(cwd);
  try {
    const raw = fs.readFileSync(profilePath, "utf8");
    return JSON.parse(raw) as ArchitectProfile;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid architect profile at ${profilePath}: ${err.message}`);
  }
}

export function saveArchitectProfile(cwd: string, profile: ArchitectProfile): void {
  const profilePath = getArchitectProfilePath(cwd);
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");
}

export function loadArchitectReport(cwd: string): ArchitectReport | null {
  const reportPath = getArchitectReportPath(cwd);
  try {
    const raw = fs.readFileSync(reportPath, "utf8");
    return JSON.parse(raw) as ArchitectReport;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid architect report at ${reportPath}: ${err.message}`);
  }
}

export function saveArchitectReport(cwd: string, report: ArchitectReport): void {
  const reportPath = getArchitectReportPath(cwd);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
}

export function discoverArchitectureLibrary(cwd: string): ArchitectureLibraryEntry[] {
  const libraryDir = path.join(cwd, ".pi", "architecture-library");
  if (!fs.existsSync(libraryDir)) return [];

  const entries: ArchitectureLibraryEntry[] = [];
  const files = fs.readdirSync(libraryDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const filePath = path.join(libraryDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
      const name = String(frontmatter.name ?? "").trim();
      if (!name) continue;

      entries.push({
        name,
        filePath,
        domain: parseStringArray(frontmatter.domain) ?? [],
        teamSize: String(frontmatter["team-size"] ?? ""),
        complexity: String(frontmatter.complexity ?? ""),
        bestForDrivers: parseStringArray(frontmatter["best-for-drivers"]) ?? [],
        notForDrivers: parseStringArray(frontmatter["not-for-drivers"]) ?? [],
        content,
      });
    } catch {
      // Skip malformed architecture files.
    }
  }

  return entries;
}

export function selectArchitecture(
  drivers: ArchitecturalDrivers,
  library: ArchitectureLibraryEntry[],
): ArchitectureLibraryEntry | null {
  if (library.length === 0) return null;

  const driverText = buildDriverText(drivers).toLowerCase();

  const scored = library.map((entry) => {
    let score = 0;
    for (const driver of entry.bestForDrivers) {
      if (driverText.includes(driver.toLowerCase())) score += 1;
    }
    for (const driver of entry.notForDrivers) {
      if (driverText.includes(driver.toLowerCase())) score -= 2;
    }
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].entry;
}

export function generateAgentFiles(
  cwd: string,
  profile: ArchitectProfile,
  architecture: ArchitectureLibraryEntry,
): string[] {
  const agentsDir = path.join(cwd, ".pi", "agents");
  fs.mkdirSync(agentsDir, { recursive: true });

  const created: string[] = [];
  const rules = extractArchitectureRules(architecture.content);

  for (const role of ARCHITECT_ROLES) {
    const agentName = `${profile.projectSlug}-${architecture.name}-${role}`;
    const filePath = path.join(agentsDir, `${agentName}.md`);

    const content = buildAgentMarkdown(agentName, role, profile, architecture, rules);
    fs.writeFileSync(filePath, content, "utf8");
    created.push(filePath);
  }

  return created;
}

export function generateSkillFiles(
  cwd: string,
  profile: ArchitectProfile,
  architecture: ArchitectureLibraryEntry,
): string[] {
  const skillsDir = path.join(cwd, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  const created: string[] = [];

  for (const stage of ARCHITECT_STAGES) {
    const skillName = `${profile.projectSlug}-${architecture.name}-${stage}`;
    const filePath = path.join(skillsDir, `${skillName}.md`);

    const content = buildSkillMarkdown(skillName, stage, profile, architecture);
    fs.writeFileSync(filePath, content, "utf8");
    created.push(filePath);
  }

  return created;
}

export function buildArchitectPrompt(cwd: string, profile: ArchitectProfile): string {
  return [
    `# Architect Generation Task`,
    "",
    `Project: ${profile.projectName}`,
    `Architecture: ${profile.selectedArchitecture}`,
    "",
    `Read the architectural drivers from ${getArchitectProfilePath(cwd)}.`,
    "",
    "Follow these steps:",
    "1. Load the architecture library from .pi/architecture-library/.",
    "2. Confirm the selected architecture matches the drivers.",
    "3. Write the architect report to .pi/orchestra/architect-report.json with these fields:",
    "   - selectedArchitecture",
    "   - confidence (high|medium|low)",
    "   - missingResources",
    "   - reasoning",
    "   - skillProfile.recommendedAgents",
    "   - skillProfile.forbiddenPatterns",
    "   - developmentOrder (ordered list of implementation steps)",
    "   - feasibility (feasible|risky|not-feasible)",
    "   - feasibilityReasoning",
    "   - techStack (recommended languages, frameworks, platforms)",
    "   - atomicFunctions (small, single-responsibility functions/modules)",
    "4. Evaluate feasibility. If not-feasible, stop and notify the user. If risky, ask the user before proceeding.",
    "5. If resources are missing, set missingResources and stop for web search.",
    "6. Generate project-specific agents in .pi/agents/.",
    "7. Generate project-specific skills in skills/.",
    "",
    "Do not proceed to agent generation if confidence is low and missingResources is not empty.",
  ].join("\n");
}

export function isFeasible(report: ArchitectReport): boolean {
  return report.feasibility === "feasible";
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
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

function buildDriverText(drivers: ArchitecturalDrivers): string {
  const parts: string[] = [];
  for (const fr of drivers.functionalRequirements) parts.push(fr.description);
  for (const qa of drivers.qualityAttributes) {
    parts.push(qa.category);
    parts.push(qa.description);
    if (qa.target) parts.push(qa.target);
  }
  for (const c of drivers.constraints) {
    parts.push(c.category);
    parts.push(c.description);
  }
  for (const tc of drivers.technicalConcerns) parts.push(tc.description);
  return parts.join(" ");
}

function extractArchitectureRules(content: string): string[] {
  const rules: string[] = [];
  const lines = content.split("\n");
  let inRules = false;
  for (const line of lines) {
    if (/^## Core rules/i.test(line)) {
      inRules = true;
      continue;
    }
    if (inRules && line.startsWith("## ")) {
      break;
    }
    if (inRules && /^\d+\./.test(line.trim())) {
      rules.push(line.trim().replace(/^\d+\.\s*/, ""));
    }
  }
  return rules;
}

function buildAgentMarkdown(
  agentName: string,
  role: string,
  profile: ArchitectProfile,
  architecture: ArchitectureLibraryEntry,
  rules: string[],
): string {
  const roleDescription: Record<string, string> = {
    planner: "plans architecture-aware implementation",
    implementer: "implements code following the selected architecture",
    "reviewer-correctness": "reviews correctness against architecture rules",
    "reviewer-security": "reviews security concerns for this architecture",
    "reviewer-tests": "reviews test coverage for this architecture",
  };

  const lines = [
    "---",
    `name: ${agentName}`,
    `description: ${roleDescription[role] ?? role} for ${profile.projectName} using ${architecture.name}`,
    "tools: read, write, edit, bash",
    `skills: ${profile.projectSlug}-${architecture.name}-plan`,
    "---",
    "",
    `# ${agentName}`,
    "",
    `You are the ${role} for the ${profile.projectName} project.`,
    "",
    `Architecture: ${architecture.name}`,
    "",
    "## Architecture rules",
    "",
  ];

  if (rules.length > 0) {
    for (const rule of rules) {
      lines.push(`- ${rule}`);
    }
  } else {
    lines.push(`- Follow the ${architecture.name} architecture.`);
  }

  lines.push("");
  lines.push("## Project context");
  lines.push("");
  lines.push(`- Functional requirements: ${profile.drivers.functionalRequirements.length} extracted`);
  lines.push(`- Quality attributes: ${profile.drivers.qualityAttributes.length} extracted`);
  lines.push(`- Constraints: ${profile.drivers.constraints.length} extracted`);
  lines.push(`- Technical concerns: ${profile.drivers.technicalConcerns.length} extracted`);

  if (profile.additionalConstraints.length > 0) {
    lines.push("");
    lines.push("## Additional constraints");
    lines.push("");
    for (const constraint of profile.additionalConstraints) {
      lines.push(`- ${constraint}`);
    }
  }

  lines.push("");
  lines.push("## Forbidden patterns");
  lines.push("");
  for (const forbidden of architecture.notForDrivers) {
    lines.push(`- ${forbidden}`);
  }

  return lines.join("\n");
}

function buildSkillMarkdown(
  skillName: string,
  stage: string,
  profile: ArchitectProfile,
  architecture: ArchitectureLibraryEntry,
): string {
  const stageDescription: Record<string, string> = {
    plan: "Plan the implementation following the selected architecture",
    implement: "Implement code following the selected architecture",
    document: "Document the project and its architecture decisions",
    deliver: "Run final checks and package the deliverable",
  };

  return [
    "---",
    `name: ${skillName}`,
    `description: ${stageDescription[stage]} for ${profile.projectName}`,
    "---",
    "",
    `# ${skillName}`,
    "",
    `${stageDescription[stage]} for ${profile.projectName}.`,
    "",
    `Architecture: ${architecture.name}`,
    "",
    "## Rules",
    "",
    `- Follow the ${architecture.name} architecture.`,
    `- Respect the project constraints and quality attributes in .pi/orchestra/architectural-drivers.json.`,
    `- Do not use patterns listed as forbidden in the architecture library.`,
  ].join("\n");
}
