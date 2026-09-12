---
name: senai-brainstorm
description: Brainstorm with the user to refine the mission before planning. New lifecycle — UNDERSTAND loop with hard lock first, then optional scans, then informed discussion with suggested answers, batch confirm, coverage check, 3-outcome approve. Writes mission-brief.md + discussion-NN-<slug>.md + brainstorm-dispatch.md.
---

# Brainstorm Stage (Lifecycle v2)

A brainstorm is a conversational pass with the user that turns a vague
request into a finalized `mission-brief.md` BEFORE `/senai-plan` runs.
It does NOT replace the Plan stage's research interview — it precedes it.

Discussions are orthogonal to the stage machine: they can run from `none`,
any active stage, or `delivered`. The brainstorm folder lives under
`.IDE_Plans/pi-senai/Brainstorm/<brainstorm-run-id>/`, isolated from the
active run state until `/senai-plan` adopts the run id.

## The golden rule

**Understand first. Scan second. Ask smart questions third.**

No subagent, no scan, and no approve may run before the user has confirmed
the parent's understanding. Parallel agents on a raw seed produce confident
garbage — the lock exists to prevent exactly that.

## Lifecycle overview

```
/senai-brainstorm "<seed>"
       │
       ▼
[0] UNDERSTAND        chat only, inline reads (1-2 files), NO subagents
       ▼
[1] CONFIRM loop      short paragraph → user agrees or corrects → repeat
                      HARD LOCK: nothing below runs until confirmed
       ▼
[2] SCAN-PLAN GATE    one question: run / adjust / skip(with warning)
       ▼
[3] SCANS             parallel, background, pane optional (display only)
       ▼
[4] INFORM            facts + 2-4 questions, each WITH a suggested answer
       ▼
[5] DISCUSS loop ◄────┐ states: draft → discussing → agreed /
       ▼              │              not-wanted(+reason) / replaced
[6] BATCH CONFIRM ────┘ one structured call, "Discuss more" loops back
       ▼
[7] COVERAGE CHECK    automatic ✓/✗ table (show-only)
       ▼
[8] APPROVE           /senai-brainstorm-approve → Go / Clarify / Kill
```

Per mission type (from MISSION_SEQUENCE in the extension — the source of
truth), only the TAIL changes; the trunk [0]–[7] is shared by all types:

| Type | Default scans | After [7] |
| --- | --- | --- |
| feature | code + doc + community | approve → plan → implement → document → deliver |
| bugfix | code + doc | approve → plan → implement → document → deliver |
| upgrade | code + community | approve → plan → implement → document → deliver |
| docs | doc | approve → plan → implement(= edit .md) → deliver |
| test | code | approve → plan → implement(= write tests) → deliver |
| explore | community + doc | DECIDE door (go / clarify / kill) → STOP. No plan, no implement. |

## [0] UNDERSTAND

The parent reads the seed and may do a QUICK INLINE look (1-2 files, its
own Read/Grep — NEVER a subagent at this stage).

Then the parent asks the mission-type question plus at most 2 follow-ups,
chosen DYNAMICALLY for this exact seed (no fixed script — every problem,
project, and function is different):

> Mission type?
> - bugfix — fix a known broken or misbehaving thing
> - feature — new behavior the project doesn't have yet (also: starting from zero)
> - upgrade — modernize/replace/improve something that already exists
> - explore — research only; ends in a go / clarify / kill decision, not code
> - docs — documentation-only work (write or update .md files)
> - test — write tests (unit / integration / e2e) for existing behavior

Question packs (starting points, adapt to the actual seed):

- **bugfix** → What is happening? What should happen? Where do you see it?
  Does it break anything else? Is this error from your own code, or from a
  library/framework/dependency? (If library → community scan is auto-added
  at the scan gate.)
- **feature** → Who will use it? What should it do? What should it NOT do?
  Does it connect to existing parts?
- **upgrade** → What exists today? Any conflicts found? What needs
  migration? How do we test it?
