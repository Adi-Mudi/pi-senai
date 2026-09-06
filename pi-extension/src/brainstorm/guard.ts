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

import * as path from "node:path";
import { validateBriefContent } from "../core/mission-brief.js";
import {
	getBrainstormDir,
	getSenaiDir,
} from "../core/paths.js";

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
 *  Delegates the section-by-section check to validateBriefContent in
 *  core/mission-brief.ts so the rule lives in one place. */
export function guardBriefContent(brief: string): GuardResult {
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
