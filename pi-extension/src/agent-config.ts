import * as fs from "node:fs";
import * as path from "node:path";
import { getUserAgentsDir } from "./agent-discovery.js";
import {
  ORCHESTRA_ROLES,
  ROLE_LABELS,
  type OrchestraRole,
  DEFAULT_AGENTS,
} from "./agent-suggestions.js";

export const CONFIG_DIR = ".pi/orchestra";
export const CONFIG_FILE = "agents.json";

export interface AgentConfig {
  version: number;
  agents: Partial<Record<OrchestraRole, string>>;
}

export function getConfigPath(cwd: string): string {
  return path.join(cwd, CONFIG_DIR, CONFIG_FILE);
}

export function loadAgentConfig(cwd: string): AgentConfig | null {
  const configPath = getConfigPath(cwd);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as AgentConfig;
    validateAgentConfig(parsed);
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid agent config at ${configPath}: ${err.message}`);
  }
}

export function saveAgentConfig(cwd: string, config: AgentConfig): void {
  const configPath = getConfigPath(cwd);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

export function validateAgentConfig(config: AgentConfig): void {
  if (typeof config.version !== "number") {
    throw new Error("Missing or invalid 'version' field");
  }
  if (!config.agents || typeof config.agents !== "object") {
    throw new Error("Missing or invalid 'agents' field");
  }
  for (const role of Object.keys(config.agents)) {
    if (!ORCHESTRA_ROLES.includes(role as OrchestraRole)) {
      throw new Error(
        `Unknown role "${role}". Allowed roles: ${ORCHESTRA_ROLES.map((r) => `${ROLE_LABELS[r]} (${r})`).join(", ")}`,
      );
    }
  }
}

export function resolveAgentName(config: AgentConfig | null, role: OrchestraRole): string {
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
        `Custom agent "${agentName}" for role ${ROLE_LABELS[role as OrchestraRole]} (${role}) not found. Expected ${projectPath} or ${userPath}.`,
      );
    }
  }
  return errors;
}
