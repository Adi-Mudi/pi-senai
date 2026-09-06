import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	checkBrainstormAudit,
	parseAuditLog,
} from "../../src/doctor/checks-brainstorm-audit.js";
import { AUDIT_LOG_MARKER, writeAuditLog } from "../../src/brainstorm/audit.js";
import {
	createAuditSession,
	buildSummary,
	appendDecision,
	type DispatchDecision,
} from "../../src/brainstorm/audit.js";

function ts(hh: number, mm: number): string {
	return `2026-09-06T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
}

function writeBrainstormAudit(
	cwd: string,
	brainstormRunId: string,
	decisions: DispatchDecision[],
	summaryOverrides: { wallClockMs?: number; briefSectionsFilled?: number; briefSectionsTotal?: number } = {},
): void {
	const dir = path.join(cwd, ".IDE_Plans/pi-senai/Brainstorm", brainstormRunId);
	fs.mkdirSync(dir, { recursive: true });
	const session = createAuditSession(brainstormRunId, "test seed");
	for (const d of decisions) appendDecision(session, d);
	const summary = buildSummary(session, {
		wallClockMs: summaryOverrides.wallClockMs ?? 5000,
		briefSectionsFilled: summaryOverrides.briefSectionsFilled ?? 6,
		briefSectionsTotal: summaryOverrides.briefSectionsTotal ?? 6,
	});
	writeAuditLog(cwd, session, summary);
}

describe("doctor — checkBrainstormAudit (empty project)", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-doctor-audit-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns an info-only section when no audit files exist", () => {
		const section = checkBrainstormAudit(tmpDir);
		assert.strictEqual(section.title, "Brainstorm audit");
		assert.strictEqual(section.items.length, 1);
		assert.strictEqual(section.items[0].status, "info");
		assert.ok(section.items[0].message.includes("No brainstorm audit logs"));
	});

	it("ignores directories that don't look like brainstorm folders", () => {
		// Random folder inside .IDE_Plans/pi-senai — not a brainstorm folder.
		fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/pi-senai/random-folder"), { recursive: true });
		const section = checkBrainstormAudit(tmpDir);
		assert.strictEqual(section.items.length, 1);
		assert.strictEqual(section.items[0].status, "info");
	});
});

describe("doctor — checkBrainstormAudit (clean audit)", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-doctor-audit-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reports ok when audit is clean (1 dispatch, no scans, all sections filled)", () => {
		writeBrainstormAudit(tmpDir, "2026-09-06-19-30-brainstorm-clean", [
			{
				turn: 1,
				timestamp: ts(19, 31),
				userInput: "show me the lock file",
				decision: "inline",
				reason: "single file",
			},
			{
				turn: 2,
				timestamp: ts(19, 32),
				userInput: "scan for deadlock patterns",
				decision: "dispatched",
				agent: "scout",
				reason: "multi-file scan",
			},
		]);
		const section = checkBrainstormAudit(tmpDir);
		const okItems = section.items.filter((i) => i.status === "ok");
		assert.ok(okItems.length > 0, "expected an ok item");
		assert.ok(okItems.some((i) => i.message.includes("audit clean")));
	});
});

describe("doctor — checkBrainstormAudit (warnings)", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-doctor-audit-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("warns when dispatch cap is exceeded", () => {
		// Manually craft a log with summary.totalDispatches > cap.
		const dir = path.join(tmpDir, ".IDE_Plans/pi-senai/Brainstorm/cap-exceeded");
		fs.mkdirSync(dir, { recursive: true });
		const session = createAuditSession("cap-exceeded", "test seed");
		// Build a summary to surface the session structure; we don't use
		// the returned values here because the file body is hand-crafted.
		buildSummary(session, {
			wallClockMs: 5000,
			briefSectionsFilled: 6,
			briefSectionsTotal: 6,
		});
		// Override the rendered summary so totalDispatches is artificially high.
		const filePath = path.join(dir, "brainstorm-dispatch.md");
		const content = [
			AUDIT_LOG_MARKER,
			"",
			"# Brainstorm Dispatch Log",
			"",
			"- Run: cap-exceeded",
			`- Started: ${session.startedAt}`,
			`- Seed: "test seed"`,
			"",
			"## Decisions",
			"",
			"_(none)_",
			"",
			"## Summary",
			"",
			"- Total dispatches: 7",
			"- Inline reads: 0",
			"- Skipped: 0",
			"- Side-channel: 0",
			"- Wall-clock total: ~5000ms",
			"- Brief sections filled: 6 / 6",
		].join("\n") + "\n";
		fs.writeFileSync(filePath, content, "utf8");

		const section = checkBrainstormAudit(tmpDir);
		const warning = section.items.find(
			(i) => i.status === "warning" && i.message.includes("dispatch cap exceeded"),
		);
		assert.ok(warning, "expected dispatch cap warning");
	});

	it("warns when an inline decision references many files (suspicious scan)", () => {
		writeBrainstormAudit(tmpDir, "2026-09-06-19-30-brainstorm-scan", [
			{
				turn: 1,
				timestamp: ts(19, 31),
				userInput: "scan every file in src/ for issues",
				decision: "inline",
				reason:
					"looked at src/foo.ts, src/bar.ts, src/baz.ts, src/qux.ts, src/quux.ts, src/quuux.ts, src/last.ts",
			},
		]);
		const section = checkBrainstormAudit(tmpDir);
		const warning = section.items.find(
			(i) => i.status === "warning" && i.message.includes("inline decision"),
		);
		assert.ok(warning, "expected inline scan warning");
	});

	it("warns when brief had missing sections at approve time", () => {
		writeBrainstormAudit(
			tmpDir,
			"2026-09-06-19-30-brainstorm-partial",
			[],
			{ briefSectionsFilled: 4, briefSectionsTotal: 6 },
		);
		const section = checkBrainstormAudit(tmpDir);
		const warning = section.items.find(
			(i) => i.status === "warning" && i.message.includes("brief had only"),
		);
		assert.ok(warning, "expected partial-brief warning");
	});

	it("info-warns on skipped decisions (not a problem, just visibility)", () => {
		writeBrainstormAudit(tmpDir, "2026-09-06-19-30-brainstorm-skipped", [
			{
				turn: 1,
				timestamp: ts(19, 31),
				userInput: "obvious answer",
				decision: "skipped",
				reason: "parent knew the answer",
			},
		]);
		const section = checkBrainstormAudit(tmpDir);
		const info = section.items.find(
			(i) => i.status === "info" && i.message.includes("skipped"),
		);
		assert.ok(info, "expected skipped info");
	});

	it("warns when audit log lacks the marker", () => {
		const dir = path.join(tmpDir, ".IDE_Plans/pi-senai/Brainstorm/no-marker");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "brainstorm-dispatch.md"),
			"## Some random markdown\nno marker here\n",
			"utf8",
		);
		const section = checkBrainstormAudit(tmpDir);
		const warning = section.items.find(
			(i) => i.status === "warning" && i.message.includes("missing the expected marker"),
		);
		assert.ok(warning, "expected marker warning");
	});

	it("handles multiple brainstorm folders independently", () => {
		writeBrainstormAudit(tmpDir, "2026-09-06-19-30-brainstorm-good", [
			{
				turn: 1,
				timestamp: ts(19, 31),
				userInput: "ok",
				decision: "inline",
				reason: "single file",
			},
		]);
		writeBrainstormAudit(tmpDir, "2026-09-06-19-35-brainstorm-scan", [
			{
				turn: 1,
				timestamp: ts(19, 36),
				userInput: "scan",
				decision: "inline",
				reason:
					"src/foo.ts src/bar.ts src/baz.ts src/qux.ts src/quux.ts src/quuux.ts src/last.ts",
			},
		]);
		const section = checkBrainstormAudit(tmpDir);
		const warnings = section.items.filter((i) => i.status === "warning");
		assert.ok(warnings.some((w) => w.message.includes("inline decision")));
		const okItems = section.items.filter((i) => i.status === "ok");
		assert.ok(okItems.some((o) => o.message.includes("audit clean")));
	});
});

describe("doctor — parseAuditLog", () => {
	it("parses a well-formed log", () => {
		const log = [
			AUDIT_LOG_MARKER,
			"",
			"# Brainstorm Dispatch Log",
			"",
			"- Run: 2026-09-06-19-30-brainstorm-test",
			"- Started: 2026-09-06T19:30:00.000Z",
			`- Seed: "refactor lock"`,
			"",
			"## Decisions",
			"",
			"### Turn 1 — 19:30",
			"",
			"- User: show me the lock file",
			"- Decision: inline",
			"- Reason: single file read",
			"",
			"### Turn 2 — 19:32",
			"",
			"- User: scan for deadlock patterns",
			"- Decision: dispatched scout",
			"- Reason: multi-file scan",
			"- Task: scan src/ for deadlock",
			"",
			"## Summary",
			"",
			"- Total dispatches: 1",
			"- Dispatches by agent: scout x1",
			"- Inline reads: 1",
			"- Skipped: 0",
			"- Side-channel: 0",
			"- Wall-clock total: ~5000ms",
			"- Brief sections filled: 6 / 6",
		].join("\n");
		const parsed = parseAuditLog(log);
		assert.ok(parsed);
		assert.strictEqual(parsed.brainstormRunId, "2026-09-06-19-30-brainstorm-test");
		assert.strictEqual(parsed.seed, "refactor lock");
		assert.strictEqual(parsed.decisions.length, 2);
		assert.strictEqual(parsed.decisions[0].decision, "inline");
		assert.strictEqual(parsed.decisions[1].decision, "dispatched");
		assert.strictEqual(parsed.decisions[1].agent, "scout");
		assert.strictEqual(parsed.decisions[1].task, "scan src/ for deadlock");
		assert.strictEqual(parsed.summary.totalDispatches, 1);
		assert.deepStrictEqual(parsed.summary.dispatchesByAgent, { scout: 1 });
		assert.strictEqual(parsed.summary.inlineReads, 1);
	});

	it("returns null when marker is missing", () => {
		assert.strictEqual(parseAuditLog("## Some other markdown\n"), null);
	});

	it("handles no decisions gracefully", () => {
		const log = [
			AUDIT_LOG_MARKER,
			"",
			"- Run: empty-test",
			"- Started: 2026-09-06T19:30:00.000Z",
			`- Seed: "x"`,
			"",
			"## Decisions",
			"",
			"_(none)_",
			"",
			"## Summary",
			"",
			"- Total dispatches: 0",
			"- Inline reads: 0",
			"- Skipped: 0",
			"- Side-channel: 0",
			"- Wall-clock total: ~0ms",
			"- Brief sections filled: 6 / 6",
		].join("\n");
		const parsed = parseAuditLog(log);
		assert.ok(parsed);
		assert.strictEqual(parsed.decisions.length, 0);
		assert.strictEqual(parsed.summary.totalDispatches, 0);
	});
});
