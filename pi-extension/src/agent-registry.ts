import type { AgentConfig } from "./agent-config.js";
import { ORCHESTRA_ROLES, DEFAULT_AGENTS } from "./agent-suggestions.js";

export function buildAgentRegistryBlock(config: AgentConfig | null): string {
  const lines = [
    `## Agent Registry`,
    ``,
    `For this project, use these agent names when spawning subagents:`,
    ``,
  ];

  for (const role of ORCHESTRA_ROLES) {
    const agentName = config?.agents?.[role] ?? DEFAULT_AGENTS[role];
    const marker = config?.agents?.[role] ? "→" : "(default) →";
    lines.push(`- ${role} ${marker} ${agentName}`);
  }

  lines.push("");
  lines.push("If a role is not listed above, use the default agent name.");
  return lines.join("\n");
}
