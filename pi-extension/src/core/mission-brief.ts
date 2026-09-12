import * as fs from "node:fs";
import * as path from "node:path";
import {
  getBrainstormDiscussionDir,
  getBrainstormMissionBriefPath,
  getPreRunDiscussionDir,
  getPreRunMissionBriefPath,
  getRunDiscussionsDir,
  getRunMissionBriefPath,
} from "./paths.js";
import type { BrainstormQuestion, MissionType } from "./state.js";
import { MISSION_TYPES } from "./state.js";
import { getMissionPack } from "./mission-packs.js";
import { atomicWriteFile } from "../io/atomic-write.js";

/** Marker written at the top of mission-brief.md while a brief is still
 *  being shaped — the /senai-brainstorm-approve command removes it. The
 *  marker is a single line so it is robust to editors. */
export const BRIEF_DRAFT_MARKER = "<!-- pi-senai mission-brief: draft -->\n";

/** Top-level sections every mission-brief.md must contain, in order. Doctor
 *  uses this list to validate both brainstorm-scoped and run-scoped briefs. */
export const REQUIRED_BRIEF_SECTIONS: readonly string[] = [
  "## Problem statement",
  "## Mission type",
  "## Success criteria",
  "## Out-of-scope",
  "## Open questions",
  "## Refined mission",
] as const;

/** Required sections for a mission type: the base 6 plus the pack's extra
 *  sections (bugfix adds 4; all other types currently add none). */
export function requiredBriefSectionsFor(type: MissionType | undefined): readonly string[] {
  return [...REQUIRED_BRIEF_SECTIONS, ...getMissionPack(type).extraBriefSections];
}

/** Parse the brief's own "## Mission type" section. Returns undefined when
 *  the section is missing or holds no known type — callers then fall back
 *  to base-6 / untyped behavior. Substring match with MISSION_TYPES order,
 *  so "test" never shadows a more specific type name in the body. */
