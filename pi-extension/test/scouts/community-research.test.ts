import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  runCommunityResearch,
  cacheKey,
  dayBucketUtc,
  readCache,
  writeCache,
  purgeCache,
  cacheSize,
  oldestCacheTimestamp,
  isWorking,
  retryWithNewKeywords,
  type ResearchFetcher,
  type ResearchSourceEntry,
} from "../../src/scouts/community-research.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "senai-cr-test-"));
}

function makeWorkingEntry(url: string, summary = "Test summary that is reasonably long"): ResearchSourceEntry {
  return {
    title: `Title for ${url}`,
    url,
    summary,
    tier: 4,
    lastVerified: new Date().toISOString(),
    status: 200,
    working: true,
  };
}

function makeBrokenEntry(url: string): ResearchSourceEntry {
  return {
    title: `Broken for ${url}`,
    url,
    summary: "Broken",
    tier: 4,
    lastVerified: new Date().toISOString(),
    status: 404,
    working: false,
  };
}

function makeFetcher(
  candidates: string[],
  results: Record<string, ResearchSourceEntry>,
): ResearchFetcher {
  return {
    async fetch(url: string) {
      const entry = results[url];
      if (!entry) {
        return { status: 0, body: "" };
      }
      return {
        status: entry.status,
        body: `<title>${entry.title}</title><meta name="description" content="${entry.summary}">`,
      };
    },
    async search() {
      return [...candidates];
    },
  };
}

describe("cacheKey", () => {
  it("is deterministic for same inputs", () => {
    const a = cacheKey("redis caching", ["fastapi"], "web", "2026-09-03");
    const b = cacheKey("redis caching", ["fastapi"], "web", "2026-09-03");
    assert.strictEqual(a, b);
    assert.strictEqual(a.length, 32);
  });

  it("differs when source changes", () => {
    const web = cacheKey("redis caching", ["fastapi"], "web", "2026-09-03");
    const official = cacheKey("redis caching", ["fastapi"], "official", "2026-09-03");
    assert.notStrictEqual(web, official);
  });

  it("differs when keywords change", () => {
    const a = cacheKey("redis caching", ["fastapi"], "web", "2026-09-03");
    const b = cacheKey("redis caching", ["django"], "web", "2026-09-03");
    assert.notStrictEqual(a, b);
  });

  it("differs when day bucket changes", () => {
    const a = cacheKey("redis caching", ["fastapi"], "web", "2026-09-03");
    const b = cacheKey("redis caching", ["fastapi"], "web", "2026-09-04");
    assert.notStrictEqual(a, b);
  });
});

describe("dayBucketUtc", () => {
  it("returns YYYY-MM-DD format", () => {
    const bucket = dayBucketUtc(new Date("2026-09-03T23:42:00Z"));
    assert.strictEqual(bucket, "2026-09-03");
  });
});

