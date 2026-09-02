import * as fs from "node:fs";
import * as path from "node:path";
import { SENAI_ROLES, type SenaiRole } from "./agent-suggestions.js";
import { atomicWriteJson } from "./atomic-write.js";

export const AGENTS_FILES_CONFIG_FILE = "agents_files.json";

export const AGENTS_FILES_CONFIG_COMMENT =
  "Senai config: per-role truth document (primary) and comparison documents (reads). Managed by /senai-configure-agents-files.";

export interface AgentFilesDocuments {
  primary?: string;
  reads?: string[];
}

export interface AgentsFilesConfig {
  version: number;
  documents: Partial<Record<SenaiRole, AgentFilesDocuments>>;
}

export function getAgentsFilesConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "senai", AGENTS_FILES_CONFIG_FILE);
}

export function migrateAgentsFilesConfig(
  config: AgentsFilesConfig,
): AgentsFilesConfig {
  if (config.version >= 2) return config;
  return { version: 2, documents: config.documents ?? {} };
}

export function loadAgentsFilesConfig(cwd: string): AgentsFilesConfig | null {
  const configPath = getAgentsFilesConfigPath(cwd);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as AgentsFilesConfig;
    delete (parsed as unknown as Record<string, unknown>)._comment;
    validateAgentsFilesConfig(parsed);
    const migrated = migrateAgentsFilesConfig(parsed);
    if (migrated.version !== 2) {
      throw new Error(`Unsupported agents_files config version ${migrated.version}`);
    }
    return migrated;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid agents_files config at ${configPath}: ${err.message}`);
  }
}

export function saveAgentsFilesConfig(cwd: string, config: AgentsFilesConfig): void {
  atomicWriteJson(getAgentsFilesConfigPath(cwd), {
    _comment: AGENTS_FILES_CONFIG_COMMENT,
    ...config,
    version: 2,
  });
}

export function validateAgentsFilesConfig(config: AgentsFilesConfig): void {
  if (typeof config.version !== "number" || config.version < 1) {
    throw new Error("Missing or invalid 'version' field; expected 2");
  }
  if (!config.documents || typeof config.documents !== "object") {
    throw new Error("Missing or invalid 'documents' field");
  }
  for (const role of Object.keys(config.documents)) {
    if (!SENAI_ROLES.includes(role as SenaiRole)) {
      throw new Error(`Unknown role "${role}"`);
    }
    const docs = config.documents[role as SenaiRole];
    if (docs?.primary !== undefined && typeof docs.primary !== "string") {
      throw new Error(`documents.${role}.primary must be a string`);
    }
    if (docs?.reads !== undefined) {
      if (!Array.isArray(docs.reads)) {
        throw new Error(`documents.${role}.reads must be an array`);
      }
      for (const r of docs.reads) {
        if (typeof r !== "string") {
          throw new Error(`documents.${role}.reads must contain only strings`);
        }
      }
    }
  }
}
