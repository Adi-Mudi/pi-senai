---
name: senai-brainstorm
description: Brainstorm with the user to refine the mission before planning. Parent LLM drives the Q&A and writes the brief; specialist subagents (scout-1/2/3/4, planner, community-researcher) handle read-only research. Writes mission-brief.md + discussion-NN-<slug>.md + brainstorm-dispatch.md.
---

# Brainstorm Stage (Phases 1-8)

A brainstorm is a conversational pass with the user that turns a vague
request into a finalized `mission-brief.md` BEFORE `/senai-plan` runs.
It does NOT replace the Plan stage's research interview — it precedes it.

Discussions are orthogonal to the stage machine: they can run from `none`,
any active stage, or `delivered`. The brainstorm folder lives under
`.IDE_Plans/pi-senai/Brainstorm/<brainstorm-run-id>/`, isolated from the
active run state until `/senai-plan` adopts the run id.

## Goal

By the end of a discussion:

- `mission-brief.md` has every required section filled with REAL content
  (no `_TBD_` placeholders).
- The user has approved the brief via `/senai-brainstorm-approve`.
- `/senai-plan <mission>` can adopt the brainstorm run id without
  surprises.

## Brainstorm run id (Phase 1)

When `/senai-brainstorm "<seed>"` runs:

1. The command mints a brainstorm run id (format: `YYYY-MM-DD-HH-MM-brainstorm-<slug>`).
2. The id is persisted in `state.json.brainstormRunId`.
3. The folder `.IDE_Plans/pi-senai/Brainstorm/<id>/` is created on demand.
4. Subsequent turns of the same brainstorm session reuse the same id.
5. When `/senai-plan <mission>` runs, it adopts the brainstorm run id
   instead of minting a fresh one — no conflict between brainstorms and
   plans for the same project.

## Required brief sections (in order)

`mission-brief.md` MUST have these top-level sections, ALL filled with real
content (not `_TBD_`, not empty):

1. `## Problem statement` — one paragraph the user agrees with.
2. `## Mission type` — exactly one: `feature`, `bugfix`, `exploration`.
3. `## Success criteria` — 2-5 measurable bullets.
4. `## Out-of-scope` — at least one bullet (what this mission will NOT do).
5. `## Open questions` — bullets the user wants resolved later.
6. `## Refined mission` — one paragraph the planner will use as the mission.

`/senai-brainstorm-approve` HARD-REJECTS if any section is missing or
still a `_TBD_` placeholder (Phase 2 guard). The user must fill the
gaps before approve succeeds.

## Sequence

```
/senai-brainstorm "<seed>"            (Phase 2: refuse empty seed)
        │
        ▼
parent classifies the seed, asks mission-type question
        │
        ▼
2-5 focused AskUserQuestion rounds (≤2 options each, end with `?`)
        │
        ├─ quick read needed → parent reads inline, log "inline" decision
        ├─ web research needed → dispatch community-researcher (web-research)
        ├─ code scan needed → dispatch scout-2
        ├─ architecture/design → dispatch scout-1
        ├─ risk/dependency audit → dispatch scout-3
        ├─ PRD/docs audit → dispatch scout-4
        ├─ trade-off → dispatch planner
        └─ none of the above → ask another AskUserQuestion round
        │
        ▼
parent writes mission-brief.md draft (all 6 sections filled)
        │
        ▼
/senai-brainstorm-approve (user confirms)
        │   Phase 2 guard: hard-reject if any section is _TBD_
        │   Phase 5 audit: write brainstorm-dispatch.md with summary
        │   append event to state.discussionEvents
        ▼
Next: /senai-plan <mission> adopts brainstorm run id and starts scouts
```

## AskUserQuestion rules (the tool rejects violations)

- Every question MUST end with `?`.
- `header` field MUST be ≤ 12 chars — one short word or acronym.
- 2-4 options per question; never open-ended free text.
- Total: 2-5 questions per brainstorm. More than 5 → split into a second
  brainstorm run (each gets its own run id).

## Mission-type question (always first)

Ask once at the start of every brainstorm:

> Mission type?
> - feature — new behavior the project doesn't have yet
> - bugfix — fix a known broken or misbehaving thing
> - exploration — investigate before deciding (treat as a research task)

## Specialist dispatch (Phases 3-7)

The parent LLM may dispatch specialist subagents for **read-only** research.
The 4-layer pipeline (registry → dispatcher → guard → audit) enforces:

