import { loadAgentConfig, type AgentConfig } from "../core/agents-config/config.js";
import { DEFAULT_AGENTS, SENAI_ROLES, WEB_TOOLS, WEB_TOOL_ALLOWED_ROLES } from "../core/agents-config/suggestions.js";
import { discoverAgents, parseAgentFileFull } from "../core/agents-config/discovery.js";
import { loadState } from "../core/state.js";

/** Tool calls that spawn or re-spawn subagents. */
const GUARDED_TOOLS = new Set(["subagent", "subagent_resume"]);

/** Pi's built-in agent names. Spawning one of these by accident loads a
 *  generic read-only agent without the role's mandate and tools. */
const BUILTIN_AGENT_NAMES = new Set(["scout", "planner", "worker", "reviewer", "security-auditor", "web-research"]);

export interface SpawnGuardBlock {
  block: true;
  reason: string;
}

/** Deterministic guard against wrong-agent spawns during an active senai run.
 *
 *  The 2026-08-20 incident: the parent spawned `agent: "planner"` — the bare
 *  role name — which loaded pi's built-in read-only planner instead of the
 *  mapped generated agent. The built-in has no write tool, so the planner
 *  could never write plan.md and the run stalled. Prompt rules alone did not
 *  stop this, so the tool call is now blocked with the correct name.
 *
 *  Returns a block object, or undefined to allow the call. Never throws:
 *  any config/state problem means the guard steps aside. */
export function guardSpawnCall(
  toolName: string,
  input: Record<string, unknown> | undefined,
  cwd: string,
): SpawnGuardBlock | undefined {
  if (!GUARDED_TOOLS.has(toolName)) return undefined;

  let runActive = false;
  try {
    const state = loadState(cwd);
    runActive = state.currentStage !== "none" && state.currentStage !== "delivered";
  } catch {
    return undefined;
  }
  if (!runActive) return undefined;

  let config;
  try {
    config = loadAgentConfig(cwd);
  } catch {
    return undefined;
  }
  if (!config) return undefined;

  const agent = String(input?.agent ?? "").trim();

  const customMappings = SENAI_ROLES.filter((role) => {
    const mapped = config.agents[role];
    return mapped && mapped !== DEFAULT_AGENTS[role];
  });

  if (!agent) {
    if (customMappings.length === 0) return undefined;
    return {
      block: true,
      reason:
        `Missing 'agent' parameter. A bare spawn runs as a default agent without the role's mandate and tools. ` +
        `Use the exact mapped name from the Agent Registry block, e.g. agent: "${config.agents[customMappings[0]]}".`,
    };
  }

  // Only block names that collide with a senai role or a built-in default
  // whose role was remapped. Unknown custom names pass through.
  const collisions: string[] = [];
  for (const role of customMappings) {
    if (agent === role || agent === DEFAULT_AGENTS[role]) {
      collisions.push(`${role} → "${config.agents[role]}"`);
    }
  }
  if (collisions.length > 0) {
    const isKnownBareName =
      BUILTIN_AGENT_NAMES.has(agent) || (SENAI_ROLES as readonly string[]).includes(agent);
    if (isKnownBareName) {
      return {
        block: true,
        reason:
          `"${agent}" is a bare role/built-in name — it loads a built-in read-only agent that cannot write artifacts. ` +
          `Use the mapped agent for the role you are spawning: ${collisions.join(", ")}.`,
      };
    }
  }

  // The name checks passed — now enforce the web tool lock on the resolved
  // agent's frontmatter (hard block, same rule doctor audits).
  return guardWebToolLock(agent, config, cwd);
}

/** Web tool lock, enforced at spawn time. Hard-blocks the spawn when the
 *  spawned agent is custom-mapped to a senai role that may not carry web
 *  tools and its frontmatter tools include WebSearch / FetchURL.
 *
 *  Skip rules mirror doctor's checkWebToolLock exactly (same source of
 *  truth: WEB_TOOLS / WEB_TOOL_ALLOWED_ROLES in core/agents-config):
 *  default mappings and built-ins are out of scope — the project has not
 *  customized the role yet. Never throws; any discovery problem means the
 *  guard steps aside. */
function guardWebToolLock(
  agent: string,
  config: AgentConfig,
  cwd: string,
): SpawnGuardBlock | undefined {
  const role = SENAI_ROLES.find(
    (r) => config.agents[r] === agent && config.agents[r] !== DEFAULT_AGENTS[r],
  );
  if (!role || WEB_TOOL_ALLOWED_ROLES.has(role)) return undefined;

  let filePath: string | undefined;
  try {
    filePath = discoverAgents(cwd).find((a) => a.name === agent)?.filePath;
  } catch {
    return undefined;
  }
  if (!filePath) return undefined;

  const tools = parseAgentFileFull(filePath)?.tools;
  if (!tools || tools.length === 0) return undefined;

  const offending = tools.filter((t) => WEB_TOOLS.has(t.toLowerCase()));
  if (offending.length === 0) return undefined;

  return {
    block: true,
    reason:
      `Web tool lock VIOLATED: role "${role}" agent "${agent}" carries ${offending.join(", ")}. ` +
      `Only the "discussion" role may carry WebSearch / FetchURL. ` +
      `Remove the web tool(s) from ${filePath}'s frontmatter tools: line, or remap the role.`,
  };
}
