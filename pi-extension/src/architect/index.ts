import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import type { ArchitectInputsConfig } from "./inputs-config.js";
import { getArchitectInputsConfigPath } from "./inputs-config.js";
import { getDriversPath, type ArchitecturalDrivers } from "./drivers.js";
import { getArchitectStateDir } from "../core/paths.js";
import { loadAgentConfig, resolveAgentName, saveAgentConfig } from "../agents/config.js";
import { DEFAULT_AGENTS, type SenaiRole } from "../agents/suggestions.js";
import { atomicWriteFile, atomicWriteJson } from "../io/atomic-write.js";

export const ARCHITECT_PROFILE_FILE = "architect-profile.json";
export const ARCHITECT_REPORT_FILE = "architect-report.json";

// Re-export library suggester so commands can import via architect/index.js
// without adding a new top-level barrel.
export {
	suggestArchitectures,
	type LibrarySuggestion,
	type ProjectAnswers,
	type ProjectPurpose,
	type ProjectScale,
	type ProjectDeployment,
	type ProjectRealtime,
} from "./library-suggester.js";

// Re-export codebase auto-discovery so commands can import via architect/index.js
export {
	createInputsConfigFromCodebase,
	type CodebaseDiscoveryResult,
} from "./inputs-config.js";

// Re-export Pi extension detector so commands can branch on detection result
export { detectPiExtension, type PiExtensionDetection, type PiSpecificSignal } from "./pi-extension-detector.js";

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

/** Maps each architecture-bound Senai role to its generated agent name suffix.
 *  Single source of truth — doctor.ts derives its checks from this. */
export const ARCHITECTURE_AGENT_MAPPING: Array<{ role: SenaiRole; suffix: string }> = [
  { role: "scout-1", suffix: "planner" },
  { role: "planner", suffix: "planner" },
  { role: "implementer", suffix: "implementer" },
  { role: "reviewer-correctness", suffix: "reviewer-correctness" },
  { role: "reviewer-security", suffix: "reviewer-security" },
  { role: "reviewer-tests", suffix: "reviewer-tests" },
  { role: "code-review", suffix: "reviewer-correctness" },
];

// Maps each generated architecture role to the stage skill it should reference.
// Reviewers act in the plan stage: their review artifacts live under plan/reviews/.
export const ARCHITECT_ROLE_STAGE: Record<string, string> = {
  planner: "plan",
  implementer: "implement",
  "reviewer-correctness": "plan",
  "reviewer-security": "plan",
  "reviewer-tests": "plan",
};

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
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const projectName = typeof parsed.projectName === "string" ? parsed.projectName : "";
    let projectSlug = typeof parsed.projectSlug === "string" ? parsed.projectSlug : "";
    if (!projectSlug && typeof parsed.project === "string") {
      projectSlug = parsed.project;
    }
    if (!projectSlug && projectName) {
      projectSlug = slugify(projectName);
    }

    const selectedArchitecture = typeof parsed.selectedArchitecture === "string" ? parsed.selectedArchitecture : "";

    if (!projectName || !projectSlug || !selectedArchitecture) {
      throw new Error("profile is missing projectName, projectSlug, or selectedArchitecture");
    }

    return {
      ...parsed,
      projectName,
      projectSlug,
      selectedArchitecture,
    } as ArchitectProfile;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid architect profile at ${profilePath}: ${err.message}`);
  }
}

export function saveArchitectProfile(cwd: string, profile: ArchitectProfile): void {
  atomicWriteJson(getArchitectProfilePath(cwd), profile);
}

export function loadArchitectReport(cwd: string): ArchitectReport | null {
  const reportPath = getArchitectReportPath(cwd);
  try {
    const raw = fs.readFileSync(reportPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

    const normalized = { ...record } as unknown as ArchitectReport;

    if (Array.isArray(record.adrs)) {
      normalized.adrs = record.adrs
        .map((adr: unknown): ArchitectAdr | null => {
          if (typeof adr === "string") {
            const trimmed = adr.trim();
            if (!trimmed) return null;
            const match = trimmed.match(/^(ADR-\d+)[:\s]+(.+)$/);
            if (match) {
              return {
                id: match[1],
                title: match[2].trim(),
                context: "",
                decision: "",
                consequences: "",
              };
            }
            return {
              id: "ADR-000",
              title: trimmed,
              context: "",
              decision: "",
              consequences: "",
            };
          }
          if (adr && typeof adr === "object") {
            const obj = adr as Record<string, unknown>;
            const id = typeof obj.id === "string" && obj.id.trim() !== "" ? obj.id.trim() : "";
            const title = typeof obj.title === "string" && obj.title.trim() !== "" ? obj.title.trim() : "";
            if (!id || !title) return null;
            return {
              id,
              title,
              context: typeof obj.context === "string" ? obj.context : "",
              decision: typeof obj.decision === "string" ? obj.decision : "",
              consequences: typeof obj.consequences === "string" ? obj.consequences : "",
            };
          }
          return null;
        })
        .filter((adr): adr is ArchitectAdr => adr !== null);
    }

    // Older reports store confidence as a number (e.g. 95). Normalize it to
    // the string scale so downstream checks read it correctly.
    if (typeof record.confidence === "number" && Number.isFinite(record.confidence)) {
      normalized.confidence = record.confidence >= 80 ? "high" : record.confidence >= 50 ? "medium" : "low";
    }

    return normalized;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid architect report at ${reportPath}: ${err.message}`);
  }
}