export function parseBriefMissionType(brief: string): MissionType | undefined {
  const heading = "## Mission type";
  const idx = brief.indexOf(heading);
  if (idx === -1) return undefined;
  const bodyStart = idx + heading.length;
  const nextHeader = brief.slice(bodyStart).match(/\n##\s/);
  const bodyEnd = nextHeader ? bodyStart + nextHeader.index! : brief.length;
  const body = brief.slice(bodyStart, bodyEnd).toLowerCase();
  return MISSION_TYPES.find((t) => body.includes(t));
}

/** Pad a two-digit number. */
function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** ISO-ish timestamp safe for filenames: 2026-09-01-1244. */
export function slugifyStamp(d: Date = new Date()): string {
  return [
    d.getFullYear(),
    pad2(d.getMonth() + 1),
    pad2(d.getDate()),
    pad2(d.getHours()),
    pad2(d.getMinutes()),
  ].join("-");
}

/** Slugify a short free-form label. Falls back to "discussion" when the
 *  input collapses to an empty string after normalization. */
export function slugifyLabel(input: string): string {
  const out = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return out || "discussion";
}

export interface DiscussionLocation {
  transcriptPath: string;
  briefPath: string;
  /** Monotonic sequence number within the run (or brainstorm), 2-digit padded. */
  sequence: string;
  /** Brainstorm run id when the brief lives under .IDE_Plans/pi-senai/Brainstorm/. */
  brainstormRunId?: string;
}

export interface RecordDiscussionInput {
  cwd: string;
  /** Brainstorm run id — preferred path. Lives under
   *  .IDE_Plans/pi-senai/Brainstorm/<brainstormRunId>/. When present, takes
   *  precedence over legacy `runId`. */
  brainstormRunId?: string;
  /** Pass a runId to record under that active run; omit to record under the
   *  legacy pre-run folder (backward compat only). */
  runId?: string;
  label: string;
  /** Body of the transcript (the parent's Q&A log + free-form notes). */
  transcript: string;
  /** Mission type picked in UNDERSTAND. Bugfix briefs get the pack's extra
   *  sections seeded into the skeleton (with `_TBD_`) so the approve gates
   *  have headings to check. */
  missionType?: MissionType;
  /** A "## Discussion — <stamp>" section appended to the brief, with
   *  inline amendments (cross-outs + new bullets) per the approved design. */
  discussionSection: string;
}

/** Resolve the brief and transcript directories based on which id is set.
 *  Brainstorm run id wins (new flow); then run id (mid-run brainstorm);
 *  finally pre-run folder (legacy). */
function resolveDiscussionPaths(input: RecordDiscussionInput): {
  transcriptsDir: string;
  briefPath: string;
  brainstormRunId?: string;
} {
  if (input.brainstormRunId) {
    return {
      transcriptsDir: getBrainstormDiscussionDir(input.cwd, input.brainstormRunId),
      briefPath: getBrainstormMissionBriefPath(input.cwd, input.brainstormRunId),
      brainstormRunId: input.brainstormRunId,
    };
  }
  if (input.runId) {
    return {
      transcriptsDir: getRunDiscussionsDir(input.cwd, input.runId),
      briefPath: getRunMissionBriefPath(input.cwd, input.runId),
    };
  }
  return {
    transcriptsDir: getPreRunDiscussionDir(input.cwd),
    briefPath: getPreRunMissionBriefPath(input.cwd),
  };
}

/** Append a discussion transcript + a "## Discussion — <stamp>" section to
 *  the brief, then return the absolute paths the caller records into
 *  state.discussionEvents. The brief is created on first call; the draft
 *  marker stays at the top until /senai-brainstorm-approve clears it. */
export function recordDiscussion(input: RecordDiscussionInput): DiscussionLocation {
  const resolved = resolveDiscussionPaths(input);
  const { transcriptsDir, briefPath } = resolved;
  const { brainstormRunId } = resolved;

  fs.mkdirSync(transcriptsDir, { recursive: true });
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });

  // Sequence number = count of existing transcript files + 1 (2-digit padded).
  const existing = fs
    .readdirSync(transcriptsDir)
    .filter((name) => /^discussion-\d{2}-/.test(name));
  const sequence = pad2(existing.length + 1);

  const transcriptPath = path.join(
    transcriptsDir,
    `discussion-${sequence}-${slugifyLabel(input.label)}.md`,
  );

  atomicWriteFile(transcriptPath, input.transcript, "utf8");

  // Append (or create) the brief. The draft marker stays on top while the
  // brief is unfinalized; the append is implemented as read-then-rewrite
  // through atomicWriteFile so a crash mid-append never leaves a truncated
  // brief. appendFileSync is not atomic.
  const stamp = slugifyStamp();
  const sectionHeader = `## Discussion — ${stamp} (${sequence})\n\n`;
  const sectionBody = `${sectionHeader}${input.discussionSection.trim()}\n\n`;

  if (!fs.existsSync(briefPath)) {
    const skeleton = [
      BRIEF_DRAFT_MARKER,
      ...requiredBriefSectionsFor(input.missionType).map((s) => `${s}\n\n_TBD_\n`),
      "\n---\n\n## Discussions\n\n",
      sectionBody,
    ].join("\n");
    atomicWriteFile(briefPath, skeleton, "utf8");
  } else {
    const current = fs.readFileSync(briefPath, "utf8");
    if (!current.includes("## Discussions")) {
      atomicWriteFile(briefPath, `${current}\n---\n\n## Discussions\n\n${sectionBody}`, "utf8");
    } else {
      atomicWriteFile(briefPath, `${current}${sectionBody}`, "utf8");
    }
  }

  return { transcriptPath, briefPath, sequence, brainstormRunId };
}

/**
 * Clear the draft marker (first line) of mission-brief.md, leaving the
 * rest intact. Called by /senai-brainstorm-approve.
 *
 * Idempotent: if the marker is already gone (the brief was finalized on a
 * previous call), this is a no-op. Before rewriting, the function copies
 * the unfinalized brief to `<briefPath>.bak` so a corrupted finalization
 * (or an interrupted write) can be recovered by hand. Writes go through
 * the atomic helper.
 */
export function finalizeMissionBrief(briefPath: string): void {
  if (!fs.existsSync(briefPath)) return;
  const current = fs.readFileSync(briefPath, "utf8");
  if (!current.startsWith(BRIEF_DRAFT_MARKER)) return;
  // Keep a .bak of the pre-finalize brief so the user can recover if needed.
  try {
    fs.copyFileSync(briefPath, `${briefPath}.bak`);
  } catch {
    // Best-effort; do not block finalize when copy fails.
  }
  atomicWriteFile(briefPath, current.slice(BRIEF_DRAFT_MARKER.length));
}

/** Cross-out old bullet text and append a replacement, preserving the
 *  superseded text in place. Pure helper used by the parent LLM via the
 *  skill — exposed for unit testing. */