- **explore** → What decision must this research answer? What options exist
  already? What evidence would change your mind?
- **docs** → Which documents are in scope? Who reads them? What is outdated
  or missing today?
- **test** → Which behavior is untested? Unit, integration, or e2e? What
  run proves the suite is green?

Rules:

- 1-3 questions per round, max 5 total per brainstorm.
- Every question must change a real decision. If answering it changes
  nothing, do NOT ask it.
- If the seed is already clear: ask ZERO follow-ups and go straight to [1].

## [1] CONFIRM UNDERSTANDING (loop + hard lock)

The parent writes ONE short paragraph — plain language, no jargon:

> "Here is what I understood: <paragraph>. Correct?"

- User agrees → parent records it via the session tool:
  `senai_brainstorm_session({ action: "confirm-understanding", missionType })`
  (persists `understandingConfirmed: true` + `missionType` in state.json).
- User corrects → parent rewrites the paragraph and shows it again.
- This repeats until the user confirms.

**HARD LOCK:** while `understandingConfirmed` is not true in state.json:
- no scan gate, no subagent dispatch, no brief writing, no approve.
The scan gate and dispatch sections below are sealed until the lock opens.

## [2] SCAN-PLAN GATE (one gate only)

After confirmation, the parent derives a scan plan from the mission type —
the defaults come from MISSION_SEQUENCE (see the table in the lifecycle
overview above): bugfix → code + doc, feature → code + doc + community,
upgrade → code + community, docs → doc, test → code,
explore → community + doc.

Bugfix conditional rule: when the UNDERSTAND discussion says the error
originates from a library/framework/dependency, the community scan is
AUTO-ADDED to the bugfix defaults (code + doc + community). The gate
question still confirms the final selection with the user.

One AskUserQuestion:

> "Plan: <scans>. Proceed?"
> - Run as proposed (default)
> - Adjust scans (picker: code / doc / community, multi-select)
> - Skip scans (allowed WITH warning: "downstream rework risk increases")

The parent persists the choice via
`senai_brainstorm_session({ action: "set-scans", scans: [...] })`.
Scan types:

| Scan | Looks at | Roles | Timeout |
| --- | --- | --- | --- |
| CODE-SCAN | your source code | scout-2, scout-3 | 30s |
| DOC-SCAN | your PRDs, plans, docs | scout-4, scout-1 | 30s |
| COMMUNITY-SCAN | internet, official docs, forums | community-researcher | 90s |

## [3] SCANS (parallel, background)

- Only the selected scans run, in parallel, max 2 dispatches per type.
- Each dispatch is prepared via the dispatcher (`scanType` set), which
  enforces role-per-type, per-type cap (2), read-only tools, and the
  per-type timeout.
- Artifacts go to `scout-notes/code/<role>.md`, `scout-notes/doc/<role>.md`,
  `scout-notes/community/<role>.md` inside the brainstorm folder.
- Timeout or failure → mark the topic "needs research" and move on; never
  silently downgrade the questions.
- A live subagent pane (tmux/cmux/zellij/WezTerm) is OPTIONAL DISPLAY ONLY.
  The pane is never the source of truth — scout-notes files are.

## [4] INFORM

The parent merges the scan notes into a 1-page context brief:

- key facts (max 5 bullets)
- risks / unknowns
- 2-4 draft questions — EACH WITH A SUGGESTED DEFAULT ANSWER, so the user
  can accept with one word

Each question enters state.json via
`senai_brainstorm_session({ action: "upsert-question", question: {...} })`
with state `"draft"`.

## [5] DISCUSS loop

Normal chat. Per user reply the parent updates question states:

- answer given → `discussing` (then `agreed` when the user confirms it)
- user rejects → `not-wanted` WITH a reason (required)
- answer replaced later → `replaced` (strikethrough, old text kept)
- new topic raised → new question, state `draft`

Hard rules:

- **Agreed decisions are written to the discussion document IMMEDIATELY**
  (under `## Agreed`) — not at the end.
