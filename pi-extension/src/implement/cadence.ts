import * as fs from "node:fs";
import { atomicWriteJson } from "../io/atomic-write.js";
import { getCadencePath } from "../core/paths.js";

/**
 * Adaptive spawn cadence for the Plan stage.
 *
 * The Plan stage launches four scout subagents and three reviewer subagents.
 * Firing them all in one burst can trigger provider 429 rate limits; firing
 * them strictly serially is wasteful for users with healthy quotas. This
 * module records a per-project tier that the Plan-stage prompt consults:
 *
 *   A — Parallel burst: launch all N at once. (default start)
 *   B — Staggered:      launch one, sleep 5s, launch the next.
 *   C — Batch-2:        launch 2, sleep 10s, launch next 2.
 *   D — Fully serial:   launch one, wait for artifact, launch the next.
 *
 * Demotion triggers (rate-limit-style errors only — NOT auth, network, or
 * tool bugs, since slower spawning will not fix those):
 *   - "429" or "rate limit" / "rate-limited" / "overload" in any subagent result
 *   - 5xx server errors (500/502/503/504)
 *   - "stopReason: error" surfaced by pi-interactive-subagents v3.7.2+
 *
 * Promotion triggers: 3 consecutive clean Plan-stage approvals (B→A, C→B).
 * Tier D is the floor and requires manual `/senai-cadence-reset` to escape.
 *
 * State lives at `.IDE_Plans/pi-senai/spawn-cadence.json`. Writes go through
 * atomic-write so a crashed session never leaves a half-written file.
 */

export type CadenceTier = "A" | "B" | "C" | "D";

export interface CadenceHistoryEntry {
  ts: string;
  from: CadenceTier;
  to: CadenceTier;
  reason: string;
}

export interface CadenceState {
  _comment?: string;
  version: number;
  tier: CadenceTier;
  consecutiveCleanRuns: number;
  last429At: string | null;
  lastPromotableAt: string | null;
  history: CadenceHistoryEntry[];
}

/** Clean runs required to promote one tier (B→A, C→B). */
export const PROMOTE_AFTER_CLEAN = 3;

/** Clean runs required to escape tier D (D→C). D is otherwise the floor. */
export const D_FLOOR_CLEAN = 7;

/** Max history entries (FIFO). */
export const HISTORY_CAP = 50;

/** Matches rate-limit-style errors in any text. Conservative — only flags
 *  unambiguous provider-overload signals. */
export const RATE_LIMIT_RE =
  /\b(429|rate[- ]?limit(?:ed|ing)?|overload(?:ed)?|5\d\d|stopReason[: ]+"?error)\b/i;

const DEFAULT_STATE: CadenceState = {
  _comment:
    "Adaptive spawn cadence for the Plan stage. Managed by /senai-cadence-status and /senai-cadence-reset.",
  version: 1,
  tier: "A",
  consecutiveCleanRuns: 0,
  last429At: null,
  lastPromotableAt: null,
  history: [],
};

const TIER_ORDER: CadenceTier[] = ["A", "B", "C", "D"];

function tierIndex(t: CadenceTier): number {
  return TIER_ORDER.indexOf(t);
}

function isValidTier(v: unknown): v is CadenceTier {
  return v === "A" || v === "B" || v === "C" || v === "D";
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

/** Return a fresh default state. Useful for tests and first-run creation. */
export function defaultCadenceState(): CadenceState {
  return {
    _comment: DEFAULT_STATE._comment,
    version: 1,
    tier: "A",
    consecutiveCleanRuns: 0,
    last429At: null,
    lastPromotableAt: null,
    history: [],
  };
}

/** Load cadence state from disk. Returns the default state when the file is
 *  missing or corrupt; never throws. */
export function loadCadenceState(cwd: string): CadenceState {
  const file = getCadencePath(cwd);
  if (!fs.existsSync(file)) return defaultCadenceState();
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!isValidTier(parsed.tier)) return defaultCadenceState();
    const cleanRuns =
      typeof parsed.consecutiveCleanRuns === "number" &&
      Number.isFinite(parsed.consecutiveCleanRuns)
        ? Math.max(0, Math.floor(parsed.consecutiveCleanRuns))
        : 0;
    const history = Array.isArray(parsed.history)
      ? parsed.history
          .filter(
            (e): e is CadenceHistoryEntry =>
              !!e &&
              typeof e === "object" &&
              typeof (e as CadenceHistoryEntry).ts === "string" &&
              isValidTier((e as CadenceHistoryEntry).from) &&
              isValidTier((e as CadenceHistoryEntry).to) &&
              typeof (e as CadenceHistoryEntry).reason === "string",
          )
          .slice(-HISTORY_CAP)
      : [];
    return {
      _comment: DEFAULT_STATE._comment,
      version: 1,
      tier: parsed.tier,
      consecutiveCleanRuns: cleanRuns,
      last429At:
        typeof parsed.last429At === "string" || parsed.last429At === null
          ? (parsed.last429At as string | null)
          : null,
      lastPromotableAt:
        typeof parsed.lastPromotableAt === "string" ||
        parsed.lastPromotableAt === null
          ? (parsed.lastPromotableAt as string | null)
          : null,
      history,
    };
  } catch {
    return defaultCadenceState();
  }
}

