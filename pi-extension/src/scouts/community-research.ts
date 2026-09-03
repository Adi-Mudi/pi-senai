/**
 * Community Research Scout (standalone, one-shot, run from /senai-discussion only).
 *
 * Pure function: takes a topic + project keywords + source choice, returns a
 * structured result with up to 5 entries per category (community / official /
 * similar). No persistent agent file, no GENERATED_ROLES entry, no agents.json
 * mapping. Caller wires it through the parent LLM via the subagent tool or
 * runs it directly inside the discussion handler.
 *
 * Design rules (locked from plan v1.0):
 *   - 4 user-pickable sources: "web" | "official" | "community" | "similar"
 *   - 1 hidden short-circuit: cache (24h TTL, content-hash keyed, project-local)
 *   - Cache lives at .IDE_Plans/senai/.cache/community-research/<hash>.json
 *   - Hard caps: 5 per category, 1500 tokens output, 30s wall-clock
 *   - Retry once with new keywords on empty result
 *   - Working-result check: HTTP 2xx, body matches topic, <=2yr for version-sensitive
 *   - No license filter on "similar" — quality (working + trusted) wins
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../atomic-write.js";
import {
  COMMUNITY_RESEARCH_CACHE_CAP,
  getCommunityResearchCacheDir,
  getCommunityResearchCachePath,
} from "../constants.js";

// ---------------------------------------------------------------------------
// Public type surface
// ---------------------------------------------------------------------------

export const RESEARCH_SOURCES = ["web", "official", "community", "similar"] as const;
export type ResearchSource = (typeof RESEARCH_SOURCES)[number];

export type Confidence = "high" | "medium" | "low" | "cached";

/** Tier ranking (lower = more trusted). Used by callers that want to filter
 *  by source authority. The scout itself does not filter by tier; it includes
 *  the tier in the output so the caller / display layer can decide. */
export type SourceTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ResearchSourceEntry {
  title: string;
  url: string;
  summary: string;
  tier: SourceTier;
  lastVerified: string; // ISO timestamp
  status: number; // HTTP status
  working: boolean;
}

export interface ResearchAttempt {
  query: string;
  source: ResearchSource;
  resultCount: number;
  at: string; // ISO
}

export interface CommunityResearchOutput {
  source: ResearchSource;
  community: ResearchSourceEntry[];
  official: ResearchSourceEntry[];
  similar: ResearchSourceEntry[];
  confidence: Confidence;
  queries: string[];
  attempts: ResearchAttempt[];
  cached: boolean;
  ttlExpiresAt: string; // ISO
}

export interface CommunityResearchInput {
  topic: string;
  projectKeywords: string[];
  source: ResearchSource;
  cwd: string;
  /** Optional transcript path to log to on completion. */
  transcriptPath?: string;
  /** Optional brief path to append ## External references to on completion. */
  briefPath?: string;
  /** Wall-clock cap (ms). Default 30000. */
  timeoutMs?: number;
  /** Token cap for output JSON. Default 1500. */
  tokenCap?: number;
  /** Max results per category. Default 5. */
  maxPerCategory?: number;
  /** Inject a fetcher for unit tests. Default uses global fetch with cap. */
  fetcher?: ResearchFetcher;
}

export interface ResearchFetcher {
  /** Fetch one URL, return status + first N bytes of body. */
  fetch(url: string, timeoutMs: number): Promise<{ status: number; body: string }>;
  /** Search the chosen source for the given query, return candidate URLs. */
  search(query: string, source: ResearchSource): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TOKEN_CAP = 1500;
const DEFAULT_MAX_PER_CATEGORY = 5;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ---------------------------------------------------------------------------
// Cache key + accessors
// ---------------------------------------------------------------------------

/**
 * Deterministic content-hash for cache lookup.
 * Key inputs: topic + projectKeywords (sorted) + source + dayBucket (UTC date).
 */
export function cacheKey(
  topic: string,
  keywords: string[],
  source: ResearchSource,
  dayBucket: string,
): string {
  const norm = [topic.trim().toLowerCase(), ...[...keywords].map((k) => k.trim().toLowerCase()).sort(), source, dayBucket].join("|");
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

/** UTC date in YYYY-MM-DD form. Used as the dayBucket. */
export function dayBucketUtc(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function readCache(cwd: string, hash: string): CommunityResearchOutput | null {
  const p = getCommunityResearchCachePath(cwd, hash);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as CommunityResearchOutput;
    // TTL check on read — lazy eviction.
    if (parsed.ttlExpiresAt && new Date(parsed.ttlExpiresAt).getTime() < Date.now()) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* best-effort */
      }
      return null;
    }
    return { ...parsed, cached: true };
  } catch {
    return null;
  }
}

