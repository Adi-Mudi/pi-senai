/**
 * Brainstorm Guard Layer (Phase 2)
 *
 * Pure functions that return {ok, reason} for the four brainstorm checkpoints.
 * Every guard is intentionally side-effect-free — callers wire them in at
 * the right place and surface the reason to the user.
 *
 * Guards:
 *   1. guardSeedInput      — refuse /senai-brainstorm with empty seed.
 *   2. guardBriefContent   — refuse finalize when brief still has _TBD_ placeholders.
 *   3. guardArtifactPath   — refuse writes outside the dedicated brainstorm folder.
 *   4. guardDispatchCount  — refuse subagent dispatch when count would exceed cap.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { validateBriefContent, validateBriefContentForType } from "../core/mission-brief.js";
import { loadState, type MissionType, type SenaiState } from "../core/state.js";
import {
	getBrainstormDir,
	getBrainstormMissionBriefPath,
	getSenaiDir,
} from "../core/paths.js";

/** Marker every draft brief starts with; stripped by finalizeMissionBrief. */
const DRAFT_MARKER = "<!-- pi-senai mission-brief: draft -->";

/** Result type returned by every guard. `ok: true` means proceed;
 *  `ok: false` means block, with a human-readable reason. */
export interface GuardResult {
	ok: boolean;
	reason?: string;
	/** Optional structured details — used by tests + doctor to surface specifics. */
	details?: string[];
}

/** Max subagent dispatches allowed per brainstorm. Keeps token spend bounded. */
export const BRAINSTORM_DISPATCH_CAP = 3;

/** ──────────────────────────────────────────────────────────────────────
 *  1. Seed input guard
 *  ────────────────────────────────────────────────────────────────────── */

/** Refuse empty seed input at /senai-brainstorm entry.
 *
 *  The parent LLM needs at least one signal (topic, insight, goal, question)
 *  to anchor the Q&A. Without a seed the parent would guess the user's
 *  intent — exactly the failure mode brainstorm is supposed to prevent.
 *
 *  Whitespace-only counts as empty. */
