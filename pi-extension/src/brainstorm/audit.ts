/**
 * Brainstorm Audit Layer (Phase 5)
 *
 * Captures every dispatch / inline-read / skip decision the parent LLM
 * makes during a brainstorm. The audit log is the single source of truth
 * for what happened — used by:
 *   - The user reviewing the conversation afterward
 *   - /senai-doctor surfacing "you skipped 2 dispatches the registry
 *     would have suggested" warnings (Phase 6)
 *   - Future analytics on brainstorm quality
 *
 * Design:
 *   - Pure functions: createAuditSession, appendDecision, renderAuditLog.
 *   - I/O lives in writeAuditLog + readAuditLog, both atomic.
 *   - The session lives in memory; written to disk at finalizeAuditSession.
 *     This means a crash mid-discussion loses in-flight decisions but never
 *     corrupts the on-disk log.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	getBrainstormDispatchLogPath,
} from "../core/paths.js";
import { atomicWriteFile } from "../io/atomic-write.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Marker written at the top of brainstorm-dispatch.md so doctor + tests
 *  recognize the file even when contents are minimal. */
export const AUDIT_LOG_MARKER = "<!-- pi-senai brainstorm-dispatch -->";

/** Decisions a parent LLM can make on each turn. */
export type DecisionKind = "inline" | "dispatched" | "skipped" | "side-channel";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** One recorded decision — what the parent did on a given turn. */
export interface DispatchDecision {
	/** 1-based turn number within the brainstorm. */
	turn: number;
	/** ISO timestamp the decision was logged. */
	timestamp: string;
	/** Snippet of the user's input that triggered this decision. */
	userInput: string;
	/** What the parent chose to do. */
	decision: DecisionKind;
	/** Agent name when decision === "dispatched" or "side-channel". */
	agent?: string;
	/** Human-readable reason for the decision. */
	reason: string;
	/** Approximate tokens used by this turn (optional). */
	tokens?: number;
	/** Wall-clock time spent on the turn (optional). */
	elapsedMs?: number;
	/** Task description (for dispatched/side-channel only). */
	task?: string;
	/** Expected output hint (for dispatched only). */
	expectedOutput?: string;
}

/** In-memory audit session — accumulates decisions before finalize. */
export interface AuditSession {
	brainstormRunId: string;
	seed: string;
	startedAt: string;
	/** Mutable array of decisions in turn order. */
	decisions: DispatchDecision[];
}

