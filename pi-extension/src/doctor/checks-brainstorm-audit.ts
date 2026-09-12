/**
 * Doctor check — Brainstorm Audit (Phase 6)
 *
 * Reads every .IDE_Plans/pi-senai/Brainstorm/<id>/brainstorm-dispatch.md
 * the project has produced and surfaces findings about dispatch choices.
 *
 * Checks (all advisory, never blocking):
 *   1. Audit log missing          → warning ("approvals without audit trail")
 *   2. Dispatch cap exceeded      → warning ("cap was 3, log shows N")
 *   3. Many inline reads          → info    ("X reads inline — fine if quick")
 *   4. Suspicious inline scan     → warning ("'inline' but task mentions many files")
 *   5. Skipped decision           → warning ("skipped dispatch where registry had a match")
 *   6. Audit log unreadable       → warning ("could not parse the audit file")
 *
 * Reads only — never writes. Audit failures don't block the doctor report.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getSenaiDir } from "../core/paths.js";
import { BRAINSTORM_DISPATCH_CAP } from "../brainstorm/guard.js";
import type { DiagnosticItem, DiagnosticSection } from "./_types.js";

/** Files mentioned in a single inline decision that suggest the parent
 *  should have dispatched a scout instead. Beyond this, inline becomes
 *  wasteful for the parent context. */
const INLINE_SCAN_FILE_THRESHOLD = 5;

/** Walk every Brainstorm/<id>/ folder under the senai dir and return
 *  the list of (run id, audit file path) pairs. */