- **Rejected decisions are written too** (under `## Not wanted`, with the
  reason). "Deferred, not forgotten": the planning stage must know what the
  user refused, or it will suggest it again.
- The document's third list, `## Open`, mirrors unresolved questions.
- Mid-loop research: resume the earlier subagent session (never cold-spawn
  the same role twice). Counts against the caps.
- Extra questions are allowed ONLY when a scan or the discussion found
  something real (a conflict, a risk, a new option). No filler questions.
- Atomic write to state.json after every change.

Exit ONLY when: the user says "done" / "ready to confirm", OR every
question is in a terminal state (agreed / not-wanted / replaced).
"Has content" is NOT an exit condition — a parent's own suggestion in a
draft was never discussed.

## [5a] BUGFIX DISCUSSION CHECKLIST (bugfix missions only)

When the mission type is bugfix, each item below becomes a DISCUSS
question via `upsert-question` (same states and rules as [5]):

1. Reproduction steps (exact actions + input data)
2. Expected vs actual behavior
3. Error evidence (stack trace, logs, messages)
4. Environment (versions, config, OS)
5. Root-cause hypothesis (from scans + discussion)
6. Blast radius (shared code affected? scout-3 output)
7. Community findings (when the community scan ran)
8. Regression test idea (which test fails before the fix?)

The agreed answers feed the 4 extra bugfix brief sections — see
"Required brief sections" below.

## [6] BATCH CONFIRM (structured, no parsing)

ONE AskUserQuestion call with one entry per open question:

> Q<n>: <question text>?
> - Confirm: <suggested answer>
> - Discuss more
> - Cancel (with reason)

- Confirm → state `agreed`, appended to `## Agreed`.
- Discuss more → back to [5].
- Cancel → state `not-wanted`, reason recorded, copied to `## Not wanted`
  AND into the brief's `## Out-of-scope` section.

Never parse free-text confirmation strings — structured entries only.

## [7] COVERAGE CHECK (automatic, show-only)

Before approve, the parent shows a coverage table:

| Area | Covered? |
| --- | --- |
| Scope | ✓/✗ |
| Out-of-scope | ✓/✗ |
| Data model | ✓/✗ |
| Edge cases / failure modes | ✓/✗ |
| Non-functional needs | ✓/✗ |
| Success criteria + verification step | ✓/✗ |

When the mission type is bugfix, add rows: Reproduction steps, Regression
test plan.

This is informational. It does NOT block by itself — the user decides at
approve. (The hard blocks in [8] are separate.)

## [8] APPROVE

`/senai-brainstorm-approve`:

1. HARD BLOCK: `understandingConfirmed` is false (new-flow sessions).
2. HARD BLOCK: any question is `draft` or `discussing`.
3. HARD BLOCK (explore only): no decide door recorded yet — record it via
   `senai_brainstorm_session({ action: "set-decision", decision })` first.
4. HARD REJECT: any brief section is `_TBD_` or empty (unchanged).
5. Then THREE outcomes:
   - **Go** → brief finalized (draft marker stripped, `.bak` saved), audit
     log written, then the handoff choice below.
   - **Needs clarification** → back to [5] with new draft questions.
   - **Kill** → archive the brainstorm folder, record the reason in the
     audit log. A rejected mission is a valid brainstorm result.

### Explore missions end at the DECIDE door

Explore replaces the approve-road with a decision. Before approve, the
parent asks the user to pick ONE door and records it:

- **go** → the decision document (the finalized brief) becomes the seed of
  a NEW brainstorm: `/senai-brainstorm "see <decision-doc-path>"`. Explore
  itself never plans or implements. The next brainstorm starts fresh — the
  finished explore session is reset automatically at entry.
- **clarify** → more research needed; run `/senai-brainstorm` again on the
  same topic.
- **kill** → dropped; nothing further.

`/senai-plan` refuses to adopt an explore brainstorm — there is no plan
stage for research-only missions.

### Handoff choice (after Go)

Ask once:

