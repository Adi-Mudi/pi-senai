# Senai Sequence

## Subagent Senaition — Plan → Implement → Document → Deliver

**Version:** 1.4  
**Date:** 2026-07-01  
**Status:** Current

---

## 1. Overview

Pi Senai is a stage-gated agent orchestration extension for Pi. Each stage is a sequence of specialized subagents. Every stage ends with a parent approval gate. Running `/senai-approve` advances the run through the completed stage **and** automatically starts the next stage.

**Brainstorm entry point.** Before the Plan stage, a user can run `/senai-brainstorm "<topic>"` to refine the mission in a structured conversational pass. Six mission types are supported — `bugfix`, `feature`, `upgrade`, `explore`, `docs`, `test` — each with its own stage sequence and default scans from the `MISSION_SEQUENCE` registry (`brainstorm/registry.ts`). The lifecycle: [0] UNDERSTAND (dynamic, mission-type-based questions) → [1] CONFIRM loop (hard-locked by `state.understandingConfirmed` — the prompt stays sealed until the user confirms) → [2] one scan-selection gate (code / doc / community, per-type defaults) → [3] parallel scout/community-researcher scans → [4] INFORM → [5] DISCUSS loop (question states: draft / discussing / agreed / not-wanted / replaced) → [6] batch confirmation → [7] coverage table → [8] `/senai-brainstorm-approve` with go / clarify / kill outcomes and a continue / compact / fresh-session handoff choice. Type differences: `explore` ends at a DECIDE door (go / clarify / kill, recorded via the `set-decision` tool action) with no plan or implement stage — `/senai-plan` refuses to adopt an explore brainstorm, and a finalized explore session auto-resets at the next `/senai-brainstorm`; `docs` and `test` walk the plan road but skip the document stage (docs are the implementation; test plans end with a verification run). While a new-flow brainstorm is open, the `tool_call` hook hard-blocks `edit`/`write` outside the brainstorm folder. The brainstorm writes a draft `mission-brief.md` and a transcript with a `## Decisions` ledger (`discussions/discussion-NN-<slug>.md`); not-wanted questions are copied into the brief's `## Out-of-scope` with their reason. Brainstorms are orthogonal to the stage machine — they do NOT mutate `state.json.stage` and can be opened from any state (`none`, active stages, `delivered`). `/senai-plan` warns before replacing an active run and, when a pre-run brief exists, references it from `state.missionBriefPath` and copies the newest discussion document into the run folder (`state.discussionDocPath`). The `bugfix` type carries a strict pack (`core/mission-packs.ts` — the other five types share the no-op `EMPTY_PACK`): the brief must fill 4 extra mandatory sections (`## Reproduction steps`, `## Expected vs actual`, `## Root cause`, `## Regression test plan`), hard-rejected at approve when missing or `_TBD_`; the DISCUSS loop gains a bugfix checklist (reproduction, root-cause hypothesis, regression test idea) and the community scan is auto-added when the error originates from a library/framework/dependency; and the Plan stage runs a deep scout dig (`scout-bugfix-dig.md`, seeded with the brief's reproduction/root-cause sections) before the planner runs.

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────┐
│  PLAN   │ ──▶ │  IMPLEMENT  │ ──▶ │  DOCUMENT   │ ──▶ │  DELIVER  │
└────┬────┘     └──────┬──────┘     └──────┬──────┘     └─────┬─────┘
     │                 │                   │                   │
     ▼                 ▼                   ▼                   ▼
 Parent approval   Parent approval    Parent approval     Parent approval
 (/senai-    (/senai-       (/senai-        (/senai-
  approve)         approve)           approve)            approve)
   │                 │                   │                   │
   ▼                 ▼                   ▼                   ▼
 Auto-starts      Auto-starts         Auto-starts        Marks run
 Implement        Document            Deliver            delivered
