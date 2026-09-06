import * as fs from "node:fs";
import * as path from "node:path";
import {
  getPreRunDiscussionDir,
  getPreRunMissionBriefPath,
  getRunDiscussionsDir,
  getRunMissionBriefPath,
} from "./paths.js";
import { atomicWriteFile } from "../io/atomic-write.js";

/** Marker written at the top of mission-brief.md while a brief is still
 *  being shaped — the /senai-brainstorm-approve command removes it. The
 *  marker is a single line so it is robust to editors. */
export const BRIEF_DRAFT_MARKER = "<!-- pi-senai mission-brief: draft -->\n";

/** Top-level sections every mission-brief.md must contain, in order. Doctor
 *  uses this list to validate both pre-run and run-scoped briefs. */
export const REQUIRED_BRIEF_SECTIONS: readonly string[] = [
  "## Problem statement",
  "## Mission type",
  "## Success criteria",
  "## Out-of-scope",
  "## Open questions",
  "## Refined mission",
] as const;

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
  /** Monotonic sequence number within the run (or pre-run), 2-digit padded. */
  sequence: string;
}

export interface RecordDiscussionInput {
  cwd: string;
  /** Pass a runId to record under that run; omit to record under pre-run. */
  runId?: string;
  label: string;
  /** Body of the transcript (the parent's Q&A log + free-form notes). */
  transcript: string;
  /** A "## Discussion — <stamp>" section appended to the brief, with
   *  inline amendments (cross-outs + new bullets) per the approved design. */
  discussionSection: string;
}

/** Append a discussion transcript + a "## Discussion — <stamp>" section to
 *  the brief, then return the absolute paths the caller records into
 *  state.discussionEvents. The brief is created on first call; the draft
 *  marker stays at the top until /senai-brainstorm-approve clears it. */
export function recordDiscussion(input: RecordDiscussionInput): DiscussionLocation {
  const runId = input.runId;
  const transcriptsDir = runId
    ? getRunDiscussionsDir(input.cwd, runId)
    : getPreRunDiscussionDir(input.cwd);
  const briefPath = runId
    ? getRunMissionBriefPath(input.cwd, runId)
    : getPreRunMissionBriefPath(input.cwd);

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
      ...REQUIRED_BRIEF_SECTIONS.map((s) => `${s}\n\n_TBD_\n`),
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

  return { transcriptPath, briefPath, sequence };
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
 *  Returns the list of missing sections; empty list = ok. */
export function validateBriefSections(brief: string): string[] {
  const missing: string[] = [];
  let cursor = 0;
  for (const section of REQUIRED_BRIEF_SECTIONS) {
    const idx = brief.indexOf(section, cursor);
    if (idx === -1) {
      missing.push(section);
      continue;
    }
    cursor = idx + section.length;
  }
  return missing;
}