export const GENERATED_MANIFEST_FILE = "generated-manifest.json";

export interface GeneratedManifest {
  version: 1;
  generatedAt: string;
  files: Record<string, string>;
}

// Records the content hash of every generated file at generation time. The
// drift check compares against these hashes, never against timestamps.
export function writeGeneratedManifest(cwd: string, files: string[]): GeneratedManifest {
  const manifest: GeneratedManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: {},
  };
  for (const filePath of files) {
    const hash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    manifest.files[path.relative(cwd, filePath)] = hash;
  }
  const manifestPath = path.join(getArchitectStateDir(cwd), GENERATED_MANIFEST_FILE);
  atomicWriteJson(manifestPath, manifest);
  return manifest;
}

export function loadGeneratedManifest(cwd: string): GeneratedManifest | null {
  const manifestPath = path.join(getArchitectStateDir(cwd), GENERATED_MANIFEST_FILE);
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as GeneratedManifest;
    if (parsed.version !== 1 || typeof parsed.files !== "object" || parsed.files === null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Merges new files into an existing manifest without wiping other entries.
// Used when a second generator (e.g. the sub-agent generator) adds files to
// drift tracking after the architecture factory wrote its own entries.
export function addToGeneratedManifest(cwd: string, files: string[]): GeneratedManifest {
  const existing = loadGeneratedManifest(cwd);
  const manifest: GeneratedManifest = existing ?? { version: 1, generatedAt: "", files: {} };
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    const hash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    manifest.files[path.relative(cwd, filePath)] = hash;
  }
  manifest.generatedAt = new Date().toISOString();
  const manifestPath = path.join(getArchitectStateDir(cwd), GENERATED_MANIFEST_FILE);
  atomicWriteJson(manifestPath, manifest);
  return manifest;
}

export function saveArchitectReport(cwd: string, report: ArchitectReport): void {
  atomicWriteJson(getArchitectReportPath(cwd), report);
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
  return selectArchitectureWithContext(drivers, library, null);
}

export function selectArchitectureWithContext(
  drivers: ArchitecturalDrivers,
  library: ArchitectureLibraryEntry[],
  piExtensionDetection: { isPiExtension: boolean; confidence: number } | null,
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
    if (piExtensionDetection?.isPiExtension && entry.id === "pi-architecture") {
      score += 10 * Math.max(0.5, piExtensionDetection.confidence);
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

    const content = buildAgentMarkdown(agentName, role, profile, architecture, rules, archId);
    atomicWriteFile(filePath, content, "utf8");
    created.push(filePath);
  }

  return created;
}

/** Auto-map architecture-bound roles in agents.json to the generated agents.
 *  Remaps roles still on built-in defaults or pointing at previously generated
 *  agents for this project (stale after an architecture change). Never touches
 *  other custom mappings. Creates agents.json if missing. Returns mapped roles. */
export function autoMapArchitectureAgents(cwd: string, profile: ArchitectProfile, archId: string): SenaiRole[] {
  const config = loadAgentConfig(cwd) ?? { version: 1, agents: {} };
  const agents = { ...config.agents } as Record<string, string>;
  const mapped: SenaiRole[] = [];
  for (const { role, suffix } of ARCHITECTURE_AGENT_MAPPING) {
    const expected = `${profile.projectSlug}-${archId}-${suffix}`;
    const current = resolveAgentName(config, role);
    const isDefault = current === DEFAULT_AGENTS[role];
    // Stale = looks generated for this project but the agent file is gone
    // (e.g. removed by removeStaleArchitectureArtifacts on a re-run). A user's
    // own slug-prefixed agent file on disk is never treated as stale.
    const agentFileExists = fs.existsSync(path.join(cwd, ".pi", "agents", `${current}.md`));
    const isStaleGenerated = current.startsWith(`${profile.projectSlug}-`) && !agentFileExists;
    if (!isDefault && !isStaleGenerated) continue;
    if (agents[role] === expected) continue;
    agents[role] = expected;
    mapped.push(role);
  }
  if (mapped.length > 0) {
    saveAgentConfig(cwd, { ...config, agents });
  }
  return mapped;
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
    atomicWriteFile(filePath, content, "utf8");
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
  // The inputs config itself is watched: editing additionalConstraints or the
  // document list rewrites it, and both must trigger a re-run.
  const configPath = getArchitectInputsConfigPath(cwd);
  if (fs.existsSync(configPath) && fs.statSync(configPath).mtimeMs > driversMtime) {
    return true;
  }
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
  atomicWriteFile(architecturePath, buildArchitectureMarkdown(profile, report), "utf8");
  created.push(architecturePath);

  // Regeneration replaces the ADR set: remove old ADRs so the folder always
  // matches the current report exactly.
  for (const entry of fs.readdirSync(adrsDir)) {
    if (!entry.endsWith(".md")) continue;
    try {
      fs.unlinkSync(path.join(adrsDir, entry));
    } catch {
      // Ignore deletion failures.
    }
  }

  for (const adr of report.adrs) {
    const adrFileName = `${adr.id}-${slugify(adr.title)}.md`;
    const adrPath = path.join(adrsDir, adrFileName);
    atomicWriteFile(adrPath, buildAdrMarkdown(adr), "utf8");
    created.push(adrPath);
  }

  return created;
}

// Removes generated agents and skills from PREVIOUS architecture runs of this
// project (same project slug, different architecture id). A file is deleted
// only when BOTH guards pass: the name pattern matches (slug prefix +
// architect role/stage suffix) AND the generation manifest proves we wrote it
// and the user never edited it (hash still matches). Anything else is kept
// and reported, so user-created or user-edited files stay safe.
export function removeStaleArchitectureArtifacts(
  cwd: string,
  profile: ArchitectProfile,
): { removed: string[]; kept: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  const prefix = `${profile.projectSlug}-`;
  const manifest = loadGeneratedManifest(cwd);

  // A path is deletable only when the manifest proves we generated it and its
  // content was never modified since.
  const isProvenUntouched = (absPath: string): boolean => {
    const rel = path.relative(cwd, absPath);
    const expectedHash = manifest?.files[rel];
    if (expectedHash === undefined) return false;
    try {
      const actual = createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
      return actual === expectedHash;
    } catch {
      return false;
    }
  };

  const expectedAgents = new Set(
    ARCHITECT_ROLES.map((role) => `${profile.projectSlug}-${profile.selectedArchitecture}-${role}`),
  );
  const agentsDir = path.join(cwd, ".pi", "agents");
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir)) {
      if (!entry.endsWith(".md")) continue;
      const name = entry.slice(0, -3);
      if (!name.startsWith(prefix)) continue;
      if (!ARCHITECT_ROLES.some((role) => name.endsWith(`-${role}`))) continue;
      if (expectedAgents.has(name)) continue;
      const filePath = path.join(agentsDir, entry);
      if (!isProvenUntouched(filePath)) {
        kept.push(path.relative(cwd, filePath));
        continue;
      }
      try {
        fs.unlinkSync(filePath);
        removed.push(path.relative(cwd, filePath));
      } catch {
        // Ignore deletion failures.
      }
    }
  }

  const expectedSkills = new Set(
    ARCHITECT_STAGES.map((stage) => `${profile.projectSlug}-${profile.selectedArchitecture}-${stage}`),
  );
  const skillsDir = path.join(cwd, ".pi", "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (!name.startsWith(prefix)) continue;
      if (!ARCHITECT_STAGES.some((stage) => name.endsWith(`-${stage}`))) continue;
      if (expectedSkills.has(name)) continue;
      const dirPath = path.join(skillsDir, name);
      // A generated skill directory holds exactly one tracked file: SKILL.md.
      if (!isProvenUntouched(path.join(dirPath, "SKILL.md"))) {
        kept.push(path.relative(cwd, dirPath));
        continue;
      }
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        removed.push(path.relative(cwd, dirPath));
      } catch {
        // Ignore deletion failures.
      }
    }
  }

  return { removed, kept };
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

  if (report.selectedArchitecture === "pi-architecture") {
    lines.push("## Pi Extension Mandatory Rules");
    lines.push("");
    lines.push("This project follows Pi's official architecture. The generated agents and skills must obey these rules:");
    lines.push("");
    lines.push("1. Layered codebase: `ai` → `agent` → `coding-agent` → `tui`. Lower layers never import from higher layers.");
    lines.push("2. Extensions import from `@mariozechner/pi-coding-agent` and `@sinclair/typebox` only, listed in `peerDependencies` with `\"*\"` range.");
    lines.push("3. All session-related files are written through atomic helpers (temp + fsync + rename).");
    lines.push("4. Every skill is a folder under `skills/` containing `SKILL.md` with required frontmatter (`name`, `description`).");
    lines.push("5. Every agent is a `.md` file under `.pi/agents/` with required frontmatter (`name`, `description`, `tools`).");
    lines.push("6. Extensions subscribe to lifecycle events via `pi.on(event, handler)` and may return `{ block: true, reason }` for `tool_call` only.");
    lines.push("7. Tools use TypeBox `Type.Object({...})` parameters; never raw objects.");
    lines.push("8. Long-running handlers use `ctx.signal` for cancellation parity.");
    lines.push("9. Run state persists under `.IDE_Plans/<ext>/runs/<run-id>/`; never write outside the configured directories.");
    lines.push("10. Commands are registered one per file under `commands/`; handlers stay thin.");
    lines.push("11. The composition root (`src/index.ts`) only wires, never contains business logic.");
    lines.push("12. Test layout mirrors source layout one-to-one; E2E tests live under `test/e2e/`.");
    lines.push("");
    lines.push("See `.pi/architecture-library/pi-architecture.md` for the full spec.");
  }

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
  archId: string,
): string {
  const roleDescription: Record<string, string> = {
    planner: "plans architecture-aware implementation",
    implementer: "implements code following the selected architecture",
    "reviewer-correctness": "reviews correctness against architecture rules",
    "reviewer-security": "reviews security concerns for this architecture",
    "reviewer-tests": "reviews test coverage for this architecture",
  };

  // Reviewers report only — they keep `write` for their review artifact but
  // lose `edit` so they cannot modify source files.
  const roleTools: Record<string, string> = {
    planner: "read, write, edit, bash",
    implementer: "read, write, edit, bash",
    "reviewer-correctness": "read, write, bash",
    "reviewer-security": "read, write, bash",
    "reviewer-tests": "read, write, bash",
  };

  const lines = [
    "---",
    `name: ${agentName}`,
    `description: ${roleDescription[role] ?? role} for ${profile.projectName} using ${architecture.name}`,
    `tools: ${roleTools[role] ?? "read, write, edit, bash"}`,
    `skills: ${profile.projectSlug}-${archId}-${ARCHITECT_ROLE_STAGE[role] ?? "plan"}`,
    "session-mode: lineage-only",
    "auto-exit: true",
    "spawning: false",
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

  if (architecture.id === "pi-architecture") {
    lines.push("");
    lines.push("## Pi Extension Tool Constraints");
    lines.push("");
    lines.push("This agent is part of a Pi extension project. Tool usage must obey:");
    lines.push("");
    lines.push(`- **Allowed**: ${roleTools[role] ?? "read, write, edit, bash"}`);
    lines.push("- **Required**: every tool call uses `ctx.cwd` instead of `process.cwd()`.");
    lines.push("- **Required**: long-running handlers pass `ctx.signal` to nested async work.");
    lines.push("- **Required**: tools register with TypeBox schemas; never raw object params.");
    lines.push("- **Forbidden**: direct `fs.writeFileSync` outside `io/atomic-write.ts` (use the extension's atomic writer).");
    lines.push("- **Forbidden**: importing from a higher layer (`commands/` may not import from `core/`, etc.).");
    lines.push("- **Reference**: https://pi.dev/docs/latest/skills for skill format, https://pi.dev/packages/pi-package-template for package layout.");
  }

  lines.push("");
  lines.push("## Forbidden patterns");
  lines.push("");
  for (const forbidden of architecture.notForDrivers) {
    lines.push(`- ${forbidden}`);
  }

  // Per-role testing discipline (Plan v2.0). Reviewers act in the plan stage;
  // the code-review role reuses reviewer-correctness per ARCHITECTURE_AGENT_MAPPING
  // so the anti-pattern scan lives there too. Implementer is the only writer in
  // the implement stage; its discipline block is what makes the tests worth
  // writing in the first place. planner and reviewer-security are unchanged.
  const roleDiscipline: Record<string, string[]> = {
    implementer: [
      "## Testing discipline",
      "",
      "Run the affected test files after every commit-sized change. The full suite must stay green; a new failure must be fixed before the next change. Never `skip` / `xfail` a failing test without a `// TODO(reason): re-enable in <ticket>` comment.",
      "",
      "Tests must follow:",
      "- AAA structure (Arrange, Act, Assert separated by blank lines or comments).",
      "- The project's naming convention. One convention only.",
      "- Equivalence partitioning (one representative per input class).",
      "- Boundary value analysis (boundary, just-below, just-above for every numeric / length / range contract).",
      "- Table-driven / parameterized cases for repeated logic.",
      "- At least one property-based test per pure function (Hypothesis, fast-check, jqwik, proptest, FsCheck).",
      "- FIRST quality: Fast (milliseconds), Independent, Repeatable, Self-validating, Timely.",
      "",
      "Coverage target on changed files: 80% line + branch. Security-critical paths (auth, payment, secrets): 100%. Report coverage at the end of the implement stage.",
      "",
      "Anti-patterns to refuse to write: God Test, zero-assertion test, mystery guest, over-mocking (>3 doubles), testing private methods, mirror-logic assertions.",
    ],
    "reviewer-tests": [
      "## Review checklist",
      "",
      "Review the plan's test strategy and the implement-stage test artifacts. Write a blocking issue to the review artifact if any item fails.",
      "1. `<plan>` ends with a `## Verification` section listing specific commands or named test cases (not \"tests pass\").",
      "2. High-risk areas (auth, money, data loss, concurrency) name explicit test cases.",
      "3. Input validation tests are listed (empty, null, max-length, invalid encoding).",
      "4. Boundary and edge cases are listed for every numeric / length / range contract.",
      "5. The test framework name and test path are named.",
      "6. No public contract is left untested.",
      "7. Property-based tests are mentioned for pure functions.",
      "8. The implement-stage tests cover the `## Verification` steps.",
      "9. Coverage on changed files is at least 80% (line + branch).",
      "10. The full suite was green at the end of the implement stage.",
    ],
    "reviewer-correctness": [
      "## Anti-pattern scan",
      "",
      "When reviewing code (Plan review OR implement-stage code-review), scan the changed tests for these smells and write each finding to the review artifact with file:line and the smell name:",
      "- **God Test** — one test exercises more than one unrelated behavior.",
      "- **Zero-assertion test** — test runs but contains no `assert*` / `expect*` / equivalent.",
      "- **Mystery Guest** — test depends on data from a file, env var, or fixture that is not visible inside the test.",
      "- **Over-Mocking** — test uses more than three test doubles.",
      "- **Private-method testing** — test reaches into non-public API of the system under test.",
      "- **Mirror-logic assertion** — assertion duplicates the production expression (asserts `add(a,b) === a+b`).",
      "- **No AAA structure** — Arrange / Act / Assert not separated.",
      "- **Flaky timing** — test uses `sleep`, `setTimeout`, or fixed waits instead of condition polling.",
      "",
      "Severity: these are blocking when the smell appears in a critical-path test (auth, payment, data loss). They are non-blocking elsewhere but must still be listed.",
    ],
  };

  const discipline = roleDiscipline[role];
  if (discipline) {
    lines.push("");
    for (const line of discipline) {
      lines.push(line);
    }
  }

  lines.push("");
  lines.push("## Completion contract");
  lines.push("");
  lines.push("- Write your deliverable to the artifact path given in your task. The file on disk is the deliverable.");
  lines.push("- Your FINAL message must be at most 10 lines: outcome + artifact path(s). Never paste the deliverable content into the final message.");

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

  const baseLines = [
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
  ];

  if (architecture.id === "pi-architecture") {
    baseLines.push("");
    baseLines.push("## Pi Extension Compliance");
    baseLines.push("");
    baseLines.push("This project follows Pi's official architecture. Before any action:");
    baseLines.push("- Read the Pi extension docs at https://pi.dev/docs/latest/skills and https://app.unpkg.com/@mariozechner/pi-coding-agent@latest/files/docs/extensions.md.");
    baseLines.push("- Use `ctx.cwd` not `process.cwd()` for all file operations.");
    baseLines.push("- Respect the layered architecture: lower layers never import from higher layers.");
    baseLines.push("- Run all writes through the extension's atomic-write helper.");
  }

  baseLines.push(
    "",
    "## Rules",
    "",
    `- Follow the ${architecture.name} architecture.`,
    `- Respect the project constraints and quality attributes in .pi/architect/architectural-drivers.json.`,
    `- Read .pi/architect/architecture.md and relevant ADRs in .pi/architect/adrs/ before acting.`,
    `- Do not use patterns listed as forbidden in the architecture library.`,
  );

  return baseLines.join("\n");
}