/** Persist cadence state atomically. */
export function saveCadenceState(cwd: string, state: CadenceState): void {
  atomicWriteJson(getCadencePath(cwd), state);
}

function appendHistory(
  state: CadenceState,
  entry: CadenceHistoryEntry,
): void {
  state.history.push(entry);
  if (state.history.length > HISTORY_CAP) {
    state.history = state.history.slice(-HISTORY_CAP);
  }
}

/** Record a clean Plan-stage completion. Promotes one tier after
 *  PROMOTE_AFTER_CLEAN consecutive clean runs; B→A and C→B qualify.
 *  Tier A has no promotion target. Tier D requires D_FLOOR_CLEAN clean
 *  runs AND a manual `/senai-cadence-reset`; this function only stamps
 *  `lastPromotableAt` and does NOT auto-promote D→C.
 *  Returns the updated state (also persisted). */
export function recordCleanRun(cwd: string, now?: Date): CadenceState {
  const state = loadCadenceState(cwd);
  state.consecutiveCleanRuns += 1;

  if (state.tier === "D") {
    // Floor: mark when D could have been escaped, but do not auto-promote.
    if (state.consecutiveCleanRuns >= D_FLOOR_CLEAN && !state.lastPromotableAt) {
      state.lastPromotableAt = nowIso(now);
    }
  } else if (state.tier === "A") {
    // Ceiling: nothing to promote.
  } else if (state.consecutiveCleanRuns >= PROMOTE_AFTER_CLEAN) {
    const from = state.tier;
    const idx = tierIndex(from);
    const next = TIER_ORDER[idx - 1];
    state.tier = next;
    state.consecutiveCleanRuns = 0;
    state.lastPromotableAt = nowIso(now);
    appendHistory(state, {
      ts: state.lastPromotableAt,
      from,
      to: next,
      reason: `promote:${PROMOTE_AFTER_CLEAN}_clean`,
    });
  }

  saveCadenceState(cwd, state);
  return state;
}

/** Record a rate-limit-style error. Demotes one tier; A→B, B→C, C→D.
 *  Tier D is the floor — no further demotion. Resets the clean-run counter.
 *  Returns the updated state (also persisted). */
export function record429(cwd: string, now?: Date): CadenceState {
  const state = loadCadenceState(cwd);
  const from = state.tier;
  if (from !== "D") {
    const idx = tierIndex(from);
    const next = TIER_ORDER[idx + 1];
    state.tier = next;
    appendHistory(state, {
      ts: nowIso(now),
      from,
      to: next,
      reason: "demote:rate_limit",
    });
  } else {
    // Floor — record the event without demoting.
    appendHistory(state, {
      ts: nowIso(now),
      from: "D",
      to: "D",
      reason: "demote:rate_limit:floor",
    });
  }
  state.consecutiveCleanRuns = 0;
  state.last429At = nowIso(now);
  saveCadenceState(cwd, state);
  return state;
}