> "How do you want to continue to planning?"
> - Continue here (default)
> - Compact this session, then continue
> - Fresh session

For compact and fresh: the compact summary AND the next `/senai-plan`
carry the discussion document ID + path
(`.IDE_Plans/pi-senai/Brainstorm/<id>/discussions/discussion-NN-<slug>.md`).
`/senai-plan` in a fresh session resolves the document by that ID and reads
it directly — the file is the truth, not chat memory.

## Required brief sections

`mission-brief.md` MUST have these top-level sections, ALL filled with real
content (not `_TBD_`, not empty):

1. `## Problem statement` — one paragraph the user agrees with.
2. `## Mission type` — exactly one: `bugfix`, `feature`, `upgrade`,
   `explore`, `docs`, `test`.
3. `## Success criteria` — 2-5 measurable bullets, ending with one
   end-to-end verification step.
4. `## Out-of-scope` — at least one bullet; rejected questions land here
   with their reasons.
5. `## Open questions` — bullets the user wants resolved later.
6. `## Refined mission` — one paragraph the planner will use as the mission.

Bugfix briefs add 4 mandatory sections (hard reject at approve if `_TBD_`
or empty):

7. `## Reproduction steps` — exact actions + input data that trigger the bug.
8. `## Expected vs actual` — what should happen vs what actually happens.
9. `## Root cause` — the confirmed cause, verified against the code.
10. `## Regression test plan` — the test that fails before the fix and
    passes after it.

## AskUserQuestion rules (the tool rejects violations)

- Every question MUST end with `?`.
- `header` field MUST be ≤ 12 chars — one short word or acronym.
- 2-4 options per question; never open-ended free text.

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

## Audit log

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
exceeded, dispatch before understanding confirmed, inline scan with ≥5
files, partial brief at approve, missing marker) surface as warnings.

## Plan supersede (ADR pattern)

When a brainstorm reveals the existing plan needs replacement:

1. Write the new plan as `plan-vN.md` next to `plan.md` (increment N).
2. Edit `plan.md` to add at the very top:

```markdown
> Superseded by plan-vN (Discussion NN, YYYY-MM-DD HH:MM)

```

3. The existing plan-approve flow stays unchanged.

## Commands

- `/senai-brainstorm "<seed>"` — open a brainstorm at [0] UNDERSTAND.
  Refuses empty seed.
- `/senai-brainstorm-approve` — finalize `mission-brief.md` per [8].
  Hard-blocks unconfirmed understanding and open questions; hard-rejects
  `_TBD_` sections. Offers Go / Needs clarification / Kill.
- `/senai-purge-community-cache` — clear the community-research cache
  (`.IDE_Plans/pi-senai/.cache/community-research/`).

## Hard rules

- **Understand before scan.** No subagent before `understandingConfirmed`.
- **No source-code edits.** Brainstorm is research, not implementation.
- **Do not mutate `state.json.stage`.** Discussions are orthogonal to
  the stage machine.
- **Parent owns Q&A.** Never delegate AskUserQuestion to a subagent.
- **Parent owns the brief.** Never delegate writing `mission-brief.md` or
  the discussion document to a subagent.
- **Subagents are read-only.** The dispatcher strips Write/Edit/Bash.
- **Caps:** max 3 dispatches per brainstorm total, max 2 per scan type.
- **Subagents write ONLY inside**
  `.IDE_Plans/pi-senai/Brainstorm/<brainstorm-run-id>/`.
- **Audit everything.** Every dispatch decision lands in
  `brainstorm-dispatch.md`.
- **The discussion document is the truth.** Agreed, not-wanted (with
  reasons), and open items all live there. Planning reads the file, not
  chat memory.

Bugfix missions add these NEVER rules (from BUGFIX_PACK — strict):

- **Never delete a failing test to make the suite green.**
- **Never weaken assertions to make a test pass.**
- **Never swallow or hide an error instead of fixing the root cause.**
- **Never fix what you cannot reproduce.**