export function amendBullet(brief: string, oldLine: string, replacement: string): string {
  const crossed = `~~${oldLine}~~`;
  const replacementLine = `- ${replacement}`;
  // Replace the first matching bullet (case-sensitive). The skill tells the
  // parent to pass the exact line text, so the first match is enough.
  const bulletLine = `- ${oldLine}`;
  if (!brief.includes(bulletLine)) {
    return `${brief}\n${replacementLine}`;
  }
  const struck = brief.replace(bulletLine, `${crossed}\n${replacementLine}`);
  return struck;
}

/** Validate a brief has all required top-level sections, in order.
 *  Returns the list of missing sections; empty list = ok. The section list
 *  defaults to the base 6; callers that know the mission type pass
 *  requiredBriefSectionsFor(type) so pack sections are validated too. */
export function validateBriefSections(
  brief: string,
  sections: readonly string[] = REQUIRED_BRIEF_SECTIONS,
): string[] {
  const missing: string[] = [];
  let cursor = 0;
  for (const section of sections) {
    const idx = brief.indexOf(section, cursor);
    if (idx === -1) {
      missing.push(section);
      continue;
    }
    cursor = idx + section.length;
  }
  return missing;
}

/** Placeholder marker for unfilled brief sections. Recognized by
 *  validateBriefContent below. */
export const BRIEF_CONTENT_PLACEHOLDER = "_TBD_";

/** True when the body between two section headers is empty or contains only
 *  the placeholder marker. Pure — no side effects. */
function bodyIsPlaceholder(body: string): boolean {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return true;
  return lines.every((l) => l === BRIEF_CONTENT_PLACEHOLDER);
}

/** Shared body of validateBriefContent / validateBriefContentForType:
 *  returns the sections (from the given list) that are missing headings or
 *  whose body is empty / placeholder-only. */
