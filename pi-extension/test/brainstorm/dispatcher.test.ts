import { describe, it } from "node:test";
import assert from "node:assert";
import * as path from "node:path";
import {
	BRAINSTORM_DISPATCH_TIMEOUT_MS,
	DEFAULT_DISPATCH_TOOLS,
	formatPreparedDispatch,
	prepareDispatch,
	resolveRoleForAgent,
} from "../../src/brainstorm/dispatcher.js";
import {
	enforceReadOnlyTools,
	FORBIDDEN_TOOLS,
	READ_ONLY_ALLOWED_TOOLS,
} from "../../src/core/agents-config/suggestions.js";
import { BRAINSTORM_DISPATCH_CAP, guardArtifactPath, guardDispatchCount } from "../../src/brainstorm/guard.js";

const BRAINSTORM_RUN_ID = "2026-09-06-19-30-brainstorm-test";

describe("dispatcher — enforceReadOnlyTools", () => {
	it("strips Write from a mixed tool list", () => {
		const out = enforceReadOnlyTools(["Read", "Write", "Grep"]);
		assert.deepStrictEqual(out, ["Read", "Grep"]);
	});

	it("strips Edit + Bash from an implementer-style tool list", () => {
		const out = enforceReadOnlyTools(["Write", "Edit", "Bash"]);
		assert.deepStrictEqual(out, []);
	});

	it("keeps Read/Grep/Glob/WebSearch/FetchURL untouched", () => {
		const out = enforceReadOnlyTools([
			"Read",
			"Grep",
			"Glob",
			"WebSearch",
			"FetchURL",
		]);
		assert.deepStrictEqual(out, ["Read", "Grep", "Glob", "WebSearch", "FetchURL"]);
	});

	it("rejects unknown / MCP tool names (strict allowlist)", () => {
		const out = enforceReadOnlyTools(["Read", "MCP/foo", "Bash", "Grep"]);
		assert.deepStrictEqual(out, ["Read", "Grep"]);
	});

	it("returns empty array for empty input", () => {
		assert.deepStrictEqual(enforceReadOnlyTools([]), []);
	});

	it("FORBIDDEN_TOOLS contains the mutation-prone tools", () => {
		assert.ok(FORBIDDEN_TOOLS.includes("Write"));
		assert.ok(FORBIDDEN_TOOLS.includes("Edit"));
		assert.ok(FORBIDDEN_TOOLS.includes("Bash"));
	});

	it("READ_ONLY_ALLOWED_TOOLS contains exactly the read-only tools", () => {
		assert.deepStrictEqual(
			[...READ_ONLY_ALLOWED_TOOLS].sort(),
			["FetchURL", "Glob", "Grep", "Read", "WebSearch"].sort(),
		);
	});
});

describe("dispatcher — prepareDispatch eligibility", () => {
	it("accepts the default scout agent", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan src/ for deadlock patterns" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.ok(r.ok, r.ok ? undefined : r.reason);
	});

	it("accepts the default planner agent", () => {
		const r = prepareDispatch(
			{ agent: "planner", task: "compare retry approaches" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.ok(r.ok, r.ok ? undefined : r.reason);
	});

	it("accepts the web-research agent", () => {
		const r = prepareDispatch(
			{ agent: "web-research", task: "fetch official asyncio docs" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.ok(r.ok, r.ok ? undefined : r.reason);
	});

	it("rejects implementer (not brainstorm-eligible)", () => {
		const r = prepareDispatch(
			{ agent: "implementer", task: "write the code" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, false);
		assert.ok(r.reason.includes("not brainstorm-eligible"));
		assert.ok(r.reason.includes("implementer"));
	});

	it("rejects security-gate (belongs to deliver stage)", () => {
		const r = prepareDispatch(
			{ agent: "security-auditor", task: "audit this" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, false);
	});

	it("rejects doc-writer agents", () => {
		const r = prepareDispatch(
			{ agent: "readme-writer", task: "write README" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, false);
	});
});

describe("dispatcher — prepareDispatch dispatch count guard", () => {
	it("accepts dispatch at count 0", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, true);
	});

	it("accepts dispatch at count 1", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan" },
			BRAINSTORM_RUN_ID,
			1,
		);
		assert.strictEqual(r.ok, true);
	});

	it("accepts dispatch at count 2 (last allowed)", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan" },
			BRAINSTORM_RUN_ID,
			2,
		);
		assert.strictEqual(r.ok, true);
	});

	it("rejects dispatch at count 3 (cap reached)", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan" },
			BRAINSTORM_RUN_ID,
			3,
		);
		assert.strictEqual(r.ok, false);
		assert.ok(r.reason.includes("dispatch cap"));
	});

	it("cap is 3 (locked value)", () => {
		assert.strictEqual(BRAINSTORM_DISPATCH_CAP, 3);
	});

	it("timeout is 30s (locked value)", () => {
		assert.strictEqual(BRAINSTORM_DISPATCH_TIMEOUT_MS, 30_000);
	});
});