```

---

## 2. Stage Flow

| Stage     | Command                     | Purpose                                                                            |
| --------- | --------------------------- | ---------------------------------------------------------------------------------- |
| Plan      | `/senai-plan <mission>` | Research the codebase, clarify scope, create an implementation plan, and review it |
| Implement | `/senai-implement`      | Build and test the approved plan                                                   |
| Document  | `/senai-document`       | Write all project documentation                                                    |
| Deliver   | `/senai-deliver`        | Run a final security audit and package the result                                  |

Use `/senai-approve` to approve a finished stage and automatically run the next stage. Manual stage commands (`/senai-implement`, `/senai-document`, `/senai-deliver`) can still be used, but they require the preceding stage to be in the exact completed state and its artifacts to exist.

`/senai-approve` and `/senai-brainstorm-approve` share a project-wide run lock at `.IDE_Plans/pi-senai/.lock/meta.json` (PID + heartbeat). They mutually exclude each other so a double-click inside one session or two Pi sessions in the same project cannot race-write `state.json`. Stale locks (dead pid or heartbeat older than `SENAI_LOCK_STALE_MS`, default 60s) are auto-stolen by the next acquire. The full environment contract: `SENAI_LOCK_TIMEOUT_MS` (default 5000), `SENAI_LOCK_STALE_MS` (default 60000), `SENAI_LOCK_HEARTBEAT_MS` (default 5000). `/senai-brainstorm-approve` is also idempotent: a second call on the same already-finalized brief short-circuits with "already finalized" instead of bumping the `discussions` counter.

Configuration commands:

- `/senai-configure-agents` — interactively map Senai roles to subagent names and save `.pi/senai/agents.json`.
- `/senai-agents` — show the current mapping and validate that every mapped agent exists.
- `/senai-configure-files` — interactively configure code paths, input documents, and test paths in `.pi/senai/files.json`.
- `/senai-files` — show the configured project file list.
- `/senai-configure-agents-files` — interactively assign truth and comparison documents per role in `.pi/senai/agents_files.json`.
- `/senai-agents-files` — show configured document assignments per role.
- `/chirpi-configure-architect-inputs` — select the documents and constraints the architect agent reads (`.pi/senai/architect-inputs.json`).
- `/chirpi-predefined-architect` — pick an architecture from the library without writing input docs. Codebase-first: a deterministic profiler reads `package.json`, folders, and config files to infer purpose/scale/deployment/realtime, then asks the minimum dynamic questions (1 confirm when signals are confident, a close-call + at most 2 targeted questions when the top-2 entries are close, exactly 2 fallback questions when there are no signals). Shows the top 3 matches with per-match reasons. The chosen entry is then passed to `/chirpi-generate-architect` via a `pi.sendUserMessage` payload.
- `/chirpi-generate-architect` — generate the project architecture, five architecture agents, and four architecture skills; creates or updates `.pi/senai/agents.json` and auto-maps the seven architecture-bound roles. When `.pi/senai/architect-inputs.json` is missing on a Pi extension project, the command auto-creates the file from the canonical `PI_EXTENSION_PRESET` + codebase discovery (no dialog).
- `/senai-doctor` — run a full diagnostic on Senai configuration, agent-role fit, file scope, runtime environment, and the architecture factory output (agent mapping, generated agent content, drift).
- `/senai-generate-sub-agents` — generate project-specific sub-agents for the 14 non-architecture roles from bundled technology resources (basic mode: 3–4 questions). Only roles on built-in defaults are generated; one confirmation before writing and mapping.

Other commands:

- `/senai-status` — show current stage, mission, run ID, artifact paths, and next command.
- `/senai-reset` — clear the active run state (artifacts are preserved).
- `/senai-brainstorm "<topic>"` — open a structured mission-refinement pass (understand → confirm → scans → discuss → approve). Invocable from any state. Writes a draft `mission-brief.md` and a transcript with a `## Decisions` ledger at `discussions/discussion-NN-<slug>.md`.
- `/senai-brainstorm-approve` — finalize `mission-brief.md` (clears the draft marker) and append a `discussionEvents` entry to `state.json`. If the run is active, appends one `## Brainstorm — <date>` section to the run's `mission-brief.md`; if no run is active, writes to `.IDE_Plans/pi-senai/discussions/pre-run/mission-brief.md`.

---

## 3. Artifact Layout

All runtime artifacts are stored under `.IDE_Plans/pi-senai/`:

