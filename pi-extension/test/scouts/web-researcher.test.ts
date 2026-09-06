import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runWebResearcher } from "../../src/scouts/community-research.js";
import type { ResearchFetcher } from "../../src/scouts/community-research.js";
import {
	parseWebResearcherFrontmatter,
	WEB_RESEARCHER_BODY_FILENAME,
} from "../../src/agents/web-researcher-loader.js";
import { isBrainstormEligible } from "../../src/agents/suggestions.js";
import { prepareDispatch } from "../../src/brainstorm/dispatcher.js";
import { guardArtifactPath } from "../../src/brainstorm/guard.js";

/** Mock fetcher that returns canned results. Used to test the wrapper
 *  shape without touching the network. */
function mockFetcher(opts: { hits?: number; status?: number } = {}): ResearchFetcher {
	const hits = opts.hits ?? 1;
	const status = opts.status ?? 200;
	const seen = new Set<string>();
	return {
		async fetch(url, _timeoutMs) {
			if (seen.has(url)) return { status: 0, body: "" };
			seen.add(url);
			return {
				status,
				body: `<html><head><title>Mock ${url}</title><meta name="description" content="A mock page for ${url} with enough text to score above the working threshold."></meta></head><body>Mock content for ${url}.</body></html>`,
			};
		},
		async search(_query, _source) {
			return Array.from({ length: hits }, (_, i) => `https://example.com/${i + 1}`);
		},
	};
}

describe("web-researcher — runWebResearcher wrapper", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-webr-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns the slim WebResearcherResult shape", async () => {
		const r = await runWebResearcher({
			topic: "asyncio locks",
			projectKeywords: ["python", "asyncio"],
			source: "official",
			cwd: tmpDir,
			fetcher: mockFetcher({ hits: 3 }),
		});
		assert.ok("source" in r);
		assert.ok("confidence" in r);
		assert.ok("cached" in r);
		assert.ok("official" in r);
		assert.ok("community" in r);
		assert.ok("similar" in r);
		assert.ok("empty" in r);
	});

	it("trims entries to title/url/summary (drops tier/timestamps)", async () => {
		const r = await runWebResearcher({
			topic: "asyncio locks",
			projectKeywords: [],
			source: "official",
			cwd: tmpDir,
			fetcher: mockFetcher({ hits: 2 }),
		});
		assert.strictEqual(r.empty, false);
		if (!r.empty) {
			for (const e of r.official) {
				assert.ok("title" in e);
				assert.ok("url" in e);
				assert.ok("summary" in e);
				assert.ok(!("tier" in e), "tier should be stripped from wrapper output");
				assert.ok(!("lastVerified" in e), "lastVerified should be stripped");
				assert.ok(!("status" in e), "status should be stripped");
				assert.ok(!("working" in e), "working should be stripped");
			}
		}
	});

	it("reports empty=true when the fetcher returns zero hits", async () => {
		const r = await runWebResearcher({
			topic: "obscure topic",
			projectKeywords: [],
			source: "web",
			cwd: tmpDir,
			fetcher: mockFetcher({ hits: 0 }),
		});
		assert.strictEqual(r.empty, true);
	});

	it("respects the per-category cap (5)", async () => {
		const r = await runWebResearcher({
			topic: "popular topic",
			projectKeywords: [],
			source: "official",
			cwd: tmpDir,
			fetcher: mockFetcher({ hits: 20 }),
			maxPerCategory: 5,
		});
		assert.ok(r.official.length <= 5, `got ${r.official.length} official entries, expected ≤5`);
	});

	it("respects the wall-clock timeout", async () => {
		const slowFetcher: ResearchFetcher = {
			async fetch() {
				await new Promise((r) => setTimeout(r, 50));
				return { status: 200, body: "<html></html>" };
			},
			async search() {
				return ["https://example.com/1"];
			},
		};
		const r = await runWebResearcher({
			topic: "topic",
			projectKeywords: [],
			source: "official",
			cwd: tmpDir,
			fetcher: slowFetcher,
			timeoutMs: 100,
		});
		// Returns whatever fits within the budget — just must not throw.
		assert.ok("source" in r);
	});

	it("uses cache on second call (24h TTL)", async () => {
		const fetcher = mockFetcher({ hits: 2 });
		const args = {
			topic: "asyncio locks",
			projectKeywords: [],
			source: "official" as const,
			cwd: tmpDir,
			fetcher,
		};
		const first = await runWebResearcher(args);
		assert.strictEqual(first.cached, false, "first call should NOT be cached");
		const second = await runWebResearcher(args);
		assert.strictEqual(second.cached, true, "second call should be cached");
	});
});