describe("dispatcher — prepareDispatch artifact path guard", () => {
	it("accepts an artifact path inside the brainstorm folder", () => {
		const okPath = path.join(
			".",
			".IDE_Plans/pi-senai/Brainstorm",
			BRAINSTORM_RUN_ID,
			"external-notes.md",
		);
		const r = prepareDispatch(
			{
				agent: "web-research",
				task: "fetch docs",
				artifactPaths: [okPath],
			},
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.ok(r.ok, r.ok ? undefined : r.reason);
	});

	it("rejects an artifact path outside the brainstorm folder", () => {
		const r = prepareDispatch(
			{
				agent: "web-research",
				task: "fetch docs",
				artifactPaths: ["/tmp/external.md"],
			},
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, false);
		assert.ok(r.reason.includes("escapes the brainstorm folder"));
	});

	it("rejects a path-traversal attempt", () => {
		const evil = path.join(
			".",
			".IDE_Plans/pi-senai/Brainstorm",
			BRAINSTORM_RUN_ID,
			"..",
			"..",
			"..",
			"tmp",
			"external.md",
		);
		const r = prepareDispatch(
			{
				agent: "web-research",
				task: "fetch docs",
				artifactPaths: [evil],
			},
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, false);
	});
});

describe("dispatcher — prepareDispatch tools allowlist", () => {
	it("strips Write/Edit from a custom tool list", () => {
		const r = prepareDispatch(
			{
				agent: "scout",
				task: "scan",
				tools: ["Read", "Write", "Edit", "Grep"],
			},
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, true);
		if (r.ok) {
			assert.deepStrictEqual(r.prepared.tools, ["Read", "Grep"]);
		}
	});

	it("uses DEFAULT_DISPATCH_TOOLS when no tools are provided", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, true);
		if (r.ok) {
			assert.deepStrictEqual(r.prepared.tools, [...DEFAULT_DISPATCH_TOOLS]);
		}
	});

	it("rejects when no read-only tools remain after stripping", () => {
		const r = prepareDispatch(
			{
				agent: "scout",
				task: "scan",
				tools: ["Write", "Edit", "Bash"],
			},
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, false);
		assert.ok(r.reason.includes("no read-only tools"));
	});
});

