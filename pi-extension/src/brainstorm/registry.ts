/**
 * Brainstorm Registry Layer (Phase 3)
 *
 * Pure functions that load and query the brainstorm-eligible agent registry.
 *
 * Responsibilities:
 *   1. Load .pi/senai/agents.json + discovered agents from .pi/agents/*.md.
 *   2. Filter to the 6 brainstorm-eligible roles (BRAINSTORM_ELIGIBLE_ROLES).
 *   3. Match a user topic to the best specialist via keyword scoring.
 *   4. Render the registry as a markdown block for the stage prompt.
 *
 * This module does NOT spawn subagents — that lives in dispatcher.ts (Phase 4).
 * It does NOT write to the audit log — that lives in audit.ts (Phase 5).
 *
 * Pure where possible; loadBrainstormRegistry is the only I/O entry point.
 */

import { loadAgentConfig, type AgentConfig } from "../core/agents-config/config.js";
import { discoverAgents } from "../agents/discovery.js";
import {
	BRAINSTORM_ELIGIBLE_ROLES,
	BRAINSTORM_ROLE_KEYWORDS,
	DEFAULT_AGENTS,
	type SenaiRole,
} from "../core/agents-config/suggestions.js";

/** One brainstorm-eligible agent, ready to be dispatched. */
export interface BrainstormEligibleAgent {
	role: SenaiRole;
	/** Resolved agent name (mapped in agents.json, suggested, or default). */
	agentName: string;
	/** Short mandate hint, used by buildRegistryBlock. */
	mandate: string;
	/** Tool allowlist the agent receives at dispatch time (Phase 4 strips
	 *  Write/Edit). Surfaced here so the registry block + audit log agree. */
	tools: readonly string[];
	/** Keywords matchSpecialist uses to score topics for this role. */
	matchKeywords: readonly string[];
}

/** Static mandate hints per role. Kept short — the actual agent body has the
 *  full mandate; the registry block just labels the role for the parent LLM. */
const ROLE_MANDATE: Record<SenaiRole, string> = {
	"scout-1": "Architecture / big-picture reconnaissance",
	"scout-2": "Coder search / pattern lookup in the codebase",
	"scout-3": "Risk and dependency audit",
	"scout-4": "PRD / documentation audit",
	planner: "Trade-off analysis and option comparison",
	"community-researcher": "Read-only web research (official docs, community)",
	// Roles outside BRAINSTORM_ELIGIBLE_ROLES get empty mandates so a stray
	// ineligible agent can never be accidentally labeled as brainstorm-ready.
	"plan-overview": "",
	"reviewer-correctness": "",
	"reviewer-security": "",
	"reviewer-tests": "",
	"test-skeleton": "",
	implementer: "",
	linter: "",
	"code-review": "",
	"full-test": "",
	"readme-writer": "",
	"changelog-writer": "",
	"api-docs-writer": "",
	"other-docs-writer": "",
	"security-gate": "",
	archive: "",
	discussion: "",
};

/** Default tool allowlist per role — the read-only subset brainstorm allows.
 *  Phase 4 (dispatcher) strips Write/Edit from any agent that has them, but
 *  the registry advertises the intended read-only contract. */
const ROLE_DEFAULT_TOOLS: Record<SenaiRole, readonly string[]> = {
	"scout-1": ["Read", "Grep", "Glob"],
	"scout-2": ["Read", "Grep", "Glob"],
	"scout-3": ["Read", "Grep", "Glob"],
	"scout-4": ["Read", "Grep", "Glob"],
	planner: ["Read", "Grep", "Glob"],
	"community-researcher": ["Read", "Grep", "WebSearch", "FetchURL"],
	// Ineligible roles — present so the Record type stays exhaustive.
	"plan-overview": [],
	"reviewer-correctness": [],
	"reviewer-security": [],
	"reviewer-tests": [],
	"test-skeleton": [],
	implementer: [],
	linter: [],
	"code-review": [],
	"full-test": [],
	"readme-writer": [],
	"changelog-writer": [],
	"api-docs-writer": [],
	"other-docs-writer": [],
	"security-gate": [],
	archive: [],
	discussion: [],
};

// ─────────────────────────────────────────────────────────────────────────
// Load + filter
// ─────────────────────────────────────────────────────────────────────────

/** Resolve the agent name for a given role using (in order):
 *  1. The user's agents.json mapping.
 *  2. The default agent name from DEFAULT_AGENTS.
 *
 *  Returns null when no name can be resolved (e.g. agents.json references a
 *  role it does not cover). */
function resolveAgentName(
	role: SenaiRole,
	config: AgentConfig | null,
): string | null {
	if (config?.agents?.[role]) return config.agents[role];
	if (DEFAULT_AGENTS[role]) return DEFAULT_AGENTS[role];
	return null;
}

/** Load the brainstorm-eligible registry for a project.
 *
 *  The registry contains one entry per BRAINSTORM_ELIGIBLE_ROLES role,
 *  filtered by what the project has configured. Roles the user has not
 *  mapped and that have no default agent are skipped (they cannot be
 *  dispatched anyway).
 *
 *  Returns an empty list when no agents.json exists AND no defaults
 *  resolve — the parent LLM still proceeds, just with no specialist
 *  options in the dispatch tree. */