function unfilledSections(brief: string, sections: readonly string[]): string[] {
  const unfilled: string[] = [];
  for (const section of sections) {
    const idx = brief.indexOf(section);
    if (idx === -1) {
      // Missing heading is also "unfilled" — caller can decide whether to
      // call this "missing" or "placeholder", but the user-facing guard
      // treats both the same way.
      unfilled.push(section);
      continue;
    }
    const bodyStart = idx + section.length;
    const nextHeader = brief.slice(bodyStart).match(/\n##\s/);
    const bodyEnd = nextHeader ? bodyStart + nextHeader.index! : brief.length;
    const body = brief.slice(bodyStart, bodyEnd);
    if (bodyIsPlaceholder(body)) {
      unfilled.push(section);
    }
  }
  return unfilled;
}

/** Validate that every required section has REAL content — not `_TBD_` and
 *  not empty. Returns the list of unfilled section names; empty list = ok.
 *  This is stricter than validateBriefSections, which only checks that the
 *  section heading exists. The brainstorm guard layer (Phase 2) wraps this
 *  to hard-reject finalize when the brief is still skeletal. */
export function validateBriefContent(brief: string): string[] {
  return unfilledSections(brief, REQUIRED_BRIEF_SECTIONS);
}

/** validateBriefContent against the section list of a specific mission
 *  type. Bugfix briefs must fill the base 6 plus the 4 pack sections; a
 *  hard reject names every missing or placeholder section so the parent
 *  can fix them in one pass. */
export function validateBriefContentForType(
  raw: string,
  type: MissionType | undefined,
): { ok: boolean; reason?: string } {
  const unfilled = unfilledSections(raw, requiredBriefSectionsFor(type));
  if (unfilled.length === 0) return { ok: true };
  return {
    ok: false,
    reason: `Mission brief is missing or still has ${BRIEF_CONTENT_PLACEHOLDER} placeholders in: ${unfilled.join(", ")}`,
  };
}

/** ──────────────────────────────────────────────────────────────────────
 *  Decision ledger (Agreed / Not wanted / Open)
 *  ────────────────────────────────────────────────────────────────────── */

/** Markers wrapping the machine-managed decisions block inside a discussion
 *  document. The block is REGENERATED from state.brainstormQuestions on
 *  every change, so it is always consistent — no incremental edits. */
export const DECISIONS_BLOCK_START = "<!-- pi-senai decisions:start -->";
export const DECISIONS_BLOCK_END = "<!-- pi-senai decisions:end -->";

/** Render the three decision lists from the question ledger.
 *  - agreed  → "## Agreed"
 *  - not-wanted / replaced → "## Not wanted" (with reason; replaced keeps
 *    the strikethrough so the superseded text survives)
 *  - draft / discussing → "## Open" (with the current state labeled) */
export function renderDecisionsBlock(questions: BrainstormQuestion[]): string {
  const agreed = questions.filter((q) => q.state === "agreed");
  const rejected = questions.filter((q) => q.state === "not-wanted" || q.state === "replaced");
  const open = questions.filter((q) => q.state === "draft" || q.state === "discussing");

  const lines: string[] = [DECISIONS_BLOCK_START, "", "## Agreed", ""];
  if (agreed.length === 0) lines.push("- (none yet)");
  for (const q of agreed) {
    lines.push(`- ${q.id}: ${q.text}${q.suggestedAnswer ? ` — ${q.suggestedAnswer}` : ""}`);
  }
  lines.push("", "## Not wanted", "");
  if (rejected.length === 0) lines.push("- (none)");
  for (const q of rejected) {
    const text = q.state === "replaced" ? `~~${q.text}~~ (superseded)` : q.text;
    lines.push(`- ${q.id}: ${text} — reason: ${q.reason ?? "(no reason recorded)"}`);
  }
  lines.push("", "## Open", "");
  if (open.length === 0) lines.push("- (none)");
  for (const q of open) {
    lines.push(`- ${q.id}: ${q.text} (state: ${q.state})`);
  }
  lines.push("", DECISIONS_BLOCK_END);
  return lines.join("\n");
}

/** Resolve the discussion document the ledger syncs into: the newest
 *  discussion-NN-*.md in the brainstorm discussions dir, created as
 *  discussion-01-decisions.md when none exists yet. */
function resolveLedgerDocPath(cwd: string, brainstormRunId: string): string {
  const dir = getBrainstormDiscussionDir(cwd, brainstormRunId);
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs
    .readdirSync(dir)
    .filter((n) => /^discussion-\d{2}-/.test(n))
    .sort();
  if (existing.length > 0) return path.join(dir, existing[existing.length - 1]);
  return path.join(dir, "discussion-01-decisions.md");
}

/** Write (or refresh) the decisions block in the current discussion
 *  document. Returns the document path so callers can surface it. */
export function syncDecisionsToDiscussionDoc(
  cwd: string,
  brainstormRunId: string,
  questions: BrainstormQuestion[],
): string {
  const docPath = resolveLedgerDocPath(cwd, brainstormRunId);
  const block = renderDecisionsBlock(questions);
  const current = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
  const start = current.indexOf(DECISIONS_BLOCK_START);
  const end = current.indexOf(DECISIONS_BLOCK_END);
  let next: string;
  if (start !== -1 && end !== -1 && end > start) {
    next =
      current.slice(0, start) +
      block +
      current.slice(end + DECISIONS_BLOCK_END.length);
  } else {
    const base = current.trimEnd();
    next = base ? `${base}\n\n${block}\n` : `${block}\n`;
  }
  atomicWriteFile(docPath, next, "utf8");
  return docPath;
}

/** Append a rejected question to the brief's "## Out-of-scope" section with
 *  its reason ("deferred, not forgotten"). Idempotent per question id.
 *  Returns true when a bullet was added. */
export function appendOutOfScopeDecision(
  briefPath: string,
  question: BrainstormQuestion,
): boolean {
  if (!fs.existsSync(briefPath)) return false;
  const bullet = `- ${question.id}: ${question.text} — not wanted: ${question.reason ?? "(no reason recorded)"}`;
  const current = fs.readFileSync(briefPath, "utf8");
  if (current.includes(`- ${question.id}:`)) return false;
  const heading = "## Out-of-scope";
  const idx = current.indexOf(heading);
  if (idx === -1) {
    atomicWriteFile(briefPath, `${current.trimEnd()}\n\n${heading}\n\n${bullet}\n`, "utf8");
    return true;
  }
  const bodyStart = idx + heading.length;
  const nextHeader = current.slice(bodyStart).match(/\n##\s/);
  const bodyEnd = nextHeader ? bodyStart + nextHeader.index! : current.length;
  const body = current.slice(bodyStart, bodyEnd).trimEnd();
  const insert = `${body}\n${bullet}\n`;
  atomicWriteFile(
    briefPath,
    current.slice(0, bodyStart) + "\n\n" + insert.trimStart() + current.slice(bodyEnd),
    "utf8",
  );
  return true;
}