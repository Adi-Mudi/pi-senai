import * as fs from "node:fs";
import * as path from "node:path";

export const ARCHITECT_INPUTS_CONFIG_FILE = "architect-inputs.json";

export const CURRENT_ARCHITECT_INPUTS_CONFIG_VERSION = 1;

export const ARCHITECT_DOCUMENT_TYPES = [
  "prd",
  "mrd",
  "brd",
  "rtm",
  "nfr",
  "test-plan",
  "adr",
  "readme",
  "code",
] as const;

export type ArchitectDocumentType = (typeof ARCHITECT_DOCUMENT_TYPES)[number];

export const ARCHITECT_SKILL_LEVELS = ["beginner", "intermediate", "advanced"] as const;

export type ArchitectSkillLevel = (typeof ARCHITECT_SKILL_LEVELS)[number];

export interface ArchitectDocumentInput {
  type: ArchitectDocumentType;
  path: string;
}

export interface ArchitectInputsConfig {
  version: 1;
  documents: ArchitectDocumentInput[];
  freeFormRequirements: string[];
  skillLevel: ArchitectSkillLevel;
}

export function getArchitectInputsConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "orchestra", ARCHITECT_INPUTS_CONFIG_FILE);
}

export function loadArchitectInputsConfig(cwd: string): ArchitectInputsConfig | null {
  const configPath = getArchitectInputsConfigPath(cwd);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as ArchitectInputsConfig;
    validateArchitectInputsConfig(parsed);
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid architect inputs config at ${configPath}: ${err.message}`);
  }
}

export function saveArchitectInputsConfig(
  cwd: string,
  config: ArchitectInputsConfig,
): void {
  const configPath = getArchitectInputsConfigPath(cwd);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

export function validateArchitectInputsConfig(config: ArchitectInputsConfig): void {
  if (config.version !== CURRENT_ARCHITECT_INPUTS_CONFIG_VERSION) {
    throw new Error(
      `Unsupported architect-inputs.json version: ${config.version}. Expected version: ${CURRENT_ARCHITECT_INPUTS_CONFIG_VERSION}. Run /orchestra-configure-architect-inputs to recreate.`,
    );
  }
  if (!Array.isArray(config.documents)) {
    throw new Error("Missing or invalid 'documents' field");
  }
  for (const doc of config.documents) {
    if (!doc || typeof doc !== "object") {
      throw new Error("Each document entry must be an object");
    }
    if (!isArchitectDocumentType(doc.type)) {
      throw new Error(`Unknown document type: ${doc.type}`);
    }
    if (typeof doc.path !== "string" || doc.path.length === 0) {
      throw new Error("Each document must have a non-empty 'path' field");
    }
  }
  if (!Array.isArray(config.freeFormRequirements)) {
    throw new Error("Missing or invalid 'freeFormRequirements' field");
  }
  for (const req of config.freeFormRequirements) {
    if (typeof req !== "string") {
      throw new Error("'freeFormRequirements' must contain only strings");
    }
  }
  if (!isArchitectSkillLevel(config.skillLevel)) {
    throw new Error(
      `Invalid skillLevel: ${config.skillLevel}. Expected one of: ${ARCHITECT_SKILL_LEVELS.join(", ")}`,
    );
  }
}

export function isArchitectDocumentType(value: string): value is ArchitectDocumentType {
  return ARCHITECT_DOCUMENT_TYPES.includes(value as ArchitectDocumentType);
}

export function isArchitectSkillLevel(value: string): value is ArchitectSkillLevel {
  return ARCHITECT_SKILL_LEVELS.includes(value as ArchitectSkillLevel);
}

export function getSelectedInputPaths(config: ArchitectInputsConfig): string[] {
  return config.documents.map((doc) => doc.path);
}

export function createDefaultArchitectInputsConfig(): ArchitectInputsConfig {
  return {
    version: 1,
    documents: [],
    freeFormRequirements: [],
    skillLevel: "intermediate",
  };
}