| Layer | What it does |
| --- | --- |
| Registry | Filters to 6 brainstorm-eligible roles (scout-1/2/3/4, planner, community-researcher). Suggests the best match for the user's topic. |
| Dispatcher | Strips Write/Edit/Bash from the agent's tool list. Enforces dispatch cap (3 per brainstorm) and 30s timeout per call. Refuses paths outside the brainstorm folder. |
| Guard | Refuses empty seed at command entry. Hard-rejects finalize on `_TBD_` placeholders. |
| Audit | Writes every dispatch decision to `brainstorm-dispatch.md` for review. |

### Dispatch decision tree (per user turn)

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

### Hard rules

- **Parent owns Q&A.** Never delegate AskUserQuestion to a subagent.
- **Parent owns the brief.** Never delegate writing `mission-brief.md` or
  the discussion transcript to a subagent.
- **Subagents are read-only.** No Write, no Edit, no Bash for state
  mutation — the dispatcher strips these tools before the spawn.
- **Max 3 subagent dispatches per brainstorm.** Keeps the token budget
  bounded.
- **Subagents write ONLY inside** `.IDE_Plans/pi-senai/Brainstorm/<brainstorm-run-id>/`.
- **Audit everything.** Every dispatch decision lands in
  `brainstorm-dispatch.md`. `/senai-doctor` reads the log and flags
  suspicious patterns.

### Web research in particular (Phase 7)

Before Phase 7, the parent ran WebSearch + FetchURL inline. Now web research
goes through the same dispatch pipeline: the parent calls the dispatcher
with `agent: "<slug>-community-researcher"` (the agent generated by
`/senai-generate-sub-agents`), the dispatcher strips Write/Edit/Bash
from the tool list, and the subagent picks a source internally. The parent
sees only the slim inline findings.

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

Each brainstorm produces one transcript:
`.IDE_Plans/pi-senai/Brainstorm/<brainstorm-run-id>/discussions/discussion-NN-<slug>.md`.

The transcript is append-only: append questions and answers as they happen.
The file is never overwritten within a brainstorm and is never deleted by
`/senai-brainstorm-approve`.

## Audit log (Phase 5)

Every brainstorm writes `.IDE_Plans/pi-senai/Brainstorm/<id>/brainstorm-dispatch.md`:

```markdown
<!-- pi-senai brainstorm-dispatch -->

# Brainstorm Dispatch Log

- Run: <brainstorm-run-id>
- Started: <ISO timestamp>
- Seed: "<user seed>"

## Decisions

### Turn 1 — 19:30
- User: user message
- Decision: dispatched scout
- Reason: multi-file scan
- ...

## Summary

- Total dispatches: 1
- Dispatches by agent: scout x1
- Inline reads: 0
- Brief sections filled: 6 / 6
```

`/senai-doctor` reads this log automatically. Suspicious patterns (cap
exceeded, inline scan with ≥5 files, partial brief at approve, skipped
dispatches, missing marker) surface as warnings.

## Plan supersede (ADR pattern)

When a brainstorm reveals the existing plan needs replacement:

1. Write the new plan as `plan-vN.md` next to `plan.md` (increment N).
2. Edit `plan.md` to add at the very top:

```markdown
> Superseded by plan-vN (Discussion NN, YYYY-MM-DD HH:MM)

```

3. The existing plan-approve flow stays unchanged.

## Commands

- `/senai-brainstorm "<seed>"` — open a brainstorm. The parent LLM drives
  the Q&A. Refuses empty seed.
- `/senai-brainstorm-approve` — finalize `mission-brief.md`. Hard-rejects
  if any section is still `_TBD_`. Writes the audit log.
- `/senai-purge-community-cache` — clear the community-research cache
  (`.IDE_Plans/pi-senai/.cache/community-research/`).

## Hard rules

- **No source-code edits.** Brainstorm is research, not implementation.
- **Do not mutate `state.json.stage`.** Discussions are orthogonal to
  the stage machine.
- **Brief lives under `.IDE_Plans/pi-senai/Brainstorm/<brainstorm-run-id>/`.**
  When `/senai-plan` adopts the run id, it copies the brief into the
  matching `runs/<run-id>/` folder. Nothing else writes there.
- **Each brainstorm run id is unique.** Multiple brainstorms for the same
  project get separate folders — no conflict, no overwrites.
