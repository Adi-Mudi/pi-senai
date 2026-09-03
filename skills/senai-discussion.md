---
name: senai-discussion
description: Conversational mission refinement for the active senai run (or pre-run). No subagents — parent LLM only, AskUserQuestion loops, writes mission-brief.md and discussion-NN-<slug>.md transcripts.
---

# Discussion Stage

A discussion is a quick conversational pass with the user to nail down the
mission before planning. It does NOT replace the Plan stage's research
interview — it precedes it. Discussions are orthogonal to the stage machine:
they can run from `none`, any active stage, or `delivered`.

## Goal

By the end of a discussion, `mission-brief.md` has every required section
filled, the user has approved the brief, and `/senai-plan` can consume the
refined mission without surprises.

## Required brief sections (in order)

`mission-brief.md` MUST have these top-level sections. Doctor warns on any
missing section at `/senai-doctor` time; `/senai-discussion-approve` warns
and asks before finalizing an incomplete brief.

1. `## Problem statement` — one paragraph the user agrees with.
2. `## Mission type` — pick exactly one: `feature`, `bugfix`, `exploration`.
3. `## Success criteria` — 2-5 measurable bullets.
4. `## Out-of-scope` — at least one bullet (what this mission will NOT do).
5. `## Open questions` — bullets the user wants resolved later.
6. `## Refined mission` — one paragraph the planner will use as the mission.

## Sequence

```
mission-type question
        │
        ▼
2-5 focused AskUserQuestion rounds (≤2 options each, end with `?`)
        │
        ▼
optional side-channel: parent decides "I need more info" → load skills/senai-community-research.md
        │     → 4-option source picker (web / official / community / similar)
        │     → run scout → write transcript + ## External references in brief
        ▼
draft mission-brief.md (top-level sections + each ## Discussion section)
        │
        ▼
/senai-discussion-approve (user confirms) ──▶ state.discussionEvents append
```

## AskUserQuestion rules (the tool rejects violations)

- Every question MUST end with `?`.
- `header` field MUST be ≤ 12 chars — one short word or acronym.
- 2-4 options per question; never open-ended free text.
- Total: 2-5 questions per discussion. More than 5 → split into a second discussion.

## Mission-type question (always first)

Ask once at the start of every discussion:

> Mission type?
> - feature — new behavior the project doesn't have yet
> - bugfix — fix a known broken or misbehaving thing
> - exploration — investigate before deciding (treat as a research task)

## Amendment pattern

When the user revises a previously finalized brief, the parent edits
`mission-brief.md` directly using the amendment cross-out pattern:

```markdown
- ~~old bullet text~~
- new bullet text
```

Use the project's `amendBullet` helper (see `mission-brief.ts`) when it fits;
otherwise inline the strike-through in the file. Never silently delete old
content — supersede it.

## Transcript file

Each discussion produces one transcript: `discussions/discussion-NN-<slug>.md`
(under the run directory if a run is active, otherwise under
`.IDE_Plans/senai/discussions/pre-run/`). The transcript is append-only:
append questions and answers as they happen. The file is never overwritten
within a discussion and is never deleted by `/senai-discussion-approve`.

## Plan supersede (ADR pattern)

When a `/senai-discussion` reveals the existing plan needs replacement:

1. Write the new plan as `plan-vN.md` next to `plan.md` (increment N).
2. Edit `plan.md` to add at the very top:

```markdown
> Superseded by plan-vN (Discussion NN, YYYY-MM-DD HH:MM)

```

3. The existing plan-approve flow stays unchanged — `/senai-approve` reads
   `plan.md` (now containing the banner + superseded content) and the
   planner references `plan-vN.md` from inside the approved plan body.

## Commands

- `/senai-discussion "<topic>"` — open a discussion (this skill is loaded).
- `/senai-discussion-approve` — finalize `mission-brief.md`, append the
  event to `state.discussionEvents`.

## Hard rules

- No subagents. The parent asks, the parent writes.
- Do not edit source code in any branch.
- Do not mutate `state.json.stage`. Discussions are a side-channel.
- If a run is active, the brief lives under `.IDE_Plans/senai/runs/<run-id>/mission-brief.md`.
- If no run is active, the brief lives under `.IDE_Plans/senai/discussions/pre-run/mission-brief.md`
  and `/senai-plan <mission>` consumes it on the next start.