describe("web-researcher — agent body file", () => {
	it("loads and parses the frontmatter", () => {
		const fm = parseWebResearcherFrontmatter();
		assert.ok(fm, "expected to parse frontmatter");
		assert.strictEqual(fm!.name, "web-research");
		assert.ok(fm!.description.toLowerCase().includes("read-only"));
		assert.ok(fm!.description.toLowerCase().includes("web"));
	});

	it("declares only read-only tools in frontmatter", () => {
		const fm = parseWebResearcherFrontmatter();
		assert.ok(fm);
		const allowed = new Set(["WebSearch", "FetchURL", "Read", "Grep", "Glob"]);
		for (const t of fm!.tools) {
			assert.ok(allowed.has(t), `tool "${t}" is not in the read-only allowlist`);
		}
		assert.ok(!fm!.tools.includes("Write"), "Write must NOT be in the tool list");
		assert.ok(!fm!.tools.includes("Edit"), "Edit must NOT be in the tool list");
		assert.ok(!fm!.tools.includes("Bash"), "Bash must NOT be in the tool list");
	});

	it("body file lives next to the loader", () => {
		const fm = parseWebResearcherFrontmatter();
		assert.ok(fm, `body file ${WEB_RESEARCHER_BODY_FILENAME} should exist`);
	});
});

describe("web-researcher — eligibility + dispatcher integration", () => {
	it("community-researcher is in BRAINSTORM_ELIGIBLE_ROLES", () => {
		assert.strictEqual(isBrainstormEligible("community-researcher"), true);
	});

	it("dispatcher accepts web-research as an agent", () => {
		const r = prepareDispatch(
			{
				agent: "web-research",
				task: "fetch official asyncio docs",
				expectedOutput: "list of doc URLs",
			},
			"2026-09-06-19-30-brainstorm-test",
			0,
		);
		assert.ok(r.ok, r.ok ? undefined : r.reason);
		if (r.ok) {
			assert.strictEqual(r.prepared.role, "community-researcher");
		}
	});

	it("dispatcher enforces read-only tools for web-research", () => {
		const r = prepareDispatch(
			{
				agent: "web-research",
				task: "fetch docs",
				tools: ["WebSearch", "Write", "FetchURL", "Edit"],
			},
			"2026-09-06-19-30-brainstorm-test",
			0,
		);
		assert.strictEqual(r.ok, true);
		if (r.ok) {
			assert.deepStrictEqual(r.prepared.tools, ["WebSearch", "FetchURL"]);
		}
	});

	it("dispatcher rejects when dispatch cap is reached even for web-research", () => {
		const r = prepareDispatch(
			{ agent: "web-research", task: "fetch docs" },
			"2026-09-06-19-30-brainstorm-test",
			3,
		);
		assert.strictEqual(r.ok, false);
		assert.ok(!r.ok && r.reason.includes("dispatch cap"));
	});

	it("artifact path guard applies to web-research too", () => {
		const okPath = path.join(
			".",
			".IDE_Plans/pi-senai/Brainstorm",
			"2026-09-06-19-30-brainstorm-test",
			"external-notes.md",
		);
		const g1 = guardArtifactPath(okPath, "2026-09-06-19-30-brainstorm-test");
		assert.strictEqual(g1.ok, true);
		const g2 = guardArtifactPath("/tmp/external.md", "2026-09-06-19-30-brainstorm-test");
		assert.strictEqual(g2.ok, false);
	});
});
