import type { AgentConfig } from "./agent-config.js";
import { SENAI_ROLES, DEFAULT_AGENTS, ROLE_LABELS } from "./agent-suggestions.js";

export function buildAgentRegistryBlock(config: AgentConfig | null): string {
  const lines = [
    `## Agent Registry`,
    ``,
    `For this project, use these agent names when spawning subagents:`,
    ``,
  ];

  for (const role of SENAI_ROLES) {
    const mapped = config?.agents?.[role];
    const agentName = mapped || DEFAULT_AGENTS[role];
    const marker = mapped ? "→" : "(default) →";
    lines.push(`- ${ROLE_LABELS[role]} (${role}) ${marker} ${agentName}`);
  }

  lines.push("");
  lines.push("If a role is not listed above, use the default agent name.");
  return lines.join("\n");
}