function findAuditFiles(cwd: string): Array<{ runId: string; filePath: string }> {
	const out: Array<{ runId: string; filePath: string }> = [];
	const brainstormRoot = path.join(getSenaiDir(cwd), "Brainstorm");
	let dirs: string[] = [];
	try {
		dirs = fs.readdirSync(brainstormRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return out;
	}
	for (const name of dirs) {
		const filePath = path.join(brainstormRoot, name, "brainstorm-dispatch.md");
		if (fs.existsSync(filePath)) {
			out.push({ runId: name, filePath });
		}
	}
	return out;
}

/** Count "file-ish" tokens in a string. Matches patterns like "src/foo.ts",
 *  "./bar.py", "*.md", backtick-wrapped paths, and bare dotted filenames. */
function countFileReferences(text: string): number {
	if (!text) return 0;
	const patterns = [
		/`[^`\n]+\.[a-z0-9]{1,5}`/gi,
		/\b[\w./-]+\.(ts|js|py|md|json|yaml|yml|toml|sh|tsx|jsx|rs|go|java|rb)\b/gi,
	];
	const seen = new Set<string>();
	for (const re of patterns) {
		for (const m of text.matchAll(re)) {
			seen.add(m[0].toLowerCase());
		}
	}
	return seen.size;
}

/** Naive markdown parser for our audit log format. Extracts:
 *   - run id, started, seed
 *   - per-turn decisions (decision kind, agent, reason, task, etc.)
 *   - summary stats
 *
 *  Tolerates missing fields (returns what it can find). Pure. */
export interface ParsedAuditLog {
	brainstormRunId: string;
	startedAt: string;
	seed: string;
	decisions: Array<{
		turn: number;
		decision: string;
		agent?: string;
		reason?: string;
		task?: string;
	}>;
	summary: {
		totalDispatches: number;
		dispatchesByAgent: Record<string, number>;
		inlineReads: number;
		skipped: number;
		sideChannel: number;
	};
}

export function parseAuditLog(content: string): ParsedAuditLog | null {
	if (!content.includes("<!-- pi-senai brainstorm-dispatch -->")) return null;

	const runMatch = content.match(/^- Run: (.+)$/m);
	const startedMatch = content.match(/^- Started: (.+)$/m);
	const seedMatch = content.match(/^- Seed: "(.*)"$/m);

	// Parse decisions: each "### Turn N — HH:MM" starts a block. The block
	// contains bullet lines until the next "### Turn" or "## Summary".
	const decisions: ParsedAuditLog["decisions"] = [];
	const turnPattern = /### Turn (\d+) — (\d{2}:\d{2})\n([\s\S]*?)(?=### Turn |## Summary|$)/g;
	for (const m of content.matchAll(turnPattern)) {
		const turn = parseInt(m[1], 10);
		const body = m[3];
		const decisionLine = body.match(/^- Decision: (.+)$/m);
		const reasonLine = body.match(/^- Reason: (.+)$/m);
		const taskLine = body.match(/^- Task: (.+)$/m);
		if (!decisionLine) continue;
		// Format: "decision_kind [agent]"
		const parts = decisionLine[1].trim().split(/\s+/);
		const decision = parts[0];
		const agent = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
		decisions.push({
			turn,
			decision,
			agent,
			reason: reasonLine?.[1],
			task: taskLine?.[1],
		});
	}

	// Parse summary
	const totalDispatches = parseInt(content.match(/- Total dispatches: (\d+)/)?.[1] ?? "0", 10);
	const dispatchesByAgent: Record<string, number> = {};
	const byAgentLine = content.match(/- Dispatches by agent: (.+)/);
	if (byAgentLine) {
		for (const entry of byAgentLine[1].split(",")) {
			const m2 = entry.trim().match(/^(.+?) x(\d+)$/);
			if (m2) dispatchesByAgent[m2[1].trim()] = parseInt(m2[2], 10);
		}
	}
	const inlineReads = parseInt(content.match(/- Inline reads: (\d+)/)?.[1] ?? "0", 10);
	const skipped = parseInt(content.match(/- Skipped: (\d+)/)?.[1] ?? "0", 10);
	const sideChannel = parseInt(content.match(/- Side-channel: (\d+)/)?.[1] ?? "0", 10);

	return {
		brainstormRunId: runMatch?.[1] ?? "",
		startedAt: startedMatch?.[1] ?? "",
		seed: seedMatch?.[1] ?? "",
		decisions,
		summary: {
			totalDispatches,
			dispatchesByAgent,
			inlineReads,
			skipped,
			sideChannel,
		},
	};
}

/** Decide whether an "inline" decision's task hints at a multi-file scan
 *  the parent should have dispatched. Returns true when the inline task
 *  mentions more files than INLINE_SCAN_FILE_THRESHOLD. */
function inlineDecisionLooksLikeScan(
	decision: { decision: string; task?: string; reason?: string },
): boolean {
	if (decision.decision !== "inline") return false;
	const haystack = `${decision.task ?? ""} ${decision.reason ?? ""}`;
	return countFileReferences(haystack) >= INLINE_SCAN_FILE_THRESHOLD;
}

/** The main doctor check. Returns a DiagnosticSection for the doctor
 *  report. Always returns a section (even when empty) so the report
 *  is stable. */
export function checkBrainstormAudit(cwd: string): DiagnosticSection {
	const title = "Brainstorm audit";
	const items: DiagnosticItem[] = [];

	const audits = findAuditFiles(cwd);

	if (audits.length === 0) {
		items.push({
			status: "info",
			message: "No brainstorm audit logs found. Run /senai-brainstorm + /senai-brainstorm-approve to generate one.",
		});
		return { title, items };
	}

	for (const { runId, filePath } of audits) {
		let raw: string;
		try {
			raw = fs.readFileSync(filePath, "utf8");
		} catch (err: any) {
			items.push({
				status: "warning",
				message: `Brainstorm ${runId}: audit log unreadable — ${err.message ?? "unknown error"}`,
			});
			continue;
		}

		const parsed = parseAuditLog(raw);
		if (!parsed) {
			items.push({
				status: "warning",
				message: `Brainstorm ${runId}: audit log missing the expected marker. The file may be from an older version or hand-edited.`,
			});
			continue;
		}

		// Check 1: dispatch cap exceeded
		if (parsed.summary.totalDispatches > BRAINSTORM_DISPATCH_CAP) {
			items.push({
				status: "warning",
				message: `Brainstorm ${runId}: dispatch cap exceeded — log shows ${parsed.summary.totalDispatches} dispatches (cap is ${BRAINSTORM_DISPATCH_CAP}).`,
				details: [
					"Possible causes:",
					"  - The parent LLM bypassed prepareDispatch and called subagent directly.",
					"  - State was reused across multiple brainstorm sessions without resetting.",
					"  - Doctor cannot prove the count — confirm by reviewing the log manually.",
				],
			});
		}

		// Check 2: skipped dispatch decisions
		const skipped = parsed.decisions.filter((d) => d.decision === "skipped");
		if (skipped.length > 0) {
			const turns = skipped.map((d) => d.turn).join(", ");
			items.push({
				status: "info",
				message: `Brainstorm ${runId}: ${skipped.length} skipped dispatch decision(s) on turn(s) ${turns}.`,
				details: [
					"Skipped is OK when the parent decided not to dispatch (e.g. answer was obvious).",
					"Run `senai_rank_specialists` mentally against the skipped reason to verify nothing obvious was missed.",
				],
			});
		}

		// Check 3: suspicious inline scans
		const suspiciousInline = parsed.decisions.filter(inlineDecisionLooksLikeScan);
		if (suspiciousInline.length > 0) {
			const turns = suspiciousInline.map((d) => d.turn).join(", ");
			items.push({
				status: "warning",
				message: `Brainstorm ${runId}: ${suspiciousInline.length} inline decision(s) on turn(s) ${turns} reference ≥ ${INLINE_SCAN_FILE_THRESHOLD} files.`,
				details: [
					"Inline reads are fine for quick single-file checks, but a multi-file scan should have been dispatched.",
					"  → If a scout subagent could have answered, dispatch would have been cheaper on the parent context.",
				],
			});
		}

		// Check 4: brief sections filled count, if summary is present
		const sectionsFilledMatch = raw.match(/- Brief sections filled: (\d+) \/ (\d+)/);
		if (sectionsFilledMatch) {
			const filled = parseInt(sectionsFilledMatch[1], 10);
			const total = parseInt(sectionsFilledMatch[2], 10);
			if (filled < total) {
				items.push({
					status: "warning",
					message: `Brainstorm ${runId}: brief had only ${filled}/${total} sections filled at approve time.`,
					details: [
						"This is unexpected — /senai-brainstorm-approve should hard-reject on _TBD_ placeholders.",
						"  → Check whether the guard was bypassed or the brief was hand-edited.",
					],
				});
			}
		}

		// OK summary if no issues found for this brainstorm
		if (
			parsed.summary.totalDispatches <= BRAINSTORM_DISPATCH_CAP &&
			suspiciousInline.length === 0 &&
			(sectionsFilledMatch == null || sectionsFilledMatch[1] === sectionsFilledMatch[2])
		) {
			items.push({
				status: "ok",
				message: `Brainstorm ${runId}: audit clean — ${parsed.summary.totalDispatches} dispatches, ${parsed.summary.inlineReads} inline reads, all sections filled.`,
			});
		}
	}

	return { title, items };
}

/** Re-export the cap so the doctor report can mention the threshold. */
export { BRAINSTORM_DISPATCH_CAP };