/** Reset cadence to tier A and clear all counters. Returns the new state. */
export function resetCadence(cwd: string, now?: Date): CadenceState {
  const prev = loadCadenceState(cwd);
  const fresh = defaultCadenceState();
  if (prev.tier !== "A" || prev.consecutiveCleanRuns !== 0) {
    appendHistory(fresh, {
      ts: nowIso(now),
      from: prev.tier,
      to: "A",
      reason: "reset:manual",
    });
  }
  saveCadenceState(cwd, fresh);
  return fresh;
}

/** Returns true if `text` matches the rate-limit-style error regex. */
export function isRateLimitError(text: string): boolean {
  return RATE_LIMIT_RE.test(text);
}

interface CadenceRule {
  /** Short label used in the injected block. */
  label: string;
  /** Single-line dispatch rule for the parent LLM. */
  rule: string;
  /** Recovery rule when a rate-limit error fires mid-batch. */
  recovery: string;
}

const RULES: Record<CadenceTier, CadenceRule> = {
  A: {
    label: "A (parallel burst)",
    rule:
      "Launch all 4 scouts in a single burst. They will run in parallel in their own multiplexer panes. No sleep between spawns.",
    recovery:
      "Call subagent_interrupt on any still-starting agents, wait 60s, then subagent_resume the failed session (NEVER cold-respawn). The extension auto-demotes to tier B for the rest of this run.",
  },
  B: {
    label: "B (staggered)",
    rule:
      "Launch one scout, run `bash` with `sleep 5`, launch the next. After all 4 are dispatched they run in parallel.",
    recovery:
      "Stop dispatching further scouts, wait 60s, then subagent_resume the failed session (NEVER cold-respawn). The extension auto-demotes to tier C for the rest of this run.",
  },
  C: {
    label: "C (batch-2)",
    rule:
      "Launch 2 scouts, run `bash` with `sleep 10`, launch the next 2. Wait 30s between batches if you spawn more than 4 agents.",
    recovery:
      "Stop dispatching further scouts, wait 60s, then subagent_resume the failed session (NEVER cold-respawn). The extension auto-demotes to tier D for the rest of this run.",
  },
  D: {
    label: "D (fully serial)",
    rule:
      "Launch one scout, wait for it to finish AND verify its artifact file is non-empty with `test -s`, then launch the next. No parallelism. This is the floor — escape via `/senai-cadence-reset` after the provider recovers.",
    recovery:
      "Wait 90s (longer than other tiers), then subagent_resume the failed session. Do not retry more than once per agent; if it still fails, surface the failure to the user.",
  },
};

/** Build the markdown block injected into the Plan-stage prompt. Tells the
 *  parent LLM which dispatch rule to apply for this run, and how to recover
 *  from a mid-run rate-limit error. */
export function buildCadenceBlock(state: CadenceState): string {
  const r = RULES[state.tier];
  const cleanNote =
    state.consecutiveCleanRuns > 0
      ? ` (${state.consecutiveCleanRuns} clean run${state.consecutiveCleanRuns === 1 ? "" : "s"} since last 429)`
      : " (fresh)";
  const last429Line = state.last429At
    ? `Last rate-limit error: ${state.last429At}`
    : "No rate-limit errors recorded.";
  const promotionLine =
    state.tier === "A"
      ? "Tier A is the ceiling — no promotion target."
      : state.tier === "D"
        ? `Tier D is the floor — escape requires ${D_FLOOR_CLEAN} clean runs AND a manual \`/senai-cadence-reset\`.`
        : `Promotes to the next-faster tier after ${PROMOTE_AFTER_CLEAN} consecutive clean runs.`;
  return [
    `## Spawn Cadence (adaptive)`,
    ``,
    `Current tier: **${r.label}**${cleanNote}`,
    ``,
    `- **Dispatch rule:** ${r.rule}`,
    `- **On rate-limit error (429 / 5xx / stopReason:error) during this run:** ${r.recovery}`,
    `- **Promotion:** ${promotionLine}`,
    `- ${last429Line}`,
    ``,
    `Only rate-limit-style errors demote the cadence. Auth failures, network drops, tool bugs, and missing artifacts do NOT — slower spawning will not fix those.`,
  ].join("\n");
}
