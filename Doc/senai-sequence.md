# Senai Sequence

## Subagent Senaition — Plan → Implement → Document → Deliver

**Version:** 1.4  
**Date:** 2026-07-01  
**Status:** Current

---

## 1. Overview

Pi Senai is a stage-gated agent orchestration extension for Pi. Each stage is a sequence of specialized subagents. Every stage ends with a parent approval gate. Running `/senai-approve` advances the run through the completed stage **and** automatically starts the next stage.

**Discussion entry point.** Before the Plan stage, a user can run `/senai-discussion "<topic>"` to refine the mission in a conversational pass (parent LLM only, no subagents). The discussion writes a draft `mission-brief.md` and a transcript (`discussions/discussion-NN-<slug>.md`); `/senai-discussion-approve` finalizes the brief. Discussions are orthogonal to the stage machine — they do NOT mutate `state.json.stage` and can be opened from any state (`none`, active stages, `delivered`). `/senai-plan` warns before replacing an active run and, when a pre-run brief exists, references it from `state.missionBriefPath`.

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

`/senai-approve` and `/senai-discussion-approve` share a project-wide run lock at `.IDE_Plans/senai/.lock/meta.json` (PID + heartbeat). They mutually exclude each other so a double-click inside one session or two Pi sessions in the same project cannot race-write `state.json`. Stale locks (dead pid or heartbeat older than `SENAI_LOCK_STALE_MS`, default 60s) are auto-stolen by the next acquire. The full environment contract: `SENAI_LOCK_TIMEOUT_MS` (default 5000), `SENAI_LOCK_STALE_MS` (default 60000), `SENAI_LOCK_HEARTBEAT_MS` (default 5000). `/senai-discussion-approve` is also idempotent: a second call on the same already-finalized brief short-circuits with "already finalized" instead of bumping the `discussions` counter.

Configuration commands:

- `/senai-configure-agents` — interactively map Senai roles to subagent names and save `.pi/senai/agents.json`.
- `/senai-agents` — show the current mapping and validate that every mapped agent exists.
- `/senai-configure-files` — interactively configure code paths, input documents, and test paths in `.pi/senai/files.json`.
- `/senai-files` — show the configured project file list.
- `/senai-configure-agents-files` — interactively assign truth and comparison documents per role in `.pi/senai/agents_files.json`.
- `/senai-agents-files` — show configured document assignments per role.
- `/senai-configure-architect-inputs` — select the documents and constraints the architect agent reads (`.pi/senai/architect-inputs.json`).
- `/senai-generate-architect` — generate the project architecture, five architecture agents, and four architecture skills; creates or updates `.pi/senai/agents.json` and auto-maps the seven architecture-bound roles.
- `/senai-doctor` — run a full diagnostic on Senai configuration, agent-role fit, file scope, runtime environment, and the architecture factory output (agent mapping, generated agent content, drift).
- `/senai-generate-sub-agents` — generate project-specific sub-agents for the 14 non-architecture roles from bundled technology resources (basic mode: 3–4 questions). Only roles on built-in defaults are generated; one confirmation before writing and mapping.

Other commands:

- `/senai-status` — show current stage, mission, run ID, artifact paths, and next command.
- `/senai-reset` — clear the active run state (artifacts are preserved).
- `/senai-discussion "<topic>"` — open a conversational mission-refinement pass (parent LLM only, no subagents). Invocable from any state. Writes a draft `mission-brief.md` and a transcript `discussions/discussion-NN-<slug>.md`.
- `/senai-discussion-approve` — finalize `mission-brief.md` (clears the draft marker) and append a `discussionEvents` entry to `state.json`. If the run is active, appends one `## Discussion — <date>` section to the run's `mission-brief.md`; if no run is active, writes to `.IDE_Plans/senai/discussions/pre-run/mission-brief.md`.

---

## 3. Artifact Layout

All runtime artifacts are stored under `.IDE_Plans/senai/`:

```text
.IDE_Plans/senai/
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

### Approval Gate

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

All auto-generated files go into `.IDE_Plans/senai/`:

```text
.IDE_Plans/senai/
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
10. **Configure first.** Stage commands require valid `.pi/senai/agents.json`, `.pi/senai/files.json`, and `.pi/senai/agents_files.json`. One-time setup order: `/senai-configure-files` → `/senai-configure-architect-inputs` → `/senai-generate-architect` → `/senai-generate-sub-agents` → `/senai-configure-agents-files` → `/senai-doctor`. The generate commands create and update `agents.json`; `/senai-configure-agents` is the optional manual override.