```text
.IDE_Plans/pi-senai/
├── state.json
└── runs/<run-id>/
    ├── plan/
    │   ├── plan.md
    │   ├── plan-overview.md
    │   ├── discussion-notes.md
    │   ├── scouts/
    │   │   ├── scout-angle_1.md
    │   │   ├── scout-angle_2.md
    │   │   ├── scout-angle_3.md
    │   │   └── scout-angle_4.md
    │   └── reviews/
    │       ├── review-correctness.md
    │       ├── review-security.md
    │       └── review-tests.md
    ├── implement/
    │   ├── manifest-diff-report.md
    │   ├── arch-rules-report.md
    │   └── framework-rules-report.md
    ├── document/
    └── deliver/
        ├── security-report.md
        └── deliver-summary.md
```

Run IDs have the form `YYYY-MM-DD-HH-MM-<mission-slug>` to avoid collisions.

---

## 4. Stage 1 — Plan

### Purpose

Understand the mission, explore the codebase, interview the user to clarify scope, and produce a reviewed implementation plan.

### Sequence

```
main agent
    │
    ▼
scouts × 4 (parallel)
    │
    ▼
discussion
    │
    ▼
AskUserQuestion interview with user
    │
    ▼
main agent updates discussion-notes.md
    │
    ▼
planner writes plan.md
    │
    ▼
plan-overview writer writes plan-overview.md
    │
    ▼
reviewers × 3 (parallel)
    │
    ▼
/senai-approve ──▶ auto-starts Implement
```

### Interview Step

- The discussion agent reads all scout outputs and drafts 2-5 focused questions.
- The main agent asks the questions via the `AskUserQuestion` tool.
- The user answers in the terminal dialog.
- The main agent appends the answers to `discussion-notes.md`.

### Approval Gate

- If the plan and reviews look good → run `/senai-approve` to approve the plan and automatically start the Implement stage.
- If changes are needed → ask the main agent to update the plan and reviews before approving.

---

## 5. Stage 2 — Implement

### Purpose

Build and test the approved plan.

### Sequence

```
test-skeleton
    │
    ▼
implementer / worker
    │
    ▼
linter
    │
    ▼
test
    │
    ▼
code-review
    │
    ▼
full-test
    │
    ▼
/senai-approve ──▶ auto-starts Document
```

### Hard Rules

- Only the implementer edits source files.
- One writer at a time.
- The stage must not start until `plan.md` exists.

### Testing discipline (summary)

This stage enforces a testing discipline: AAA structure, equivalence partitioning + boundary value analysis, table-driven cases, property-based tests for pure functions, coverage target 80% / 100% on security-critical paths. The deterministic scanner (`pi-extension/src/test-discipline.ts`) flags 11 anti-patterns — `zero-assertion` and `over-mocking` are blocking; `mirror-logic`, `flaky-timing`, `mystery-guest`, `private-method`, `god-test`, `weakened-assertion`, `swallowed-error`, `deleted-test-file` are actionable; `no-aaa` is informational. The scanner is exposed as `senai_scan_test_smells`. Strict mode is OFF by default; set `SENAI_TEST_DISCIPLINE_STRICT=1` to promote blocking findings + below-floor coverage to hard gates. Failed required verification steps always block regardless. Bugfix missions run a strict order (failing regression test FIRST → smallest correct fix → re-run → all related tests → diff review) backed by the pack's NEVER list (never delete a failing test, never weaken assertions, never swallow errors, never fix what you cannot reproduce): `weakened-assertion`, `deleted-test-file`, and `swallowed-error` on a fix-target file escalate to blocking (gating in strict mode), and the approve gate collects a `bugfixRegressionTest` signal — the brief's `## Regression test plan` must name a test file that exists on disk and is covered by the plan's `## Files` manifest, otherwise the advance blocks unconditionally (confirm-overridable). See `Doc/senai-full-sequence.md` for the full rule set, and `/senai-doctor` for a single-glance audit (the **Testing discipline** section surfaces strict mode, coverage floor, test paths, scanner availability, stage skills, and agent version distribution).

### Approval Gate

- Before prompting, the orchestrator collects three signals: scan report + coverage + mission verification re-run.
- If all checks pass → run `/senai-approve` to approve implementation and automatically start the Document stage.
- If any check fails → fix and re-run the stage.

---

## 6. Stage 3 — Document

### Purpose

Fill the documentation skeleton created by `/senai-generate-docs-structure` — few, short, standard-formatted docs.

### Sequence

