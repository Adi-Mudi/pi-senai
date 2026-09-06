---
name: senai-brainstorm
description: Brainstorm with the user to refine the mission before planning. No subagents — parent LLM only, AskUserQuestion loops, writes mission-brief.md and discussion-NN-<slug>.md transcripts.
---

# Brainstorm Stage

A brainstorm is a quick conversational pass with the user to nail down the
mission before planning. It does NOT replace the Plan stage's research
interview — it precedes it. Discussions are orthogonal to the stage machine:
they can run from `none`, any active stage, or `delivered`.

## Goal

By the end of a discussion, `mission-brief.md` has every required section
filled, the user has approved the brief, and `/senai-plan` can consume the
refined mission without surprises.

## Required brief sections (in order)

`mission-brief.md` MUST have these top-level sections. Doctor warns on any
missing section at `/senai-doctor` time; `/senai-brainstorm-approve` warns
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
optional: parent decides "I need outside info" → dispatch community-researcher
        │     → web-research subagent picks a source, runs WebSearch+FetchURL,
        │       returns inline findings to parent
        │     → parent uses findings to ask better questions
        ▼
draft mission-brief.md (top-level sections + each ## Discussion section)
        │
        ▼
/senai-brainstorm-approve (user confirms) ──▶ state.discussionEvents append
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

## Specialist dispatch (Phase 3-7)

The parent LLM may dispatch specialist subagents for **read-only** research.
Dispatch decision tree (one branch per turn):

| User input | Decision |
| --- | --- |
| Quick single-file read | inline |
| Web research (official docs, community posts, library refs) | dispatch **community-researcher** (web-research) |
| Code scan across multiple files / patterns | dispatch scout-2 |
| Architecture / system design | dispatch scout-1 |
| Risk / dependency audit | dispatch scout-3 |
| PRD / requirements docs | dispatch scout-4 |
| Trade-off / option comparison | dispatch planner |
| None of the above | ask another AskUserQuestion round |

**Hard rules** (Phase 2 + 4):

- Parent owns Q&A — never delegate AskUserQuestion to a subagent.
- Parent owns `mission-brief.md` and the transcript — never delegate writing.
- Subagents are read-only — no Write, no Edit, no Bash for state mutation.
- Max 3 subagent dispatches per brainstorm (token budget).
- Subagents write ONLY inside `.IDE_Plans/pi-senai/Brainstorm/<brainstorm-run-id>/`.

**Web research in particular** (Phase 7):

Before Phase 7, the parent ran WebSearch + FetchURL inline. Now web research
goes through the same dispatch pipeline: the parent calls the dispatcher
with `agent: "web-research"` (role `community-researcher`), the dispatcher
strips Write/Edit/Bash from the tool list, and the subagent handles source
picking internally. The parent sees only the inline findings.

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
`.IDE_Plans/pi-senai/discussions/pre-run/`). The transcript is append-only:
append questions and answers as they happen. The file is never overwritten
within a brainstorm and is never deleted by `/senai-brainstorm-approve`.

## Plan supersede (ADR pattern)

When a `/senai-brainstorm` reveals the existing plan needs replacement:

1. Write the new plan as `plan-vN.md` next to `plan.md` (increment N).
2. Edit `plan.md` to add at the very top:

```markdown
> Superseded by plan-vN (Discussion NN, YYYY-MM-DD HH:MM)

```

3. The existing plan-approve flow stays unchanged — `/senai-approve` reads
   `plan.md` (now containing the banner + superseded content) and the
   planner references `plan-vN.md` from inside the approved plan body.

## Commands

- `/senai-brainstorm "<topic>"` — open a brainstorm (this skill is loaded).
- `/senai-brainstorm-approve` — finalize `mission-brief.md`, append the
  event to `state.discussionEvents`.

## Hard rules

- No subagents. The parent asks, the parent writes.
- Do not edit source code in any branch.
- Do not mutate `state.json.stage`. Discussions are a side-channel.
- If a run is active, the brief lives under `.IDE_Plans/pi-senai/runs/<run-id>/mission-brief.md`.
- If no run is active, the brief lives under `.IDE_Plans/pi-senai/discussions/pre-run/mission-brief.md`
  and `/senai-plan <mission>` consumes it on the next start.