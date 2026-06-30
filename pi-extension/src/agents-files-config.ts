import * as fs from "node:fs";
import * as path from "node:path";
import { ORCHESTRA_ROLES, type OrchestraRole } from "./agent-suggestions.js";

export const AGENTS_FILES_CONFIG_FILE = "agents_files.json";

export interface AgentFilesDocuments {
  primary?: string;
  reads?: string[];
}

export interface AgentsFilesConfig {
  version: number;
  documents: Partial<Record<OrchestraRole, AgentFilesDocuments>>;
}

export function getAgentsFilesConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "orchestra", AGENTS_FILES_CONFIG_FILE);
}

export function loadAgentsFilesConfig(cwd: string): AgentsFilesConfig | null {
  const configPath = getAgentsFilesConfigPath(cwd);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as AgentsFilesConfig;
    validateAgentsFilesConfig(parsed);
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid agents_files config at ${configPath}: ${err.message}`);
  }
}

export function saveAgentsFilesConfig(cwd: string, config: AgentsFilesConfig): void {
  const configPath = getAgentsFilesConfigPath(cwd);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

export function validateAgentsFilesConfig(config: AgentsFilesConfig): void {
  if (typeof config.version !== "number") {
    throw new Error("Missing or invalid 'version' field");
  }
  if (!config.documents || typeof config.documents !== "object") {
    throw new Error("Missing or invalid 'documents' field");
  }
  for (const role of Object.keys(config.documents)) {
    if (!ORCHESTRA_ROLES.includes(role as OrchestraRole)) {
      throw new Error(`Unknown role "${role}"`);
    }
    const docs = config.documents[role as OrchestraRole];
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
