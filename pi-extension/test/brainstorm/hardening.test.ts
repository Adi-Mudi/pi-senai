import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { guardBrainstormMutation } from "../../src/brainstorm/guard.js";
import { registerBrainstormSessionTool } from "../../src/brainstorm/state-tool.js";
import {
	confirmUnderstanding,
	loadState,
	startBrainstorm,
	defaultState,
} from "../../src/core/state.js";
import {
	getBrainstormDir,
	getBrainstormMissionBriefPath,
} from "../../src/core/paths.js";

const DRAFT = "<!-- pi-senai mission-brief: draft -->";

function writeDraftBrief(tmpDir: string, runId: string): string {
	const brief = getBrainstormMissionBriefPath(tmpDir, runId);
	fs.mkdirSync(path.dirname(brief), { recursive: true });
	fs.writeFileSync(brief, `${DRAFT}\n\n## Problem statement\n\nt\n`, "utf8");
	return brief;
}

describe("hardening — brainstorm mutation gate (tool_call)", () => {
	let tmpDir: string;
	let runId: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-gate-"));
		const started = startBrainstorm(tmpDir, "gate test", defaultState());
		runId = started.brainstormRunId!;
		confirmUnderstanding(tmpDir, loadState(tmpDir), "feature");
		writeDraftBrief(tmpDir, runId);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("blocks edit/write outside the brainstorm folder while the brief is draft", () => {
		const edit = guardBrainstormMutation("edit", { path: "src/index.ts" }, tmpDir);
		assert.ok(edit?.block, "edit outside the folder must be blocked");
		assert.ok(edit.reason.includes(runId));
		assert.ok(edit.reason.includes("/senai-brainstorm-approve"));

		const write = guardBrainstormMutation("write", { path: "README.md" }, tmpDir);
		assert.ok(write?.block, "write outside the folder must be blocked");
	});

	it("allows writes inside the brainstorm folder (brief, scout-notes, discussions)", () => {
		const inside = path.join(getBrainstormDir(tmpDir, runId), "scout-notes/code/scout-2.md");
		const r = guardBrainstormMutation("write", { path: inside }, tmpDir);
		assert.strictEqual(r, undefined, "writes inside the brainstorm folder are allowed");

		const briefWrite = guardBrainstormMutation(
			"write",
			{ path: getBrainstormMissionBriefPath(tmpDir, runId) },
			tmpDir,
		);
		assert.strictEqual(briefWrite, undefined, "the brief itself is writable");
	});

	it("lifts once the brief is finalized (draft marker stripped)", () => {
		const brief = getBrainstormMissionBriefPath(tmpDir, runId);
		fs.writeFileSync(brief, fs.readFileSync(brief, "utf8").replace(DRAFT, ""), "utf8");
		const r = guardBrainstormMutation("edit", { path: "src/index.ts" }, tmpDir);
		assert.strictEqual(r, undefined, "finalized brainstorm must not block edits");
	});

	it("exempts legacy sessions (no missionType) and non-mutating tools", () => {
		// Legacy: brainstorm id but never entered the new flow.
		startBrainstorm(tmpDir, "legacy", { ...defaultState() });
		const legacy = loadState(tmpDir);
		delete (legacy as any).missionType;
		delete (legacy as any).understandingConfirmed;
		fs.writeFileSync(
			path.join(tmpDir, ".IDE_Plans", "pi-senai", "state.json"),
			JSON.stringify(legacy),
			"utf8",
		);
		assert.strictEqual(guardBrainstormMutation("edit", { path: "src/x.ts" }, tmpDir), undefined);

		// Read-only tools are never gated.
		assert.strictEqual(guardBrainstormMutation("read", { path: "src/x.ts" }, tmpDir), undefined);
		assert.strictEqual(guardBrainstormMutation("bash", { command: "rm -rf x" }, tmpDir), undefined);
	});

	it("fails open when state.json is unreadable", () => {
		fs.rmSync(path.join(tmpDir, ".IDE_Plans"), { recursive: true, force: true });
		const r = guardBrainstormMutation("edit", { path: "src/x.ts" }, tmpDir);
		assert.strictEqual(r, undefined, "no state at all → allow");
	});
});

describe("hardening — appendEntry session persistence", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-entry-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeToolHarness() {
		const entries: Array<{ customType: string; data: unknown }> = [];
		let toolDef: any;
		const pi = {
			registerTool: (def: any) => {
				toolDef = def;
			},
			appendEntry: (customType: string, data: unknown) => {
				entries.push({ customType, data });
			},
		} as unknown as ExtensionAPI;
		registerBrainstormSessionTool(pi);
		const ctx = { cwd: tmpDir, hasUI: false } as unknown as ExtensionContext;
		return { entries, toolDef, ctx };
	}

	it("every successful action appends a senai-brainstorm session entry", async () => {
		const { entries, toolDef, ctx } = makeToolHarness();
		startBrainstorm(tmpDir, "entry test", defaultState());

		const r1 = await toolDef.execute("t1", { action: "confirm-understanding", missionType: "docs" }, undefined, undefined, ctx);
		assert.ok(r1, "execute resolves");
		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].customType, "senai-brainstorm");
		const snap = entries[0].data as any;
		assert.strictEqual(snap.missionType, "docs");
		assert.strictEqual(snap.understandingConfirmed, true);

		await toolDef.execute("t2", { action: "set-scans", scans: ["doc"] }, undefined, undefined, ctx);
		await toolDef.execute(
			"t3",
			{ action: "upsert-question", question: { id: "Q1", text: "scope?", state: "draft" } },
			undefined,
			undefined,
			ctx,
		);
		assert.strictEqual(entries.length, 3, "one entry per successful mutation");
	});

	it("failed actions append nothing", async () => {
		const { entries, toolDef, ctx } = makeToolHarness();
		startBrainstorm(tmpDir, "entry test", defaultState());
		await toolDef.execute("t1", { action: "set-decision", decision: "go" }, undefined, undefined, ctx);
		assert.strictEqual(entries.length, 0, "set-decision on a non-explore mission fails → no entry");
	});

	it("a missing appendEntry (headless) never breaks the mutation", async () => {
		let toolDef: any;
		const pi = {
			registerTool: (def: any) => {
				toolDef = def;
			},
			appendEntry: () => {
				throw new Error("no session file");
			},
		} as unknown as ExtensionAPI;
		registerBrainstormSessionTool(pi);
		const ctx = { cwd: tmpDir, hasUI: false } as unknown as ExtensionContext;
		startBrainstorm(tmpDir, "headless", defaultState());
		const r = await toolDef.execute("t1", { action: "confirm-understanding", missionType: "test" }, undefined, undefined, ctx);
		assert.ok(r, "execute resolves even when appendEntry throws");
		assert.strictEqual(loadState(tmpDir).missionType, "test", "state.json still updated");
	});
});