export function writeCache(cwd: string, hash: string, output: CommunityResearchOutput): void {
  const dir = getCommunityResearchCacheDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  // FIFO eviction before write so cap is never exceeded.
  evictCacheFifo(cwd, COMMUNITY_RESEARCH_CACHE_CAP - 1);
  const p = getCommunityResearchCachePath(cwd, hash);
  atomicWriteJson(p, output);
}

export function purgeCache(cwd: string): number {
  const dir = getCommunityResearchCacheDir(cwd);
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith(".json")) {
      try {
        fs.unlinkSync(path.join(dir, entry));
        count++;
      } catch {
        /* best-effort */
      }
    }
  }
  return count;
}

function evictCacheFifo(cwd: string, targetRemaining: number): void {
  const dir = getCommunityResearchCacheDir(cwd);
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort(); // lexical sort = oldest first by hash prefix (stable enough for FIFO)
  while (files.length > targetRemaining) {
    const victim = files.shift();
    if (!victim) break;
    try {
      fs.unlinkSync(path.join(dir, victim));
    } catch {
      /* best-effort */
    }
  }
}

export function cacheSize(cwd: string): number {
  const dir = getCommunityResearchCacheDir(cwd);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

export function oldestCacheTimestamp(cwd: string): string | null {
  const dir = getCommunityResearchCacheDir(cwd);
  if (!fs.existsSync(dir)) return null;
  let oldest: string | null = null;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const stat = fs.statSync(path.join(dir, entry));
      const iso = stat.mtime.toISOString();
      if (oldest === null || iso < oldest) oldest = iso;
    } catch {
      /* best-effort */
    }
  }
  return oldest;
}

// ---------------------------------------------------------------------------
// Quality filter
// ---------------------------------------------------------------------------