describe("cache read/write", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null on miss", () => {
    assert.strictEqual(readCache(tmpDir, "nonexistent-hash"), null);
  });

  it("round-trips a written output", () => {
    const hash = "abcd1234abcd1234abcd1234abcd1234";
    const output = {
      source: "web" as const,
      community: [makeWorkingEntry("https://example.com/a")],
      official: [],
      similar: [],
      confidence: "medium" as const,
      queries: ["test"],
      attempts: [],
      cached: false,
      ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    writeCache(tmpDir, hash, output);
    const round = readCache(tmpDir, hash);
    assert.ok(round, "round-trip must produce a non-null result");
    assert.strictEqual(round?.source, "web");
    assert.strictEqual(round?.community.length, 1);
    assert.strictEqual(round?.cached, true);
  });

  it("purgeCache removes all files and returns count", () => {
    writeCache(tmpDir, "h1", {
      source: "web",
      community: [],
      official: [],
      similar: [],
      confidence: "low",
      queries: [],
      attempts: [],
      cached: false,
      ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    writeCache(tmpDir, "h2", {
      source: "official",
      community: [],
      official: [],
      similar: [],
      confidence: "low",
      queries: [],
      attempts: [],
      cached: false,
      ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.strictEqual(cacheSize(tmpDir), 2);
    const purged = purgeCache(tmpDir);
    assert.strictEqual(purged, 2);
    assert.strictEqual(cacheSize(tmpDir), 0);
  });

  it("cacheSize returns 0 for missing dir", () => {
    assert.strictEqual(cacheSize(tmpDir), 0);
  });

  it("oldestCacheTimestamp returns null for empty cache", () => {
    assert.strictEqual(oldestCacheTimestamp(tmpDir), null);
  });
});

describe("isWorking", () => {
  it("accepts a 200-status entry with on-topic body", () => {
    assert.strictEqual(isWorking(makeWorkingEntry("https://example.com/a")), true);
  });

  it("rejects a 404-status entry", () => {
    assert.strictEqual(isWorking(makeBrokenEntry("https://example.com/b")), false);
  });

  it("rejects entry with empty title", () => {
    const e = makeWorkingEntry("https://example.com/c");
    e.title = "";
    assert.strictEqual(isWorking(e), false);
  });

  it("rejects entry with empty summary", () => {
    const e = makeWorkingEntry("https://example.com/d");
    e.summary = "";
    assert.strictEqual(isWorking(e), false);
  });

  it("rejects entry with working=false", () => {
    const e = makeWorkingEntry("https://example.com/e");
    e.working = false;
    assert.strictEqual(isWorking(e), false);
  });
});

describe("retryWithNewKeywords", () => {
  it("returns a non-empty array with at least one different keyword", () => {
    const result = retryWithNewKeywords("redis caching", "redis caching");
    assert.ok(result.length > 0);
    assert.ok(result.some((q) => q !== "redis caching"));
  });

  it("does not include the original query verbatim", () => {
    const original = "fastapi redis";
    const result = retryWithNewKeywords(original, "fastapi redis");
    assert.ok(!result.includes(original));
  });

  it("caps at 3 candidates", () => {
    const result = retryWithNewKeywords("redis caching", "redis caching");
    assert.ok(result.length <= 3);
  });
});

describe("runCommunityResearch", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns confidence low with empty arrays when fetcher returns nothing", async () => {
    const fetcher = makeFetcher([], {});
    const result = await runCommunityResearch({
      topic: "redis caching",
      projectKeywords: ["fastapi"],
      source: "web",
      cwd: tmpDir,
      fetcher,
    });
    assert.strictEqual(result.confidence, "low");
    assert.deepStrictEqual(result.community, []);
    assert.deepStrictEqual(result.official, []);
    assert.deepStrictEqual(result.similar, []);
  });

  it("returns medium confidence when first attempt has working results", async () => {
    const url = "https://example.com/article";
    const fetcher = makeFetcher([url], { [url]: makeWorkingEntry(url) });
    const result = await runCommunityResearch({
      topic: "redis caching",
      projectKeywords: ["fastapi"],
      source: "web",
      cwd: tmpDir,
      fetcher,
    });
    assert.strictEqual(result.confidence, "medium");
    assert.ok(result.community.length + result.official.length + result.similar.length > 0);
  });

  it("returns cached result on second call within 24h", async () => {
    const url = "https://example.com/article";
    const fetcher = makeFetcher([url], { [url]: makeWorkingEntry(url) });
    const first = await runCommunityResearch({
      topic: "redis caching",
      projectKeywords: ["fastapi"],
      source: "web",
      cwd: tmpDir,
      fetcher,
    });
    const second = await runCommunityResearch({
      topic: "redis caching",
      projectKeywords: ["fastapi"],
      source: "web",
      cwd: tmpDir,
      fetcher,
    });
    assert.strictEqual(second.cached, true);
    assert.strictEqual(second.confidence, first.confidence);
  });

  it("retries with new keywords on empty first attempt", async () => {
    let searchCalls = 0;
    const fetcher: ResearchFetcher = {
      async fetch() {
        return {
          status: 200,
          body: "<title>Retry Result Title</title><meta name=\"description\" content=\"retry result summary long enough to pass working check\">",
        };
      },
      async search() {
        searchCalls++;
        if (searchCalls === 1) return [];
        return ["https://example.com/a"];
      },
    };
    const result = await runCommunityResearch({
      topic: "redis",
      projectKeywords: [],
      source: "web",
      cwd: tmpDir,
      fetcher,
    });
    assert.ok(searchCalls > 1);
    assert.ok(result.attempts.length > 1);
  });

  it("appends to transcript path when provided", async () => {
    const transcriptPath = path.join(tmpDir, "transcript.md");
    const url = "https://example.com/a";
    const fetcher = makeFetcher([url], { [url]: makeWorkingEntry(url) });
    await runCommunityResearch({
      topic: "redis",
      projectKeywords: [],
      source: "web",
      cwd: tmpDir,
      fetcher,
      transcriptPath,
    });
    assert.ok(fs.existsSync(transcriptPath));
    const content = fs.readFileSync(transcriptPath, "utf8");
    assert.ok(content.includes("Community Research Transcript"));
    assert.ok(content.includes("https://example.com/a"));
  });

  it("appends ## External references section to brief when provided", async () => {
    const briefPath = path.join(tmpDir, "brief.md");
    fs.writeFileSync(briefPath, "## Problem statement\n\nSome content\n", "utf8");
    const url = "https://example.com/a";
    const fetcher = makeFetcher([url], { [url]: makeWorkingEntry(url) });
    await runCommunityResearch({
      topic: "redis",
      projectKeywords: [],
      source: "web",
      cwd: tmpDir,
      fetcher,
      briefPath,
    });
    const content = fs.readFileSync(briefPath, "utf8");
    assert.ok(content.includes("## External references"));
    assert.ok(content.includes("https://example.com/a"));
  });

  it("is idempotent for the brief section (does not append twice)", async () => {
    const briefPath = path.join(tmpDir, "brief.md");
    fs.writeFileSync(briefPath, "## Problem statement\n\nSome content\n", "utf8");
    const url = "https://example.com/a";
    const fetcher = makeFetcher([url], { [url]: makeWorkingEntry(url) });
    await runCommunityResearch({
      topic: "redis",
      projectKeywords: [],
      source: "web",
      cwd: tmpDir,
      fetcher,
      briefPath,
    });
    await runCommunityResearch({
      topic: "redis",
      projectKeywords: [],
      source: "web",
      cwd: tmpDir,
      fetcher,
      briefPath,
    });
    const content = fs.readFileSync(briefPath, "utf8");
    const occurrences = (content.match(/## External references/g) ?? []).length;
    assert.strictEqual(occurrences, 1);
  });

  it("respects FIFO cache cap", () => {
    // Write 51 distinct cache entries; the cap is 50.
    for (let i = 0; i < 51; i++) {
      const hash = `h${i.toString().padStart(31, "0")}`;
      writeCache(tmpDir, hash, {
        source: "web",
        community: [],
        official: [],
        similar: [],
        confidence: "low",
        queries: [`q${i}`],
        attempts: [],
        cached: false,
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
    }
    assert.ok(cacheSize(tmpDir) <= 50);
  });

  it("respects maxPerCategory cap", async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`);
    const results: Record<string, ResearchSourceEntry> = {};
    for (const u of urls) results[u] = makeWorkingEntry(u);
    const fetcher = makeFetcher(urls, results);
    const result = await runCommunityResearch({
      topic: "test",
      projectKeywords: [],
      source: "web",
      cwd: tmpDir,
      fetcher,
      maxPerCategory: 3,
    });
    assert.ok(result.community.length + result.official.length + result.similar.length <= 3);
  });
});
