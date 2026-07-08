import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import type { ArchitectInputsConfig } from "./architect-inputs-config.js";
import { getDriversPath, type ArchitecturalDrivers } from "./driver-extractor.js";
import { getArchitectStateDir } from "./constants.js";

export const ARCHITECT_PROFILE_FILE = "architect-profile.json";
export const ARCHITECT_REPORT_FILE = "architect-report.json";

export interface ArchitectureLibraryEntry {
  id: string;
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

export interface ArchitectComponent {
  name: string;
  responsibility: string;
  dependencies: string[];
}

export interface ArchitectInterface {
  name: string;
  type: "internal" | "external";
  description: string;
}

export interface ArchitectAdr {
  id: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
}

export interface ArchitectQualityMapping {
  qualityAttribute: string;
  decision: string;
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
  systemOverview: string;
  components: ArchitectComponent[];
  interfaces: ArchitectInterface[];
  dataFlow: string;
  dataModel: string;
  deployment: string;
  qualityAttributeMapping: ArchitectQualityMapping[];
  adrs: ArchitectAdr[];
  constraints: string[];
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
  return path.join(getArchitectStateDir(cwd), ARCHITECT_PROFILE_FILE);
}

export function getArchitectReportPath(cwd: string): string {
  return path.join(getArchitectStateDir(cwd), ARCHITECT_REPORT_FILE);
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

export function migrateLegacyArchitectState(cwd: string): string[] {
  const legacyDir = path.join(cwd, ".IDE_Plans", "architect");
  const targetDir = getArchitectStateDir(cwd);
  const moved: string[] = [];
  if (!fs.existsSync(legacyDir)) return moved;
  if (fs.existsSync(targetDir)) return moved;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(legacyDir)) {
    if (entry === "architect-map") continue; // skip old temporary map dir
    const src = path.join(legacyDir, entry);
    const dest = path.join(targetDir, entry);
    fs.renameSync(src, dest);
    moved.push(path.relative(cwd, dest));
  }
  return moved;
}

export function discoverArchitectureLibrary(cwd: string): ArchitectureLibraryEntry[] {
  const libraryDir = path.join(cwd, ".pi", "architecture-library");
  if (!fs.existsSync(libraryDir)) return [];

  const entries: ArchitectureLibraryEntry[] = [];
  const files = fs.readdirSync(libraryDir);

  for (const file of files) {
    const filePath = path.join(libraryDir, file);
    try {
      if (file.endsWith(".md")) {
        const content = fs.readFileSync(filePath, "utf8");
        const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
        const name = String(frontmatter.name ?? "").trim();
        if (!name) continue;
        const id = String(frontmatter.id ?? "").trim() || slugify(name);

        entries.push({
          id,
          name,
          filePath,
          domain: parseStringArray(frontmatter.domain) ?? [],
          teamSize: String(frontmatter["team-size"] ?? ""),
          complexity: String(frontmatter.complexity ?? ""),
          bestForDrivers: parseStringArray(frontmatter["best-for-drivers"]) ?? [],
          notForDrivers: parseStringArray(frontmatter["not-for-drivers"]) ?? [],
          content,
        });
      } else if (file.endsWith(".json")) {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const name = String((item as any).name ?? "").trim();
          if (!name) continue;
          const id = String((item as any).id ?? "").trim() || slugify(name);
          const contentParts: string[] = [];
          if ((item as any).description) contentParts.push(String((item as any).description));
          if ((item as any).platform) contentParts.push(`Platform: ${String((item as any).platform)}`);
          if ((item as any).runtime) contentParts.push(`Runtime: ${String((item as any).runtime)}`);
          if ((item as any).style) contentParts.push(`Style: ${String((item as any).style)}`);
          if (Array.isArray((item as any).strengths)) {
            contentParts.push("Strengths: " + (item as any).strengths.join(", "));
          }
          if (Array.isArray((item as any).weaknesses)) {
            contentParts.push("Weaknesses: " + (item as any).weaknesses.join(", "));
          }
          if ((item as any).fitRationale) contentParts.push(String((item as any).fitRationale));
          if ((item as any).qualityAttributeSupport) {
            contentParts.push("Quality attributes: " + JSON.stringify((item as any).qualityAttributeSupport));
          }

          entries.push({
            id,
            name,
            filePath,
            domain: parseStringArray((item as any).platform ?? (item as any).domain) ?? [],
            teamSize: String((item as any).teamSize ?? (item as any)["team-size"] ?? ""),
            complexity: String((item as any).complexity ?? ""),
            bestForDrivers: parseStringArray((item as any).bestForDrivers ?? (item as any)["best-for-drivers"]) ?? [],
            notForDrivers: parseStringArray((item as any).notForDrivers ?? (item as any)["not-for-drivers"]) ?? [],
            content: contentParts.join("\n\n"),
          });
        }
      }
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
  const archId = architecture.id || slugify(architecture.name);

  for (const role of ARCHITECT_ROLES) {
    const agentName = `${profile.projectSlug}-${archId}-${role}`;
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
  const skillsDir = path.join(cwd, ".pi", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  const created: string[] = [];
  const archId = architecture.id || slugify(architecture.name);

  for (const stage of ARCHITECT_STAGES) {
    const skillName = `${profile.projectSlug}-${archId}-${stage}`;
    const skillDir = path.join(skillsDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    const filePath = path.join(skillDir, "SKILL.md");

    const content = buildSkillMarkdown(skillName, stage, profile, architecture);
    fs.writeFileSync(filePath, content, "utf8");
    created.push(filePath);
  }

  return created;
}

export function buildArchitectPrompt(cwd: string, profile: ArchitectProfile): string {
  const architectStateDir = getArchitectStateDir(cwd);
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
    `3. Write the architect report to ${getArchitectReportPath(cwd)} with these fields:`,
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
    "   - systemOverview",
    "   - components (name, responsibility, dependencies)",
    "   - interfaces (internal/external APIs and communication patterns)",
    "   - dataFlow",
    "   - dataModel",
    "   - deployment",
    "   - qualityAttributeMapping",
    "   - adrs (architecture decision records)",
    "   - constraints",
    "4. Evaluate feasibility. If not-feasible, stop and notify the user. If risky, ask the user before proceeding.",
    "5. If resources are missing, set missingResources and stop for web search.",
    `6. Generate ${path.join(architectStateDir, "architecture.md")} and ${path.join(architectStateDir, "adrs")}/*.md from the report.`,
    "7. Generate project-specific agents in .pi/agents/.",
    "8. Generate project-specific skills in .pi/skills/<project>-<architecture-id>-<stage>/SKILL.md.",
    "",
    "Do not proceed to agent generation if confidence is low and missingResources is not empty.",
  ].join("\n");
}

export function isFeasible(report: ArchitectReport): boolean {
  return report.feasibility === "feasible";
}

export function areDriversStale(cwd: string, inputsConfig: ArchitectInputsConfig): boolean {
  const driversPath = getDriversPath(cwd);
  if (!fs.existsSync(driversPath)) {
    return true;
  }
  const driversMtime = fs.statSync(driversPath).mtimeMs;
  for (const doc of inputsConfig.documents) {
    const docPath = path.resolve(cwd, doc.path);
    if (fs.existsSync(docPath)) {
      const docMtime = fs.statSync(docPath).mtimeMs;
      if (docMtime > driversMtime) {
        return true;
      }
    }
  }
  return false;
}

export function generateArchitectureDocs(
  cwd: string,
  profile: ArchitectProfile,
  report: ArchitectReport,
): string[] {
  const docsDir = getArchitectStateDir(cwd);
  const adrsDir = path.join(docsDir, "adrs");
  fs.mkdirSync(adrsDir, { recursive: true });

  const created: string[] = [];

  const architecturePath = path.join(docsDir, "architecture.md");
  fs.writeFileSync(architecturePath, buildArchitectureMarkdown(profile, report), "utf8");
  created.push(architecturePath);

  for (const adr of report.adrs) {
    const adrFileName = `${adr.id}-${slugify(adr.title)}.md`;
    const adrPath = path.join(adrsDir, adrFileName);
    fs.writeFileSync(adrPath, buildAdrMarkdown(adr), "utf8");
    created.push(adrPath);
  }

  return created;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function buildSystemContextMermaid(report: ArchitectReport): string {
  const externals = report.interfaces
    .filter((i) => i.type === "external")
    .map((i) => i.name);
  const lines = ["graph TD"];
  lines.push("    User((User))");
  lines.push(`    System[${report.selectedArchitecture}]`);
  lines.push("    User --> System");
  for (const ext of externals) {
    const id = `id_${slugify(ext)}`;
    lines.push(`    ${id}[${ext}]`);
    lines.push(`    System --> ${id}`);
  }
  return lines.join("\n");
}

function buildContainerMermaid(report: ArchitectReport): string {
  const lines = ["graph TD"];
  for (const comp of report.components) {
    const id = `id_${slugify(comp.name)}`;
    lines.push(`    ${id}[${comp.name}]`);
  }
  for (const comp of report.components) {
    const from = `id_${slugify(comp.name)}`;
    for (const dep of comp.dependencies) {
      const to = `id_${slugify(dep)}`;
      lines.push(`    ${from} --> ${to}`);
    }
  }
  return lines.join("\n");
}

function buildSequenceMermaid(report: ArchitectReport): string {
  const lines = ["sequenceDiagram"];
  lines.push("    actor U as User");
  const participants = report.components.slice(0, 6);
  for (const comp of participants) {
    const id = `id_${slugify(comp.name)}`;
    lines.push(`    participant ${id} as ${comp.name}`);
  }
  if (participants.length === 0) {
    lines.push("    participant System");
    lines.push("    U->>System: initiates request");
    lines.push("    System-->>U: returns result");
  } else {
    const firstId = `id_${slugify(participants[0].name)}`;
    const lastId = `id_${slugify(participants[participants.length - 1].name)}`;
    lines.push(`    U->>${firstId}: initiates request`);
    for (let i = 0; i < participants.length - 1; i++) {
      const from = `id_${slugify(participants[i].name)}`;
      const to = `id_${slugify(participants[i + 1].name)}`;
      lines.push(`    ${from}->>${to}: processes`);
    }
    lines.push(`    ${lastId}-->>U: returns result`);
  }
  return lines.join("\n");
}

function buildArchitectureMarkdown(profile: ArchitectProfile, report: ArchitectReport): string {
  const lines: string[] = [
    "# Software Architecture",
    "",
    `Project: ${profile.projectName}`,
    `Selected architecture: ${report.selectedArchitecture}`,
    `Confidence: ${report.confidence}`,
    `Feasibility: ${report.feasibility}`,
    "",
    "## System overview",
    "",
    report.systemOverview || "Not provided.",
    "",
    "## Architecture diagrams",
    "",
    "### System context",
    "",
    "```mermaid",
    buildSystemContextMermaid(report),
    "```",
    "",
    "### Containers and components",
    "",
    "```mermaid",
    buildContainerMermaid(report),
    "```",
    "",
    "### Typical interaction flow",
    "",
    "```mermaid",
    buildSequenceMermaid(report),
    "```",
    "",
    "## Components",
    "",
  ];

  if (report.components.length > 0) {
    for (const component of report.components) {
      lines.push(`### ${component.name}`);
      lines.push("");
      lines.push(`- Responsibility: ${component.responsibility}`);
      if (component.dependencies.length > 0) {
        lines.push(`- Dependencies: ${component.dependencies.join(", ")}`);
      }
      lines.push("");
    }
  } else {
    lines.push("No components defined.");
    lines.push("");
  }

  lines.push("## Interfaces");
  lines.push("");
  if (report.interfaces.length > 0) {
    for (const iface of report.interfaces) {
      lines.push(`- **${iface.name}** (${iface.type}): ${iface.description}`);
    }
  } else {
    lines.push("No interfaces defined.");
  }
  lines.push("");

  lines.push("## Data flow");
  lines.push("");
  lines.push(report.dataFlow || "Not provided.");
  lines.push("");

  lines.push("## Data model");
  lines.push("");
  lines.push(report.dataModel || "Not provided.");
  lines.push("");

  lines.push("## Deployment");
  lines.push("");
  lines.push(report.deployment || "Not provided.");
  lines.push("");

  lines.push("## Technology stack");
  lines.push("");
  if (report.techStack.length > 0) {
    for (const tech of report.techStack) {
      lines.push(`- ${tech}`);
    }
  } else {
    lines.push("No technology stack defined.");
  }
  lines.push("");

  lines.push("## Development order");
  lines.push("");
  if (report.developmentOrder.length > 0) {
    for (let i = 0; i < report.developmentOrder.length; i++) {
      lines.push(`${i + 1}. ${report.developmentOrder[i]}`);
    }
  } else {
    lines.push("No development order defined.");
  }
  lines.push("");

  lines.push("## Atomic functions");
  lines.push("");
  if (report.atomicFunctions.length > 0) {
    for (const fn of report.atomicFunctions) {
      lines.push(`- ${fn}`);
    }
  } else {
    lines.push("No atomic functions defined.");
  }
  lines.push("");

  lines.push("## Quality attribute mapping");
  lines.push("");
  if (report.qualityAttributeMapping.length > 0) {
    for (const mapping of report.qualityAttributeMapping) {
      lines.push(`- **${mapping.qualityAttribute}**: ${mapping.decision}`);
    }
  } else {
    lines.push("No quality attribute mapping defined.");
  }
  lines.push("");

  lines.push("## Constraints");
  lines.push("");
  if (report.constraints.length > 0) {
    for (const constraint of report.constraints) {
      lines.push(`- ${constraint}`);
    }
  } else {
    lines.push("No constraints defined.");
  }
  lines.push("");

  lines.push("## Architecture Decision Records");
  lines.push("");
  if (report.adrs.length > 0) {
    for (const adr of report.adrs) {
      lines.push(`- [${adr.id} ${adr.title}](adrs/${adr.id}-${slugify(adr.title)}.md)`);
    }
  } else {
    lines.push("No ADRs defined.");
  }
  lines.push("");

  lines.push("## Reasoning");
  lines.push("");
  lines.push(report.reasoning || "Not provided.");
  lines.push("");

  lines.push("## Feasibility reasoning");
  lines.push("");
  lines.push(report.feasibilityReasoning || "Not provided.");
  lines.push("");

  return lines.join("\n");
}

function buildAdrMarkdown(adr: ArchitectAdr): string {
  return [
    "---",
    `name: ${adr.id}-${slugify(adr.title)}`,
    `description: ${adr.title}`,
    "---",
    "",
    `# ${adr.id}: ${adr.title}`,
    "",
    "## Context",
    "",
    adr.context || "Not provided.",
    "",
    "## Decision",
    "",
    adr.decision || "Not provided.",
    "",
    "## Consequences",
    "",
    adr.consequences || "Not provided.",
    "",
  ].join("\n");
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
  lines.push("## Architecture documents");
  lines.push("");
  lines.push("Before making decisions, read the full architecture description at `.pi/architect/architecture.md` and the relevant ADRs in `.pi/architect/adrs/`.");

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
    `- Respect the project constraints and quality attributes in .pi/architect/architectural-drivers.json.`,
    `- Read .pi/architect/architecture.md and relevant ADRs in .pi/architect/adrs/ before acting.`,
    `- Do not use patterns listed as forbidden in the architecture library.`,
  ].join("\n");
}