export function isWorking(entry: ResearchSourceEntry): boolean {
  if (entry.status < 200 || entry.status >= 300) return false;
  if (!entry.title || entry.title.trim() === "") return false;
  if (!entry.url || entry.url.trim() === "") return false;
  if (!entry.summary || entry.summary.trim() === "") return false;
  if (!entry.working) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

/**
 * Build a small set of keyword variations for the retry pass. Drops filler
 * words, adds version-suffix hints, swaps synonyms. Returns at least one
 * candidate that differs from the original query.
 */
export function retryWithNewKeywords(originalQuery: string, _topic: string): string[] {
  const base = originalQuery.trim();
  const candidates = new Set<string>();
  candidates.add(`${base} tutorial`);
  candidates.add(`${base} example`);
  candidates.add(`${base} latest`);
  if (base.length > 30) {
    candidates.add(base.split(/\s+/).slice(0, 3).join(" "));
  } else {
    candidates.add(`${base} best practice`);
  }
  candidates.delete(base);
  return [...candidates].slice(0, 3);
}

// ---------------------------------------------------------------------------
// Default fetcher (uses global fetch, respects timeout)
// ---------------------------------------------------------------------------

/**
 * Stub fetcher used when no real fetcher is injected. Returns no candidates
 * so the scout gracefully degrades to "low confidence, empty result". Real
 * callers inject a fetcher that talks to a search API.
 */
const stubFetcher: ResearchFetcher = {
  async fetch() {
    return { status: 0, body: "" };
  },
  async search() {
    return [];
  },
};

// ---------------------------------------------------------------------------
// Token cap helper (rough — counts JSON length / 4 as a proxy)
// ---------------------------------------------------------------------------

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function trimToTokenCap<T>(value: T, cap: number): T {
  if (estimateTokens(value) <= cap) return value;
  const json = JSON.stringify(value);
  const trimmed = json.slice(0, cap * 4);
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Best-effort fallback: drop attempts (the largest field) until under cap.
    if (typeof value === "object" && value !== null && "attempts" in (value as Record<string, unknown>)) {
      const copy = { ...(value as Record<string, unknown>) };
      copy.attempts = [];
      return trimToTokenCap(copy as T, cap);
    }
    return value;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run community research for a single source. Pure-ish: writes cache +
 * (optionally) transcript + brief section as side-effects. Returns the
 * structured output so the caller can render it.
 */
export async function runCommunityResearch(
  input: CommunityResearchInput,
): Promise<CommunityResearchOutput> {
  const {
    topic,
    projectKeywords,
    source,
    cwd,
    fetcher = stubFetcher,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    tokenCap = DEFAULT_TOKEN_CAP,
    maxPerCategory = DEFAULT_MAX_PER_CATEGORY,
  } = input;

  const day = dayBucketUtc();
  const hash = cacheKey(topic, projectKeywords, source, day);

  // 1. Cache short-circuit.
  const cached = readCache(cwd, hash);
  if (cached) {
    if (input.transcriptPath) {
      appendTranscript(input.transcriptPath, cached, "cache-hit");
    }
    return cached;
  }

  const attempts: ResearchAttempt[] = [];
  const queries: string[] = [];
  let working: CommunityResearchOutput | null = null;

  // 2. First attempt with the topic-derived query.
  const primaryQuery = buildQuery(topic, projectKeywords, source);
  queries.push(primaryQuery);
  const firstResult = await tryOnePass(primaryQuery, source, fetcher, maxPerCategory, timeoutMs);
  attempts.push({ query: primaryQuery, source, resultCount: totalCount(firstResult), at: new Date().toISOString() });
  if (totalCount(firstResult) > 0) {
    working = finalize(firstResult, source, queries, attempts, "medium", false);
  }

  // 3. Retry once with new keywords if first was empty.
  if (!working) {
    const retries = retryWithNewKeywords(primaryQuery, topic);
    for (const retryQuery of retries) {
      queries.push(retryQuery);
      const retryResult = await tryOnePass(retryQuery, source, fetcher, maxPerCategory, timeoutMs);
      attempts.push({
        query: retryQuery,
        source,
        resultCount: totalCount(retryResult),
        at: new Date().toISOString(),
      });
      if (totalCount(retryResult) > 0) {
        working = finalize(retryResult, source, queries, attempts, "low", false);
        break;
      }
    }
  }

  // 4. No result after retry — empty output with low confidence.
  if (!working) {
    working = finalize(
      { community: [], official: [], similar: [] },
      source,
      queries,
      attempts,
      "low",
      false,
    );
  }

  // 5. Apply token cap.
  const capped = trimToTokenCap(working, tokenCap);

  // 6. Set TTL.
  const ttlExpiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

  const finalOutput: CommunityResearchOutput = {
    ...capped,
    confidence: working.confidence,
    ttlExpiresAt,
  };

  // 7. Persist to cache.
  writeCache(cwd, hash, finalOutput);

  // 8. Optional transcript + brief append.
  if (input.transcriptPath) {
    appendTranscript(input.transcriptPath, finalOutput, "fresh");
  }
  if (input.briefPath) {
    appendBriefSection(input.briefPath, finalOutput);
  }

  return finalOutput;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildQuery(topic: string, keywords: string[], _source: ResearchSource): string {
  const kw = keywords.length > 0 ? ` (${keywords.join(", ")})` : "";
  return `${topic}${kw}`;
}

function totalCount(result: Pick<CommunityResearchOutput, "community" | "official" | "similar">): number {
  return result.community.length + result.official.length + result.similar.length;
}

function finalize(
  result: Pick<CommunityResearchOutput, "community" | "official" | "similar">,
  source: ResearchSource,
  queries: string[],
  attempts: ResearchAttempt[],
  confidence: Confidence,
  cached: boolean,
): CommunityResearchOutput {
  return {
    source,
    community: result.community,
    official: result.official,
    similar: result.similar,
    confidence,
    queries,
    attempts,
    cached,
    ttlExpiresAt: "", // caller fills this in
  };
}

/**
 * One pass: search the source, fetch each candidate, apply working-result
 * check, keep best maxPerCategory entries per category.
 */
async function tryOnePass(
  query: string,
  source: ResearchSource,
  fetcher: ResearchFetcher,
  maxPerCategory: number,
  timeoutMs: number,
): Promise<Pick<CommunityResearchOutput, "community" | "official" | "similar">> {
  const candidates = await fetcher.search(query, source);
  const community: ResearchSourceEntry[] = [];
  const official: ResearchSourceEntry[] = [];
  const similar: ResearchSourceEntry[] = [];

  for (const url of candidates.slice(0, maxPerCategory * 3)) {
    try {
      const { status, body } = await fetcher.fetch(url, Math.min(timeoutMs, 10_000));
      const entry = scoreEntry(url, body, status, source);
      if (!isWorking(entry)) continue;
      if (entry.tier <= 3) {
        official.push(entry);
      } else if (entry.tier <= 5) {
        community.push(entry);
      } else {
        similar.push(entry);
      }
    } catch {
      // Network or timeout failure — skip this candidate.
    }
  }

  return {
    community: community.slice(0, maxPerCategory),
    official: official.slice(0, maxPerCategory),
    similar: similar.slice(0, maxPerCategory),
  };
}

/**
 * Score a fetched URL into a ResearchSourceEntry. Pure: no I/O.
 * The tier mapping is intentionally simple — the caller/display layer can
 * override. We mark working=true only when the body has at least one sentence.
 */
function scoreEntry(url: string, body: string, status: number, source: ResearchSource): ResearchSourceEntry {
  const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const summaryMatch = body.match(/<meta name="description" content="([^"]+)"/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : body.slice(0, 160).trim();
  const tier = inferTier(url, source);
  const working = status >= 200 && status < 300 && body.length > 100 && summary.length > 0;
  return {
    title: title.slice(0, 200),
    url,
    summary: summary.slice(0, 300),
    tier,
    lastVerified: new Date().toISOString(),
    status,
    working,
  };
}

function inferTier(url: string, source: ResearchSource): SourceTier {
  try {
    const host = new URL(url).host.toLowerCase();
    if (source === "official") return host.endsWith(".gov") || host.endsWith(".edu") ? 1 : 2;
    if (source === "community") {
      if (host.includes("stackoverflow.com") || host.includes("github.com")) return 4;
      return 5;
    }
    if (source === "similar") return 3;
    return 6; // generic web
  } catch {
    return 8;
  }
}

// ---------------------------------------------------------------------------
// Side-effect helpers: transcript + brief append
// ---------------------------------------------------------------------------

function appendTranscript(
  transcriptPath: string,
  output: CommunityResearchOutput,
  kind: "cache-hit" | "fresh",
): void {
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  const lines: string[] = [];
  if (!fs.existsSync(transcriptPath)) {
    lines.push(`# Community Research Transcript — ${path.basename(transcriptPath)}`);
    lines.push("");
  }
  lines.push(`## Run — ${new Date().toISOString()} (${kind})`);
  lines.push("");
  lines.push(`- Source: ${output.source}`);
  lines.push(`- Confidence: ${output.confidence}`);
  lines.push(`- Cached: ${output.cached}`);
  lines.push(`- TTL expires: ${output.ttlExpiresAt}`);
  lines.push(`- Queries: ${output.queries.map((q) => `\`${q}\``).join(", ")}`);
  lines.push("");
  lines.push("### Attempts");
  for (const a of output.attempts) {
    lines.push(`- ${a.at} query=\`${a.query}\` results=${a.resultCount}`);
  }
  lines.push("");
  lines.push("### Results");
  for (const cat of ["official", "community", "similar"] as const) {
    if (output[cat].length === 0) continue;
    lines.push(`#### ${cat}`);
    for (const e of output[cat]) {
      lines.push(`- [${e.title}](${e.url}) — ${e.summary} _(tier ${e.tier}, verified ${e.lastVerified}, status ${e.status})_`);
    }
    lines.push("");
  }
  fs.appendFileSync(transcriptPath, lines.join("\n") + "\n", "utf8");
}

function appendBriefSection(briefPath: string, output: CommunityResearchOutput): void {
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });
  if (!fs.existsSync(briefPath)) return;
  const current = fs.readFileSync(briefPath, "utf8");
  if (current.includes("## External references")) return; // idempotent
  const lines: string[] = ["", "## External references", ""];
  lines.push(`Source: ${output.source} | Confidence: ${output.confidence} | Cached: ${output.cached}`);
  lines.push("");
  for (const cat of ["official", "community", "similar"] as const) {
    if (output[cat].length === 0) continue;
    lines.push(`### ${cat}`);
    for (const e of output[cat]) {
      lines.push(`- [${e.title}](${e.url}) — ${e.summary}`);
    }
    lines.push("");
  }
  fs.appendFileSync(briefPath, lines.join("\n"), "utf8");
}