```
Batch 1 (≤4 writers) ──▶ all artifacts verified ──▶ Batch 2 ──▶ ...
         │
         ▼
  /senai-approve ──▶ auto-starts Deliver
```

The stage prompt's **Document writers for this run** block lists each task with its target path, template id, and length cap, grouped into explicit batches. Writers fill the template stub at their target path — they never invent new documents.

### Notes

- Writers run in batches of max 4; batch N+1 starts only after every batch-N artifact is verified on disk. Enforcement is the stage prompt plus the completion guard — pi.dev has no official concurrency/locking.
- Templates and caps come from the doc catalog (`doc-catalog.ts`): Standard Readme (~150 lines), Keep a Changelog (~15 lines/entry), Nygard ADR (~120 lines), Google API style reference pages (~60 lines/symbol), Diátaxis how-to/tutorial/explanation (~150 lines), arc42-lite architecture (~250 lines).
- Selected types only: a solo project gets a README, not a 123KB CONTRIBUTING.md.
- No source code edits in this stage.

### Approval Gate

- If docs are acceptable → run `/senai-approve` to approve documentation and automatically start the Deliver stage.
- If changes are needed → fix and re-run.

---

## 7. Stage 4 — Deliver

### Purpose

Run a final security check and package the result.

### Sequence

```
security-gate
    │
    ▼
archive
    │
    ▼
/senai-approve ──▶ run marked delivered
```

### Approval Gate

- If security gate passes → run `/senai-approve` to finish the run.
- If issues are found → fix and re-run.

---

## 8. Runtime Artifacts

All auto-generated files go into `.IDE_Plans/pi-senai/`:

```text
.IDE_Plans/pi-senai/
├── state.json
└── runs/<run-id>/
    ├── plan/
    │   ├── plan.md
    │   ├── plan-overview.md
    │   ├── discussion-notes.md
    │   ├── scouts/
    │   │   ├── scout-angle_1.md
    │   │   ├── scout-angle_2.md
    │   │   ├── scout-angle_3.md
    │   │   └── scout-angle_4.md
    │   └── reviews/
    │       ├── review-correctness.md
    │       ├── review-security.md
    │       └── review-tests.md
    ├── implement/
    │   ├── manifest-diff-report.md
    │   ├── arch-rules-report.md
    │   └── framework-rules-report.md
    ├── document/
    └── deliver/
        ├── security-report.md
        └── deliver-summary.md
```

---

## 9. Cross-Cutting Rules

1. **Plan before implement.** Always run `/senai-plan` before `/senai-implement` for non-trivial work.
2. **Never skip review.** Every producing stage ends with a reviewer or approval gate.
3. **Parent owns decisions.** Subagents advise. The parent Pi session approves or rejects.
4. **Async by default.** All subagents launch in parallel where dependencies allow.
5. **One writer at a time.** Never run two worker agents in parallel on the same worktree.
6. **Escalate, don't guess.** If a subagent needs an unapproved decision, it asks via the main agent.
7. **Read-only plan stage.** No plan-stage agent edits project source files.
8. **Approve auto-runs the next stage.** `/senai-approve` is the single command that moves the run forward; manual stage commands are still available as overrides.
9. **Fresh scouts every run.** The main agent must spawn new scouts for each run and must not reuse scout reports from previous runs.
10. **Configure first.** Stage commands require valid `.pi/senai/agents.json`, `.pi/senai/files.json`, and `.pi/senai/agents_files.json`. One-time setup order: `/senai-configure-files` → `/chirpi-configure-architect-inputs` → `/chirpi-generate-architect` → `/senai-generate-sub-agents` → `/senai-configure-agents-files` → `/senai-doctor`. The generate commands create and update `agents.json`; `/senai-configure-agents` is the optional manual override.
11. **Framework lock.** The plan manifest records the chosen framework in an optional `## Framework` field (an id from the pi-chirpi `framework-library/`, or `none`). The planning approve gate hard-blocks when a framework was detected from dependencies or named in the plan's `## Tech Stack` but the field is missing, `none`, or names a different framework. At the implement gate the locked framework's `## Rules` run after the arch-rules check (dependency-cruiser / import-linter, tool absent = honest skip); violations block the advance and the result lands in `implement/framework-rules-report.md`. `none` skips all framework checks cleanly.
