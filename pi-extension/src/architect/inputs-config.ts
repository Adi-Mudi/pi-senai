import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../io/atomic-write.js";

export const ARCHITECT_INPUTS_CONFIG_FILE = "architect-inputs.json";

export const ARCHITECT_INPUTS_CONFIG_COMMENT =
  "Senai config: documents and constraints used to derive the project architecture. Managed by /senai-configure-architect-inputs.";

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
  "feasibility",
] as const;

export type ArchitectDocumentType = (typeof ARCHITECT_DOCUMENT_TYPES)[number];

export interface ArchitectDocumentInput {
  type: ArchitectDocumentType;
  path: string;
}

export interface ArchitectInputsConfig {
  version: 1;
  documents: ArchitectDocumentInput[];
  additionalConstraints: string[];
}

export function getArchitectInputsConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "senai", ARCHITECT_INPUTS_CONFIG_FILE);
}

export function loadArchitectInputsConfig(cwd: string): ArchitectInputsConfig | null {
  const configPath = getArchitectInputsConfigPath(cwd);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as ArchitectInputsConfig;
    delete (parsed as unknown as Record<string, unknown>)._comment;
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
  atomicWriteJson(getArchitectInputsConfigPath(cwd), {
    _comment: ARCHITECT_INPUTS_CONFIG_COMMENT,
    ...config,
  });
}

export function validateArchitectInputsConfig(config: ArchitectInputsConfig): void {
  if (config.version !== CURRENT_ARCHITECT_INPUTS_CONFIG_VERSION) {
    throw new Error(
      `Unsupported architect-inputs.json version: ${config.version}. Expected version: ${CURRENT_ARCHITECT_INPUTS_CONFIG_VERSION}. Run /senai-configure-architect-inputs to recreate.`,
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
  if (!Array.isArray(config.additionalConstraints)) {
    throw new Error("Missing or invalid 'additionalConstraints' field");
  }
  for (const constraint of config.additionalConstraints) {
    if (typeof constraint !== "string") {
      throw new Error("'additionalConstraints' must contain only strings");
    }
  }
}

export function isArchitectDocumentType(value: string): value is ArchitectDocumentType {
  return ARCHITECT_DOCUMENT_TYPES.includes(value as ArchitectDocumentType);
}

export function getSelectedInputPaths(config: ArchitectInputsConfig): string[] {
  return config.documents.map((doc) => doc.path);
}

export function createDefaultArchitectInputsConfig(): ArchitectInputsConfig {
  return {
    version: 1,
    documents: [],
    additionalConstraints: [],
  };
}