/** Summary stats computed at finalizeAuditSession. */
export interface AuditSummary {
	totalDispatches: number;
	dispatchesByAgent: Record<string, number>;
	inlineReads: number;
	skipped: number;
	sideChannel: number;
	wallClockMs: number;
	briefSectionsFilled: number;
	briefSectionsTotal: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Pure functions
// ─────────────────────────────────────────────────────────────────────────

/** Create a new audit session. Pure — no file I/O. */
export function createAuditSession(brainstormRunId: string, seed: string): AuditSession {
	return {
		brainstormRunId,
		seed,
		startedAt: new Date().toISOString(),
		decisions: [],
	};
}

/** Append a decision to the session. Mutates the session in place.
 *  Returns the session for fluent chaining. */
export function appendDecision(
	session: AuditSession,
	decision: DispatchDecision,
): AuditSession {
	session.decisions.push(decision);
	return session;
}

/** Count decisions by kind. Pure. */
export function summarizeDecisions(decisions: readonly DispatchDecision[]): {
	totalDispatches: number;
	dispatchesByAgent: Record<string, number>;
	inlineReads: number;
	skipped: number;
	sideChannel: number;
} {
	let totalDispatches = 0;
	let inlineReads = 0;
	let skipped = 0;
	let sideChannel = 0;
	const dispatchesByAgent: Record<string, number> = {};
	for (const d of decisions) {
		if (d.decision === "dispatched") {
			totalDispatches++;
			if (d.agent) {
				dispatchesByAgent[d.agent] = (dispatchesByAgent[d.agent] ?? 0) + 1;
			}
		} else if (d.decision === "inline") {
			inlineReads++;
		} else if (d.decision === "skipped") {
			skipped++;
		} else if (d.decision === "side-channel") {
			sideChannel++;
		}
	}
	return { totalDispatches, dispatchesByAgent, inlineReads, skipped, sideChannel };
}

/** Build the full audit summary for a session. Combines decision counts
 *  with caller-supplied wall-clock + brief-coverage numbers. */
export function buildSummary(
	session: AuditSession,
	extras: {
		wallClockMs: number;
		briefSectionsFilled: number;
		briefSectionsTotal: number;
	},
): AuditSummary {
	return {
		...summarizeDecisions(session.decisions),
		wallClockMs: extras.wallClockMs,
		briefSectionsFilled: extras.briefSectionsFilled,
		briefSectionsTotal: extras.briefSectionsTotal,
	};
}

/** Render a single decision as a markdown block. Pure. */
export function renderDecision(d: DispatchDecision): string {
	const lines: string[] = [];
	const stamp = new Date(d.timestamp).toISOString().slice(11, 16); // HH:MM
	lines.push(`### Turn ${d.turn} — ${stamp}`);
	lines.push("");
	lines.push(`- User: ${d.userInput || "(no user input recorded)"}`);
	lines.push(`- Decision: ${d.decision}${d.agent ? ` ${d.agent}` : ""}`);
	lines.push(`- Reason: ${d.reason}`);
	if (d.task) {
		lines.push(`- Task: ${d.task}`);
	}
	if (d.expectedOutput) {
		lines.push(`- Expected output: ${d.expectedOutput}`);
	}
	if (d.tokens !== undefined) {
		lines.push(`- Tokens: ~${d.tokens}`);
	}
	if (d.elapsedMs !== undefined) {
		lines.push(`- Elapsed: ~${d.elapsedMs}ms`);
	}
	return lines.join("\n");
}

/** Render the full audit log as a markdown string. Pure. */
export function renderAuditLog(session: AuditSession, summary: AuditSummary): string {
	const lines: string[] = [];
	lines.push(AUDIT_LOG_MARKER);
	lines.push("");
	lines.push("# Brainstorm Dispatch Log");
	lines.push("");
	lines.push(`- Run: ${session.brainstormRunId}`);
	lines.push(`- Started: ${session.startedAt}`);
	lines.push(`- Seed: "${session.seed}"`);
	lines.push("");
	lines.push("## Decisions");
	lines.push("");
	if (session.decisions.length === 0) {
		lines.push("_(no specialist dispatches — the parent answered all questions inline.)_");
		lines.push("");
	} else {
		for (const d of session.decisions) {
			lines.push(renderDecision(d));
			lines.push("");
		}
	}
	lines.push("## Summary");
	lines.push("");
	lines.push(`- Total dispatches: ${summary.totalDispatches}`);
	const agentsList = Object.entries(summary.dispatchesByAgent)
		.map(([a, n]) => `${a} x${n}`)
		.join(", ");
	if (agentsList) lines.push(`- Dispatches by agent: ${agentsList}`);
	lines.push(`- Inline reads: ${summary.inlineReads}`);
	lines.push(`- Skipped: ${summary.skipped}`);
	lines.push(`- Side-channel: ${summary.sideChannel}`);
	lines.push(`- Wall-clock total: ~${summary.wallClockMs}ms`);
	lines.push(
		`- Brief sections filled: ${summary.briefSectionsFilled} / ${summary.briefSectionsTotal}`,
	);
	return lines.join("\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────────
// I/O helpers
// ─────────────────────────────────────────────────────────────────────────

/** Write the audit log atomically to the brainstorm folder.
 *  Returns the absolute path of the file written. */
export function writeAuditLog(
	cwd: string,
	session: AuditSession,
	summary: AuditSummary,
): string {
	const filePath = getBrainstormDispatchLogPath(cwd, session.brainstormRunId);
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	const content = renderAuditLog(session, summary);
	atomicWriteFile(filePath, content, "utf8");
	return filePath;
}

/** Read an existing audit log from disk. Returns null if the file does
 *  not exist. Parses the marker line + body into an AuditSession-like
 *  shape (does not reconstruct decisions — just metadata). */
export function readAuditLog(cwd: string, brainstormRunId: string): {
	brainstormRunId: string;
	startedAt: string;
	seed: string;
	content: string;
} | null {
	const filePath = getBrainstormDispatchLogPath(cwd, brainstormRunId);
	if (!fs.existsSync(filePath)) return null;
	const raw = fs.readFileSync(filePath, "utf8");
	const startedMatch = raw.match(/^- Started: (.+)$/m);
	const seedMatch = raw.match(/^- Seed: "(.*)"$/m);
	return {
		brainstormRunId,
		startedAt: startedMatch?.[1] ?? "",
		seed: seedMatch?.[1] ?? "",
		content: raw,
	};
}

/** Compute brief coverage (filled vs total sections) by scanning a brief. */
export function countBriefSections(brief: string): {
	filled: number;
	total: number;
} {
	const sections = [
		"## Problem statement",
		"## Mission type",
		"## Success criteria",
		"## Out-of-scope",
		"## Open questions",
		"## Refined mission",
	];
	let filled = 0;
	for (const s of sections) {
		const idx = brief.indexOf(s);
		if (idx === -1) continue;
		const bodyStart = idx + s.length;
		const nextHeader = brief.slice(bodyStart).match(/\n##\s/);
		const bodyEnd = nextHeader ? bodyStart + nextHeader.index! : brief.length;
		const body = brief.slice(bodyStart, bodyEnd);
		const nonEmpty = body
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && l !== "_TBD_");
		if (nonEmpty.length > 0) filled++;
	}
	return { filled, total: sections.length };
}
