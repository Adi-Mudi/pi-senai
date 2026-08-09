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
  lines.push("");
  lines.push(
    "Model rule: NEVER pass the `model` parameter to `subagent()` and never set a model override. " +
      "Subagents must inherit pi's configured default model (the parent session model). " +
      "Passing a model can spawn agents on an unconfigured provider and leave them stuck at login.",
  );
  return lines.join("\n");
}
