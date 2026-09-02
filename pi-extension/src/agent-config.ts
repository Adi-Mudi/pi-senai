import * as fs from "node:fs";
import * as path from "node:path";
import { getUserAgentsDir } from "./agent-discovery.js";
import {
  SENAI_ROLES,
  ROLE_LABELS,
  type SenaiRole,
  DEFAULT_AGENTS,
} from "./agent-suggestions.js";
import { atomicWriteJson } from "./atomic-write.js";

export const CONFIG_DIR = ".pi/senai";
export const CONFIG_FILE = "agents.json";

export const CONFIG_COMMENT =
  "Senai config: maps each Senai role to an agent name. Managed by /senai-generate-architect and /senai-generate-sub-agents (manual override: /senai-configure-agents). Hand-edit only if you know the role names.";

export interface AgentConfig {
  version: number;
  agents: Partial<Record<SenaiRole, string>>;
}

export function getConfigPath(cwd: string): string {
  return path.join(cwd, CONFIG_DIR, CONFIG_FILE);
}

export function loadAgentConfig(cwd: string): AgentConfig | null {
  const configPath = getConfigPath(cwd);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as AgentConfig;
    delete (parsed as unknown as Record<string, unknown>)._comment;
    validateAgentConfig(parsed);
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid agent config at ${configPath}: ${err.message}`);
  }
}

export function saveAgentConfig(cwd: string, config: AgentConfig): void {
  atomicWriteJson(getConfigPath(cwd), { _comment: CONFIG_COMMENT, ...config });
}

export function validateAgentConfig(config: AgentConfig): void {
  if (typeof config.version !== "number") {
    throw new Error("Missing or invalid 'version' field");
  }
  if (!config.agents || typeof config.agents !== "object" || Array.isArray(config.agents)) {
    throw new Error("Missing or invalid 'agents' field");
  }
  for (const [role, agentName] of Object.entries(config.agents)) {
    if (agentName !== undefined && typeof agentName !== "string") {
      throw new Error(`agents.${role} must be a string`);
    }
    if (!SENAI_ROLES.includes(role as SenaiRole)) {
      throw new Error(
        `Unknown role "${role}". Allowed roles: ${SENAI_ROLES.map((r) => `${ROLE_LABELS[r]} (${r})`).join(", ")}`,
      );
    }
  }
}

export function resolveAgentName(config: AgentConfig | null, role: SenaiRole): string {
  if (config?.agents?.[role]) return config.agents[role]!;
  return DEFAULT_AGENTS[role];
}

export function validateMappedAgents(cwd: string, config: AgentConfig): string[] {
  const errors: string[] = [];
  for (const [role, agentName] of Object.entries(config.agents)) {
    if (!agentName) continue;

    const projectPath = path.join(cwd, ".pi", "agents", `${agentName}.md`);
    const userPath = path.join(getUserAgentsDir(), `${agentName}.md`);
    const isBuiltin = ["scout", "planner", "worker", "reviewer", "security-auditor"].includes(
      agentName,
    );

    if (!isBuiltin && !fs.existsSync(projectPath) && !fs.existsSync(userPath)) {
      errors.push(
        `Custom agent "${agentName}" for role ${ROLE_LABELS[role as SenaiRole]} (${role}) not found. Expected ${projectPath} or ${userPath}.`,
      );
    }
  }
  return errors;
}