export function loadBrainstormRegistry(cwd: string): BrainstormEligibleAgent[] {
	const config = loadAgentConfig(cwd);
	const discovered = discoverAgents(cwd);
	const eligible: BrainstormEligibleAgent[] = [];

	for (const role of BRAINSTORM_ELIGIBLE_ROLES) {
		const agentName = resolveAgentName(role, config);
		if (!agentName) continue;

		// If the user has customized this role to point at a discovered agent,
		// we trust the custom name. Otherwise the default resolves to a
		// built-in (scout / planner / web-research) that pi provides.
		const discoveredMatch = discovered.find((a) => a.name === agentName);
		if (discoveredMatch || config?.agents?.[role]) {
			eligible.push({
				role,
				agentName,
				mandate: ROLE_MANDATE[role],
				tools: ROLE_DEFAULT_TOOLS[role],
				matchKeywords: BRAINSTORM_ROLE_KEYWORDS[role],
			});
		} else if (DEFAULT_AGENTS[role]) {
			// Built-in default — kept even though discoverAgents does not list it.
			eligible.push({
				role,
				agentName,
				mandate: ROLE_MANDATE[role],
				tools: ROLE_DEFAULT_TOOLS[role],
				matchKeywords: BRAINSTORM_ROLE_KEYWORDS[role],
			});
		}
	}
	return eligible;
}

// ─────────────────────────────────────────────────────────────────────────
// Match
// ─────────────────────────────────────────────────────────────────────────

/** Score a single agent against a topic. Higher = better match. 0 = no match.
 *  Match is a sum of keyword hits — each hit adds 1, plus a +1 bonus when
 *  the topic mentions a "primary" keyword at the start of the keyword list. */
function scoreAgent(agent: BrainstormEligibleAgent, topic: string): number {
	const lower = topic.toLowerCase();
	if (!lower) return 0;
	let score = 0;
	for (const kw of agent.matchKeywords) {
		if (lower.includes(kw)) score += 1;
	}
	// Boost when the FIRST keyword matches — these are the most diagnostic.
	if (agent.matchKeywords.length > 0 && lower.includes(agent.matchKeywords[0])) {
		score += 1;
	}
	return score;
}

/** Minimum score for matchSpecialist to return a non-null result. A topic
 *  must mention at least one keyword to qualify. */
export const MATCH_SCORE_THRESHOLD = 1;

/** Find the best specialist for a topic. Returns null when no eligible
 *  agent matches above the threshold. The parent LLM uses the suggestion
 *  but remains the final decider. */
export function matchSpecialist(
	registry: BrainstormEligibleAgent[],
	topic: string,
): BrainstormEligibleAgent | null {
	if (!topic || registry.length === 0) return null;
	let best: BrainstormEligibleAgent | null = null;
	let bestScore = 0;
	for (const agent of registry) {
		const score = scoreAgent(agent, topic);
		if (score > bestScore) {
			bestScore = score;
			best = agent;
		}
	}
	if (bestScore < MATCH_SCORE_THRESHOLD) return null;
	return best;
}

/** Return the top-N agents sorted by score. Useful for prompts that want
 *  a ranked list rather than a single suggestion. */
export function rankSpecialists(
	registry: BrainstormEligibleAgent[],
	topic: string,
	limit: number = 3,
): BrainstormEligibleAgent[] {
	if (!topic || registry.length === 0) return [];
	return [...registry]
		.map((a) => ({ agent: a, score: scoreAgent(a, topic) }))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((x) => x.agent);
}

// ─────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────

/** Render the registry as a markdown block the parent LLM can read. The
 *  block is injected into the stage prompt by commands/brainstorm.ts.
 *
 *  Format:
 *    ## Brainstorm-eligible agents
 *
 *    The following agents may be dispatched during brainstorm for read-only
 *    research. Use `subagent({ agent: <name>, task: <one-paragraph task>,
 *    expected_output: <summary> })`. Max 3 dispatches per brainstorm.
 *
 *    | Role | Agent | Mandate | Match keywords |
 *    | scout-1 | scout | architecture recon | architecture, system, big-picture |
 *    | ...
 *
 *    Suggested match for "<topic>": <role> → <agent>
 *    (or: no specialist matched — answer inline.)
 */
export function buildRegistryBlock(
	registry: BrainstormEligibleAgent[],
	topic: string = "",
): string {
	if (registry.length === 0) {
		return [
			"## Brainstorm-eligible agents",
			"",
			"(no brainstorm-eligible agents configured — answer inline; no subagent dispatch.)",
		].join("\n");
	}

	const lines: string[] = [
		"## Brainstorm-eligible agents",
		"",
		"The following specialists may be dispatched for read-only research during this brainstorm.",
		"Use `subagent({ agent: <name>, task: <one-paragraph task>, expected_output: <short summary> })`.",
		"Max 3 dispatches per brainstorm. Tools are read-only (Read/Grep/Glob/WebSearch/FetchURL).",
		"",
		"| Role | Agent | Mandate | Match keywords |",
		"| --- | --- | --- | --- |",
	];
	for (const a of registry) {
		lines.push(
			`| ${a.role} | \`${a.agentName}\` | ${a.mandate} | ${a.matchKeywords.slice(0, 5).join(", ")} |`,
		);
	}

	const top = rankSpecialists(registry, topic, 1);
	if (top.length > 0 && topic) {
		lines.push("");
		lines.push(`**Suggested match for "${topic}":** ${top[0].role} → \`${top[0].agentName}\``);
		lines.push("(The parent LLM is the final decider — may choose a different specialist or answer inline.)");
	} else if (topic) {
		lines.push("");
		lines.push(`No specialist matched "${topic}" — answer inline or pick a generic scout.`);
	}
	return lines.join("\n");
}
