/**
 * Brainstorm Dispatcher Layer (Phase 4)
 *
 * Prepares and validates subagent dispatch payloads for brainstorm. The
 * parent LLM is the one that actually calls the `subagent` tool — this
 * module does NOT spawn subagents. It returns a hardened payload the
 * parent then hands to subagent(), and it tracks dispatch counts so the
 * per-brainstorm cap is enforced.
 *
 * Guards (Phase 2) are layered in here:
 *   - guardDispatchCount refuses when the next dispatch would exceed the cap.
 *   - guardArtifactPath refuses any artifact path outside the brainstorm folder.
 *
 * Registry (Phase 3) is layered in here:
 *   - loadBrainstormRegistry surfaces the eligible-agent list.
 *   - isBrainstormEligible checks that the requested agent is allowed.
 *
 * Read-only enforcement (Phase 4):
 *   - enforceReadOnlyTools strips Write/Edit/Bash from the agent's tool list.
 *   - The returned PreparedDispatch.tools is the cleaned allowlist.
 *
 * Audit (Phase 5) writes happen OUTSIDE this module. The dispatcher returns
 * a `startedAt` timestamp + `dispatchNumber` so the audit layer can log
 * the dispatch cleanly when the parent LLM reports back.
 */

import {
	BRAINSTORM_ELIGIBLE_ROLES,
	enforceReadOnlyTools,
	isBrainstormEligible,
	type SenaiRole,
} from "../core/agents-config/suggestions.js";
import {
	guardArtifactPath,
	guardDispatchCount,
	type GuardResult,
} from "./guard.js";
import {
	getBrainstormDir,
} from "../core/paths.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Wall-clock budget per dispatch, in milliseconds. The parent LLM uses
 *  this to decide when to cancel a stalled subagent. */
export const BRAINSTORM_DISPATCH_TIMEOUT_MS = 30_000;

/** Default tools every brainstorm dispatch receives. Specialists may add
 *  more read-only tools via the registry's per-role allowlist. */
export const DEFAULT_DISPATCH_TOOLS: readonly string[] = ["Read", "Grep", "Glob"];

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** What the parent LLM hands us when it wants to dispatch a specialist. */
export interface DispatchRequest {
	/** Agent name — must be brainstorm-eligible AND resolve from the registry. */
	agent: string;
	/** One-paragraph task description. Long copy-pasted files are forbidden. */
	task: string;
	/** Optional: hint for the parent LLM about what summary to expect. */
	expectedOutput?: string;
	/** Optional: explicit tools allowlist (defaults to DEFAULT_DISPATCH_TOOLS). */
	tools?: readonly string[];
	/** Optional: artifact paths the subagent may write. Each is path-guarded. */
	artifactPaths?: readonly string[];
}

/** What the dispatcher returns when validation succeeds. The parent LLM
 *  passes these args to `subagent({ ...subagentArgs, ...overrides })`. */
export interface PreparedDispatch {
	/** Agent name (validated). */
	agent: string;
	/** Resolved role for the agent — used by audit log. */
	role: SenaiRole;
	/** Task description (passed through verbatim; the dispatcher does not edit). */
	task: string;
	/** Expected output hint for the parent LLM (or "" if not provided). */
	expectedOutput: string;
	/** Hardened tools allowlist — Write/Edit/Bash already stripped. */
	tools: string[];
	/** Brainstorm run id (for context). */
	brainstormRunId: string;
	/** Working directory for the subagent — points at the brainstorm folder. */
	cwd: string;
	/** Subagent invocation args. The parent LLM spreads these into subagent(). */
	subagentArgs: {
		agent: string;
		task: string;
		tools: string[];
		/** Hint to the parent: how long to wait before cancelling. */
		timeoutMs: number;
		/** CWD the subagent should run in. */
		cwd: string;
	};
	/** Monotonic dispatch number within this brainstorm (1-based). */
	dispatchNumber: number;
	/** ISO timestamp when the dispatch was prepared. */
	startedAt: string;
}

/** Result of dispatch preparation. */
export type DispatchPrepResult =
	| { ok: true; prepared: PreparedDispatch }
	| { ok: false; reason: string; details?: string[] };

// ─────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────

/** True when the agent name is one of the BRAINSTORM_ELIGIBLE_ROLES roles
 *  or appears in the DEFAULT_AGENTS map as a built-in default. The full
 *  eligibility check also accepts agent names resolved via agents.json —
 *  the registry module handles that, not here. */