export function guardSeedInput(args: string): GuardResult {
	const trimmed = args.trim();
	if (trimmed.length === 0) {
		return {
			ok: false,
			reason:
				`Provide a seed topic so the parent LLM can anchor the brainstorm.\n` +
				`Usage: /senai-brainstorm "<topic or insight>"\n` +
				`Example: /senai-brainstorm "refactor the lock module — deadlock in retry path"`,
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  2. Brief content guard
 *  ────────────────────────────────────────────────────────────────────── */

/** Refuse to finalize a brief whose sections still carry `_TBD_` placeholders
 *  or empty bodies. Hard reject — the user must fill the gaps before approve
 *  succeeds. The soft "Finalize anyway?" dialog is removed.
 *
 *  When a missionType is given, the check runs against that type's required
 *  section list (bugfix adds the 4 pack sections) via
 *  validateBriefContentForType; otherwise it delegates to
 *  validateBriefContent against the base 6 — single-arg calls are unchanged. */
export function guardBriefContent(brief: string, missionType?: MissionType): GuardResult {
	if (missionType) {
		const result = validateBriefContentForType(brief, missionType);
		if (!result.ok) {
			return {
				ok: false,
				reason:
					`${result.reason}\n\n` +
					`Re-run /senai-brainstorm-approve after the brief is complete.`,
			};
		}
		return { ok: true };
	}
	const unfilled = validateBriefContent(brief);
	if (unfilled.length > 0) {
		const lines = unfilled.map((s) => `  - ${s}`);
		return {
			ok: false,
			reason:
				`Mission brief is not ready to finalize. Fill these sections first:\n` +
				lines.join("\n") +
				`\n\nRe-run /senai-brainstorm-approve after the brief is complete.`,
			details: unfilled,
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  3. Artifact path guard
 *  ────────────────────────────────────────────────────────────────────── */

/** Refuse to write any artifact outside the dedicated brainstorm folder
 *  for the active run. The path must resolve to a descendant of
 *  `.IDE_Plans/pi-senai/Brainstorm/<brainstormRunId>/`. Path traversal
 *  (`..`) is rejected explicitly. */
export function guardArtifactPath(
	artifactPath: string,
	brainstormRunId: string,
): GuardResult {
	if (!brainstormRunId) {
		return {
			ok: false,
			reason: "No brainstorm run id — cannot validate artifact path.",
		};
	}
	if (artifactPath.includes("\0")) {
		return {
			ok: false,
			reason: "Artifact path contains a NUL byte.",
		};
	}
	const resolved = path.resolve(artifactPath);
	const allowedRoot = path.resolve(getBrainstormDir(".", brainstormRunId));
	// Use path.relative + isAbsolute to detect escape via `..`.
	const rel = path.relative(allowedRoot, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		return {
			ok: false,
			reason:
				`Artifact path escapes the brainstorm folder.\n` +
				`  got:      ${artifactPath}\n` +
				`  resolved: ${resolved}\n` +
				`  allowed:  ${allowedRoot}`,
		};
	}
	// Sanity check: the SENAI_DIR itself is a more permissive root that
	// includes Brainstorm/, runs/, state.json, etc. Writes to those areas
	// are NOT allowed during brainstorm — only Brainstorm/<id>/ is.
	const senaiRoot = path.resolve(getSenaiDir("."));
	if (resolved.startsWith(senaiRoot) && !resolved.startsWith(allowedRoot)) {
		return {
			ok: false,
			reason:
				`Brainstorm may only write inside ${allowedRoot}.\n` +
				`  got: ${resolved}`,
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  4. Dispatch count guard
 *  ────────────────────────────────────────────────────────────────────── */

/** Refuse subagent dispatch when the count would exceed the per-brainstorm
 *  cap. The cap protects the parent context from ballooning and keeps the
 *  audit log focused on the most consequential decisions. */
export function guardDispatchCount(count: number): GuardResult {
	if (count < 0) {
		return { ok: false, reason: "Dispatch count must be non-negative." };
	}
	if (count >= BRAINSTORM_DISPATCH_CAP) {
		return {
			ok: false,
			reason:
				`Brainstorm dispatch cap reached (${BRAINSTORM_DISPATCH_CAP}).\n` +
				`Continue research inline, or end the brainstorm and start a new one.`,
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  5. Approve readiness guard (new brainstorm flow lock)
 *  ────────────────────────────────────────────────────────────────────── */

/** Hard-block /senai-brainstorm-approve while the new-flow brainstorm is
 *  unfinished: the user must have confirmed the parent's understanding
 *  (UNDERSTAND → CONFIRM loop) and every question must be in a terminal
 *  state (agreed / not-wanted / replaced). "draft" and "discussing" block.
 *
 *  Legacy exemption: a brainstorm session that never entered the new flow
 *  (no missionType recorded) keeps the old approve behavior so in-flight
 *  sessions started before this guard existed are never wedged. */
export function guardApproveReadiness(state: SenaiState): GuardResult {
	if (!state.missionType) {
		return { ok: true };
	}
	if (state.understandingConfirmed !== true) {
		return {
			ok: false,
			reason:
				`Understanding is not confirmed yet.\n` +
				`Finish the UNDERSTAND → CONFIRM loop first: the parent shows a short ` +
				`summary of what it understood, you confirm or correct it, and only ` +
				`then can the brief be finalized.`,
		};
	}
	const open = (state.brainstormQuestions ?? []).filter(
		(q) => q.state === "draft" || q.state === "discussing",
	);
	if (open.length > 0) {
		return {
			ok: false,
			reason:
				`${open.length} question(s) still open: ${open.map((q) => q.id).join(", ")}.\n` +
				`Confirm, cancel (with reason), or supersede each one, then re-run ` +
				`/senai-brainstorm-approve.`,
			details: open.map((q) => `${q.id}: ${q.state} — ${q.text}`),
		};
	}
	if (state.missionType === "explore" && !state.exploreDecision) {
		return {
			ok: false,
			reason:
				`Explore missions end at the DECIDE door, but no decision is recorded yet.\n` +
				`Pick one door with the user — go / clarify / kill — then record it:\n` +
				`  senai_brainstorm_session({ action: "set-decision", decision: "go" | "clarify" | "kill" })`,
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  6. Brainstorm mutation gate (hard enforcement, tool_call hook)
 *  ────────────────────────────────────────────────────────────────────── */

/** Block edit/write tool calls outside the active brainstorm folder while a
 *  new-flow brainstorm is still open (brief not finalized). The brainstorm
 *  stages are read-only for the project — the only allowed writes are the
 *  brief, scout-notes, and discussion docs inside Brainstorm/<id>/.
 *
 *  Lifts automatically when:
 *  - no brainstorm is active (no brainstormRunId), or
 *  - the session is legacy (no missionType — old-flow exemption), or
 *  - the brief is finalized (draft marker stripped by approve).
 *
 *  Bash is intentionally NOT gated (no reliable target path; the spawn
 *  guard already covers subagent misuse). Returns the pi tool_call block
 *  shape ({ block, reason }) or undefined to allow. Fail-open on any I/O
 *  error — a guard bug must never wedge every edit in the session. */
export function guardBrainstormMutation(
	toolName: string,
	input: Record<string, unknown> | undefined,
	cwd: string,
): { block: true; reason: string } | undefined {
	if (toolName !== "edit" && toolName !== "write") return undefined;

	let state: SenaiState;
	try {
		state = loadState(cwd);
	} catch {
		return undefined;
	}
	if (!state.missionType || !state.brainstormRunId) return undefined;

	try {
		const brief = getBrainstormMissionBriefPath(cwd, state.brainstormRunId);
		if (fs.existsSync(brief) && !fs.readFileSync(brief, "utf8").startsWith(DRAFT_MARKER)) {
			return undefined; // finalized — brainstorm over, gate lifts
		}
	} catch {
		return undefined;
	}

	const target = typeof input?.path === "string" ? path.resolve(cwd, input.path) : "";
	const allowedRoot = path.resolve(getBrainstormDir(cwd, state.brainstormRunId));
	if (target && target.startsWith(allowedRoot + path.sep)) return undefined;

	return {
		block: true,
		reason:
			`Brainstorm "${state.brainstormRunId}" is still open — ${state.missionType} missions are read-only outside the brainstorm folder until approve.\n` +
			`Finish DISCUSS and run /senai-brainstorm-approve first.\n` +
			`(Writes inside ${path.relative(cwd, allowedRoot)}/ are allowed.)`,
	};
}
