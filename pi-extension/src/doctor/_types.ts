import type { AgentFrontmatter } from "../agents/discovery.js";
import { DEFAULT_AGENTS } from "../agents/suggestions.js";

// Re-export so doctor checks can compare against the canonical default
// without re-importing from suggestions.ts in every file.
export { DEFAULT_AGENTS };
import { GENERATED_ROLES } from "../agents/generator.js";
import { type SenaiRole } from "../agents/suggestions.js";

export type DiagnosticStatus = "ok" | "warning" | "error" | "info";

export interface DiagnosticItem {
	status: DiagnosticStatus;
	message: string;
	details?: string[];
}

export interface DiagnosticSection {
	title: string;
	items: DiagnosticItem[];
}

export interface DiagnosticReport {
	ok: boolean;
	summary: { ok: number; warning: number; error: number; info: number };
	sections: DiagnosticSection[];
}

export interface ResolvedAgent {
	name: string;
	source: "project" | "user" | "builtin" | "not found";
	filePath: string | null;
	frontmatter: AgentFrontmatter | null;
	shadowed: Array<{ source: "project" | "user" | "builtin"; filePath?: string }>;
}

export const BUILTIN_AGENT_NAMES = Array.from(new Set(Object.values(DEFAULT_AGENTS)));

// Tool requirements for the 14 generator roles come from GENERATED_ROLES
// (single source of truth); architecture-bound roles are listed explicitly.
export const ROLE_REQUIRED_TOOLS: Partial<Record<SenaiRole, string[]>> = {
	...Object.fromEntries(GENERATED_ROLES.map((def) => [def.role, def.tools])),
	"scout-1": ["read", "write"],
	planner: ["read", "write"],
	"reviewer-correctness": ["read", "write"],
	"reviewer-security": ["read", "write"],
	"reviewer-tests": ["read", "write"],
	implementer: ["read", "write", "edit"],
	"code-review": ["read", "write"],
};

// Roles that only report via their final message and never write artifact
// files. All artifact-writing roles require (and may have) the write tool.
// Currently empty: linter and full-test write report artifacts since
// generator v3. Keep the mechanism for future read-only roles.
export const READONLY_ROLES: SenaiRole[] = [];

// Strict web-tool lock. Only the discussion role is allowed to carry
// WebSearch + FetchURL. Used by /senai-discussion and the plan-stage
// consolidation. Any other role with web tools is an ERROR — having two
// agents reach the web confuses the orchestra about who is responsible for
// external knowledge. The lock is enforced by `checkWebToolLock` below.
//
// Tool names are stored lowercase to match the `KNOWN_TOOL_NAMES` convention
// (see `isKnownToolName()` in _helpers.ts which lowercases on lookup).
export const WEB_TOOLS: ReadonlySet<string> = new Set(["websearch", "fetchurl"]);

export const WEB_TOOL_ALLOWED_ROLES: ReadonlySet<SenaiRole> = new Set(["discussion"]);

export const CONFLICTING_READONLY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /fix only/i, reason: "Agent mandate is 'fix only'" },
	{ pattern: /do not build/i, reason: "Agent mandate is 'do not build'" },
	{ pattern: /do not write/i, reason: "Agent mandate is 'do not write'" },
	{ pattern: /do not implement/i, reason: "Agent mandate is 'do not implement'" },
	{ pattern: /only diagnoses/i, reason: "Agent is diagnostic-only" },
	{ pattern: /only reviews/i, reason: "Agent is review-only" },
];

// Roles verified by the mandate layer: roles the suggestion rules
// (ROLE_TYPE_RULES in document-suggestions.ts) do not cover. scout-3 is
// excluded per user decision — it keeps existence-only checking.
export const MANDATE_CHECK_ROLES: SenaiRole[] = ["scout-2", "plan-overview"];

export const MANDATE_STOPWORDS: Set<string> = new Set([
	"the", "and", "for", "with", "that", "this", "from", "into", "your", "their",
	"them", "they", "will", "shall", "must", "before", "after", "against", "about",
	"report", "write", "reads", "read", "user", "agent", "role",
]);

export const KNOWN_TOOL_NAMES: Set<string> = new Set([
	"read", "write", "edit", "bash", "grep", "find", "ls",
	"askuserquestion", "intercom", "subagent",
	"taskcreate", "taskexecute", "taskget", "tasklist", "taskoutput", "taskstop", "taskupdate",
	"websearch", "fetchurl",
]);

export const VALID_THINKING_LEVELS: Set<string> = new Set([
	"off", "minimal", "low", "medium", "high", "xhigh", "max",
]);
