import type { AgentConfig } from "../core/agents-config/config.js";
import { SENAI_ROLES, DEFAULT_AGENTS, ROLE_LABELS } from "../core/agents-config/suggestions.js";

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
  lines.push(
    "Spawn rules: ALWAYS pass the `agent` parameter with the mapped agent name above — a spawn without `agent` runs as a default agent without the role's mandate and tools. " +
      "Pass artifact file paths in the task; the subagent reads files itself. Do not paste long file contents or full mission text — use the mission file path when one is given. " +
      "After spawning, do NOT poll: no repeated status checks, task updates, or sleeps. Completion and stall notifications arrive automatically. " +
      "After ANY writer subagent reports completion, immediately verify its artifact file exists before spawning the next agent; if it is missing, respawn the agent with the failure as feedback. " +
      "If a subagent stalls or stops progressing: call `subagent_interrupt` once and wait; if it still has not exited, tell the user to close its pane manually (no kill tool exists yet), then respawn with a unique name (e.g. a '-retry' suffix). Never leave two agents of the same role running at once. " +
      "NEVER do a subagent's job yourself (reading its inputs or writing its artifacts). If it cannot finish, fix the spawn (agent, tools, task) and relaunch.",
  );
  return lines.join("\n");
}
