// Layer 0 — pure types and a path helper used by core/agents-config/.
// The I/O parts of agent discovery live in agents/discovery.ts (Layer 2).
import * as path from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export type AgentSource = "project" | "user" | "builtin";

export interface DiscoveredAgent {
	name: string;
	description: string;
	source: AgentSource;
	filePath?: string;
}

/** Returns the absolute path to Pi's user-level agents directory. */
export function getUserAgentsDir(): string {
	return path.join(getAgentDir(), "agents");
}