function isAgentEligible(agentName: string): boolean {
	// Direct role name match (e.g. "scout-2" — though that's not really an
	// agent name; usually we'd see "scout" / "planner" / "web-research").
	if ((BRAINSTORM_ELIGIBLE_ROLES as readonly string[]).includes(agentName)) {
		return true;
	}
	// Built-in default names from DEFAULT_AGENTS.
	const defaults: Record<string, string> = {
		scout: "scout-1", // also covers scout-2/3/4
		planner: "planner",
		"web-research": "community-researcher",
	};
	const matchedRole = defaults[agentName];
	if (matchedRole && isBrainstormEligible(matchedRole as SenaiRole)) return true;
	return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/** Prepare a specialist dispatch.
 *
 *  Returns `{ok: true, prepared}` when the request is valid and the
 *  parent LLM should proceed to call `subagent(prepared.subagentArgs)`.
 *  Returns `{ok: false, reason}` when any guard refuses the dispatch.
 *
 *  Validates in order:
 *   1. agent name is brainstorm-eligible (registry layer)
 *   2. dispatch count is under cap (guard layer)
 *   3. all artifact paths (if any) live inside the brainstorm folder
 *   4. tools list is read-only (after strip) — empty list is rejected
 *
 *  The dispatcher never calls subagent itself. The parent LLM owns the
 *  actual spawn. */
export function prepareDispatch(
	request: DispatchRequest,
	brainstormRunId: string,
	currentDispatchCount: number,
): DispatchPrepResult {
	// 1. Eligibility check.
	if (!isAgentEligible(request.agent)) {
		return {
			ok: false,
			reason:
				`Agent "${request.agent}" is not brainstorm-eligible.\n` +
				`Eligible agents: scout-1, scout-2, scout-3, scout-4, planner, community-researcher.\n` +
				`Default built-ins: scout, planner, web-research.\n` +
				`Implementer, writers, and security-gate belong to later stages.`,
		};
	}

	// 2. Dispatch count guard.
	const countGuard: GuardResult = guardDispatchCount(currentDispatchCount);
	if (!countGuard.ok) {
		return { ok: false, reason: countGuard.reason! };
	}

	// 3. Artifact path guard (only if paths were provided).
	if (request.artifactPaths && request.artifactPaths.length > 0) {
		for (const p of request.artifactPaths) {
			const pathGuard = guardArtifactPath(p, brainstormRunId);
			if (!pathGuard.ok) {
				return { ok: false, reason: pathGuard.reason! };
			}
		}
	}

	// 4. Tools allowlist — strip forbidden tools.
	const requestedTools = request.tools && request.tools.length > 0
		? request.tools
		: DEFAULT_DISPATCH_TOOLS;
	const cleanedTools = enforceReadOnlyTools(requestedTools);
	if (cleanedTools.length === 0) {
		return {
			ok: false,
			reason:
				`Agent "${request.agent}" has no read-only tools after stripping forbidden ones.\n` +
				`Requested: [${requestedTools.join(", ")}]\n` +
				`Allowed: Read, Grep, Glob, WebSearch, FetchURL.`,
		};
	}

	// 5. Resolve the role from the agent name (for audit logging).
	const role = resolveRoleForAgent(request.agent);

	const now = new Date().toISOString();
	const dispatchNumber = currentDispatchCount + 1;
	const cwd = getBrainstormDir(".", brainstormRunId);

	const prepared: PreparedDispatch = {
		agent: request.agent,
		role,
		task: request.task,
		expectedOutput: request.expectedOutput ?? "",
		tools: cleanedTools,
		brainstormRunId,
		cwd,
		subagentArgs: {
			agent: request.agent,
			task: request.task,
			tools: cleanedTools,
			timeoutMs: BRAINSTORM_DISPATCH_TIMEOUT_MS,
			cwd,
		},
		dispatchNumber,
		startedAt: now,
	};

	return { ok: true, prepared };
}

/** Resolve a SenaiRole from an agent name. Used by audit logging and tests.
 *  Returns the best guess based on built-in defaults + role name match. */
export function resolveRoleForAgent(agentName: string): SenaiRole {
	// Direct role name match.
	if ((BRAINSTORM_ELIGIBLE_ROLES as readonly string[]).includes(agentName)) {
		return agentName as SenaiRole;
	}
	// Built-in default → role mapping.
	const map: Record<string, SenaiRole> = {
		scout: "scout-2", // generic scout → scout-2 (code search) by default
		planner: "planner",
		"web-research": "community-researcher",
	};
	if (map[agentName]) return map[agentName];
	// Fallback — should never happen for an eligible agent.
	return "scout-2";
}

/** Helper for the parent LLM: format the prepared dispatch as a prompt
 *  block. Includes all subagent invocation args the parent needs to make
 *  the call. */
export function formatPreparedDispatch(prepared: PreparedDispatch): string {
	return [
		"## Prepared dispatch",
		"",
		`Agent: \`${prepared.agent}\` (role: ${prepared.role})`,
		`Dispatch #: ${prepared.dispatchNumber}`,
		`Timeout: ${prepared.subagentArgs.timeoutMs}ms`,
		`CWD: ${prepared.cwd}`,
		"",
		"Tools (read-only):",
		prepared.tools.map((t) => `- ${t}`).join("\n"),
		"",
		"Task:",
		prepared.task,
		prepared.expectedOutput
			? `\nExpected output: ${prepared.expectedOutput}`
			: "",
		"",
		"Call:",
		"```",
		`subagent({`,
		`  agent: "${prepared.subagentArgs.agent}",`,
		`  task: ${JSON.stringify(prepared.subagentArgs.task)},`,
		`  tools: ${JSON.stringify(prepared.subagentArgs.tools)},`,
		`  cwd: "${prepared.subagentArgs.cwd}",`,
		`})`,
		"```",
	].join("\n");
}