describe("dispatcher — PreparedDispatch payload", () => {
	it("returns a structured payload with all required fields", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan src/ for deadlock", expectedOutput: "list of files" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, true);
		if (!r.ok) return;
		const p = r.prepared;
		assert.strictEqual(p.agent, "scout");
		assert.strictEqual(p.role, "scout-2");
		assert.strictEqual(p.task, "scan src/ for deadlock");
		assert.strictEqual(p.expectedOutput, "list of files");
		assert.strictEqual(p.brainstormRunId, BRAINSTORM_RUN_ID);
		assert.strictEqual(p.dispatchNumber, 1);
		assert.ok(p.startedAt.length > 0);
		assert.ok(p.tools.length > 0);
	});

	it("subagentArgs is ready to spread into subagent()", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, true);
		if (!r.ok) return;
		assert.strictEqual(r.prepared.subagentArgs.agent, "scout");
		assert.strictEqual(r.prepared.subagentArgs.timeoutMs, BRAINSTORM_DISPATCH_TIMEOUT_MS);
		assert.ok(r.prepared.subagentArgs.cwd.includes(BRAINSTORM_RUN_ID));
	});

	it("dispatchNumber reflects current count + 1", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan" },
			BRAINSTORM_RUN_ID,
			2,
		);
		assert.strictEqual(r.ok, true);
		if (r.ok) {
			assert.strictEqual(r.prepared.dispatchNumber, 3);
		}
	});

	it("cwd points at the brainstorm folder", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, true);
		if (r.ok) {
			assert.ok(r.prepared.cwd.includes(".IDE_Plans/pi-senai/Brainstorm"));
			assert.ok(r.prepared.cwd.includes(BRAINSTORM_RUN_ID));
		}
	});
});

describe("dispatcher — resolveRoleForAgent", () => {
	it("resolves scout → scout-2 (code search default)", () => {
		assert.strictEqual(resolveRoleForAgent("scout"), "scout-2");
	});

	it("resolves planner → planner", () => {
		assert.strictEqual(resolveRoleForAgent("planner"), "planner");
	});

	it("resolves web-research → community-researcher", () => {
		assert.strictEqual(resolveRoleForAgent("web-research"), "community-researcher");
	});

	it("falls back to scout-2 for unknown agent names", () => {
		assert.strictEqual(resolveRoleForAgent("unknown-agent"), "scout-2");
	});
});

describe("dispatcher — formatPreparedDispatch", () => {
	it("renders a markdown block with all key fields", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan src/ for deadlock", expectedOutput: "list of files" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, true);
		if (!r.ok) return;
		const out = formatPreparedDispatch(r.prepared);
		assert.ok(out.includes("Prepared dispatch"));
		assert.ok(out.includes("scout"));
		assert.ok(out.includes("scan src/ for deadlock"));
		assert.ok(out.includes("Expected output: list of files"));
		assert.ok(out.includes("subagent({"));
		assert.ok(out.includes("Read"));
		assert.ok(out.includes("Grep"));
		assert.ok(out.includes("Glob"));
		assert.ok(out.includes(BRAINSTORM_RUN_ID));
	});

	it("renders empty expected output gracefully", () => {
		const r = prepareDispatch(
			{ agent: "scout", task: "scan" },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(r.ok, true);
		if (!r.ok) return;
		const out = formatPreparedDispatch(r.prepared);
		assert.ok(!out.includes("Expected output:"));
	});
});

describe("dispatcher — guard reuse sanity", () => {
	it("guardDispatchCount and prepareDispatch agree on cap behavior", () => {
		// guardDispatchCount refuses at cap (returns reason)
		const g3 = guardDispatchCount(3);
		assert.strictEqual(g3.ok, false);
		// prepareDispatch refuses at cap (returns reason)
		const p3 = prepareDispatch({ agent: "scout", task: "x" }, BRAINSTORM_RUN_ID, 3);
		assert.strictEqual(p3.ok, false);
	});

	it("guardArtifactPath and prepareDispatch agree on path behavior", () => {
		const g = guardArtifactPath("/tmp/external.md", BRAINSTORM_RUN_ID);
		assert.strictEqual(g.ok, false);
		const p = prepareDispatch(
			{ agent: "web-research", task: "x", artifactPaths: ["/tmp/external.md"] },
			BRAINSTORM_RUN_ID,
			0,
		);
		assert.strictEqual(p.ok, false);
	});
});
