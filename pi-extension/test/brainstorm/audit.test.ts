import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	AUDIT_LOG_MARKER,
	appendDecision,
	buildSummary,
	countBriefSections,
	createAuditSession,
	renderAuditLog,
	renderDecision,
	readAuditLog,
	summarizeDecisions,
	writeAuditLog,
	type AuditSession,
	type DispatchDecision,
} from "../../src/brainstorm/audit.js";

const BRAINSTORM_RUN_ID = "2026-09-06-19-30-brainstorm-test";

function makeSession(): AuditSession {
	return createAuditSession(BRAINSTORM_RUN_ID, "refactor lock module");
}

function ts(hh: number, mm: number): string {
	return `2026-09-06T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
}

function inlineDecision(turn: number, reason: string): DispatchDecision {
	return {
		turn,
		timestamp: ts(19, 30 + turn),
		userInput: `user message ${turn}`,
		decision: "inline",
		reason,
		tokens: 200,
		elapsedMs: 1500,
	};
}

function dispatchDecision(
	turn: number,
	agent: string,
	reason: string,
): DispatchDecision {
	return {
		turn,
		timestamp: ts(19, 30 + turn),
		userInput: `user message ${turn}`,
		decision: "dispatched",
		agent,
		reason,
		task: `task for ${agent}`,
		expectedOutput: "summary",
		tokens: 800,
		elapsedMs: 12000,
	};
}

describe("audit — createAuditSession", () => {
	it("returns a session with empty decisions", () => {
		const s = createAuditSession(BRAINSTORM_RUN_ID, "test seed");
		assert.strictEqual(s.brainstormRunId, BRAINSTORM_RUN_ID);
		assert.strictEqual(s.seed, "test seed");
		assert.deepStrictEqual(s.decisions, []);
		assert.ok(s.startedAt.length > 0);
	});

	it("starts session.startedAt close to now", () => {
		const before = Date.now();
		const s = createAuditSession("id", "seed");
		const after = Date.now();
		const startedMs = new Date(s.startedAt).getTime();
		assert.ok(startedMs >= before);
		assert.ok(startedMs <= after);
	});
});

describe("audit — appendDecision", () => {
	it("appends to the session decisions array", () => {
		const s = makeSession();
		appendDecision(s, inlineDecision(1, "quick read"));
		assert.strictEqual(s.decisions.length, 1);
		assert.strictEqual(s.decisions[0].turn, 1);
	});

	it("preserves insertion order", () => {
		const s = makeSession();
		appendDecision(s, inlineDecision(1, "a"));
		appendDecision(s, dispatchDecision(2, "scout", "b"));
		appendDecision(s, inlineDecision(3, "c"));
		assert.strictEqual(s.decisions[0].reason, "a");
		assert.strictEqual(s.decisions[1].reason, "b");
		assert.strictEqual(s.decisions[2].reason, "c");
	});

	it("returns the session for fluent chaining", () => {
		const s = makeSession();
		const result = appendDecision(s, inlineDecision(1, "x"));
		assert.strictEqual(result, s);
	});
});

describe("audit — summarizeDecisions", () => {
	it("counts total dispatches and groups by agent", () => {
		const s = makeSession();
		appendDecision(s, dispatchDecision(1, "scout", "x"));
		appendDecision(s, dispatchDecision(2, "scout", "y"));
		appendDecision(s, dispatchDecision(3, "web-research", "z"));
		const sum = summarizeDecisions(s.decisions);
		assert.strictEqual(sum.totalDispatches, 3);
		assert.deepStrictEqual(sum.dispatchesByAgent, { scout: 2, "web-research": 1 });
	});

	it("counts inline reads", () => {
		const s = makeSession();
		appendDecision(s, inlineDecision(1, "x"));
		appendDecision(s, inlineDecision(2, "y"));
		const sum = summarizeDecisions(s.decisions);
		assert.strictEqual(sum.inlineReads, 2);
		assert.strictEqual(sum.totalDispatches, 0);
	});

	it("counts skipped and side-channel decisions", () => {
		const s = makeSession();
		appendDecision(s, { ...inlineDecision(1, "x"), decision: "skipped" });
		appendDecision(s, { ...inlineDecision(2, "y"), decision: "side-channel", agent: "web-research" });
		const sum = summarizeDecisions(s.decisions);
		assert.strictEqual(sum.skipped, 1);
		assert.strictEqual(sum.sideChannel, 1);
	});
});

describe("audit — buildSummary", () => {
	it("combines decision counts with caller extras", () => {
		const s = makeSession();
		appendDecision(s, dispatchDecision(1, "scout", "x"));
		const summary = buildSummary(s, {
			wallClockMs: 5000,
			briefSectionsFilled: 6,
			briefSectionsTotal: 6,
		});
		assert.strictEqual(summary.totalDispatches, 1);
		assert.strictEqual(summary.wallClockMs, 5000);
		assert.strictEqual(summary.briefSectionsFilled, 6);
		assert.strictEqual(summary.briefSectionsTotal, 6);
	});
});

describe("audit — renderDecision", () => {
	it("renders an inline decision with all fields", () => {
		const d = inlineDecision(1, "single file read");
		const out = renderDecision(d);
		assert.ok(out.includes("### Turn 1"));
		assert.ok(out.includes("User: user message 1"));
		assert.ok(out.includes("Decision: inline"));
		assert.ok(out.includes("Reason: single file read"));
		assert.ok(out.includes("Tokens: ~200"));
		assert.ok(out.includes("Elapsed: ~1500ms"));
	});

	it("renders a dispatch decision with agent + task", () => {
		const d = dispatchDecision(2, "scout", "scan code");
		const out = renderDecision(d);
		assert.ok(out.includes("Decision: dispatched scout"));
		assert.ok(out.includes("Task: task for scout"));
		assert.ok(out.includes("Expected output: summary"));
	});
});

describe("audit — renderAuditLog", () => {
	it("renders the full markdown log", () => {
		const s = makeSession();
		appendDecision(s, inlineDecision(1, "quick read"));
		appendDecision(s, dispatchDecision(2, "scout", "scan code"));
		const summary = buildSummary(s, {
			wallClockMs: 8000,
			briefSectionsFilled: 6,
			briefSectionsTotal: 6,
		});
		const out = renderAuditLog(s, summary);
		assert.ok(out.startsWith(AUDIT_LOG_MARKER));
		assert.ok(out.includes("# Brainstorm Dispatch Log"));
		assert.ok(out.includes(`- Run: ${BRAINSTORM_RUN_ID}`));
		assert.ok(out.includes(`- Seed: "refactor lock module"`));
		assert.ok(out.includes("## Decisions"));
		assert.ok(out.includes("### Turn 1"));
		assert.ok(out.includes("### Turn 2"));
		assert.ok(out.includes("## Summary"));
		assert.ok(out.includes("- Total dispatches: 1"));
		assert.ok(out.includes("scout x1"));
		assert.ok(out.includes("- Inline reads: 1"));
		assert.ok(out.includes("- Wall-clock total: ~8000ms"));
		assert.ok(out.includes("- Brief sections filled: 6 / 6"));
	});

	it("renders a placeholder when there are no decisions", () => {
		const s = makeSession();
		const summary = buildSummary(s, {
			wallClockMs: 0,
			briefSectionsFilled: 6,
			briefSectionsTotal: 6,
		});
		const out = renderAuditLog(s, summary);
		assert.ok(out.includes("_(no specialist dispatches"));
		assert.ok(out.includes("- Total dispatches: 0"));
	});

	it("ends with a trailing newline", () => {
		const out = renderAuditLog(makeSession(), buildSummary(makeSession(), {
			wallClockMs: 0, briefSectionsFilled: 0, briefSectionsTotal: 6,
		}));
		assert.ok(out.endsWith("\n"));
	});
});

describe("audit — countBriefSections", () => {
	it("counts filled vs total sections in a real brief", () => {
		const brief = [
			"## Problem statement",
			"the retry path deadlocks under load",
			"",
			"## Mission type",
			"bugfix",
			"",
			"## Success criteria",
			"- no deadlock under 100 clients",
			"",
			"## Out-of-scope",
			"- switching lock libraries",
			"",
			"## Open questions",
			"- jitter?",
			"",
			"## Refined mission",
			"fix the deadlock",
		].join("\n");
		const c = countBriefSections(brief);
		assert.deepStrictEqual(c, { filled: 6, total: 6 });
	});

	it("flags _TBD_ placeholders as unfilled", () => {
		const brief = [
			"## Problem statement",
			"x",
			"",
			"## Mission type",
			"_TBD_",
			"",
			"## Success criteria",
			"_TBD_",
			"",
			"## Out-of-scope",
			"- x",
			"",
			"## Open questions",
			"- none",
			"",
			"## Refined mission",
			"y",
		].join("\n");
		const c = countBriefSections(brief);
		assert.strictEqual(c.filled, 4);
	});

	it("handles missing sections as unfilled", () => {
		const brief = "## Problem statement\nx\n";
		const c = countBriefSections(brief);
		assert.strictEqual(c.filled, 1);
		assert.strictEqual(c.total, 6);
	});
});

describe("audit — writeAuditLog", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-audit-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes the log file to the brainstorm folder", () => {
		const s = makeSession();
		const summary = buildSummary(s, {
			wallClockMs: 1000,
			briefSectionsFilled: 6,
			briefSectionsTotal: 6,
		});
		const filePath = writeAuditLog(tmpDir, s, summary);
		assert.ok(fs.existsSync(filePath));
		assert.ok(filePath.endsWith("brainstorm-dispatch.md"));
		assert.ok(filePath.includes(BRAINSTORM_RUN_ID));
	});

	it("creates the brainstorm folder if missing", () => {
		const s = makeSession();
		const summary = buildSummary(s, {
			wallClockMs: 1000, briefSectionsFilled: 0, briefSectionsTotal: 6,
		});
		writeAuditLog(tmpDir, s, summary);
		const dir = path.join(tmpDir, ".IDE_Plans/pi-senai/Brainstorm", BRAINSTORM_RUN_ID);
		assert.ok(fs.existsSync(dir));
	});

	it("writes atomically (no .tmp-* leftovers)", () => {
		const s = makeSession();
		const summary = buildSummary(s, {
			wallClockMs: 1000, briefSectionsFilled: 0, briefSectionsTotal: 6,
		});
		writeAuditLog(tmpDir, s, summary);
		const dir = path.join(tmpDir, ".IDE_Plans/pi-senai/Brainstorm", BRAINSTORM_RUN_ID);
		const files = fs.readdirSync(dir);
		assert.ok(!files.some((f) => f.startsWith(".tmp-")));
	});

	it("the written file content matches renderAuditLog", () => {
		const s = makeSession();
		appendDecision(s, dispatchDecision(1, "scout", "scan"));
		const summary = buildSummary(s, {
			wallClockMs: 3000, briefSectionsFilled: 6, briefSectionsTotal: 6,
		});
		const filePath = writeAuditLog(tmpDir, s, summary);
		const fileContent = fs.readFileSync(filePath, "utf8");
		const expected = renderAuditLog(s, summary);
		assert.strictEqual(fileContent, expected);
	});
});

describe("audit — readAuditLog", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-audit-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no log exists", () => {
		const r = readAuditLog(tmpDir, "nonexistent-id");
		assert.strictEqual(r, null);
	});

	it("returns header metadata when log exists", () => {
		const s = makeSession();
		const summary = buildSummary(s, {
			wallClockMs: 1000, briefSectionsFilled: 6, briefSectionsTotal: 6,
		});
		writeAuditLog(tmpDir, s, summary);
		const r = readAuditLog(tmpDir, BRAINSTORM_RUN_ID);
		assert.ok(r);
		assert.strictEqual(r!.brainstormRunId, BRAINSTORM_RUN_ID);
		assert.strictEqual(r!.seed, "refactor lock module");
		assert.ok(r!.startedAt.length > 0);
		assert.ok(r!.content.startsWith(AUDIT_LOG_MARKER));
	});
});
