# Orchestra Sequence

## Subagent Orchestration — Plan → Implement → Document → Deliver

**Version:** 1.3  
**Date:** 2026-06-12  
**Status:** Current

---

## 1. Overview

Pi Orchestra is a stage-gated agent orchestration extension for Pi. Each stage is a sequence of specialized subagents. Every stage ends with a parent approval gate. Running `/orchestra-approve` advances the run through the completed stage **and** automatically starts the next stage.

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────┐
│  PLAN   │ ──▶ │  IMPLEMENT  │ ──▶ │  DOCUMENT   │ ──▶ │  DELIVER  │
└────┬────┘     └──────┬──────┘     └──────┬──────┘     └─────┬─────┘
     │                 │                   │                   │
     ▼                 ▼                   ▼                   ▼
 Parent approval   Parent approval    Parent approval     Parent approval
 (/orchestra-    (/orchestra-       (/orchestra-        (/orchestra-
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
| Plan      | `/orchestra-plan <mission>` | Research the codebase, clarify scope, create an implementation plan, and review it |
| Implement | `/orchestra-implement`      | Build and test the approved plan                                                   |
| Document  | `/orchestra-document`       | Write all project documentation                                                    |
| Deliver   | `/orchestra-deliver`        | Run a final security audit and package the result                                  |

Use `/orchestra-approve` to approve a finished stage and automatically run the next stage. Manual stage commands (`/orchestra-implement`, `/orchestra-document`, `/orchestra-deliver`) can still be used, but they require the preceding stage to be in the exact completed state and its artifacts to exist.

Configuration commands:

- `/orchestra-configure-agents` — interactively map Orchestra roles to subagent names and save `.pi/orchestra/agents.json`.
- `/orchestra-agents` — show the current mapping and validate that every mapped agent exists.

Other commands:

- `/orchestra-status` — show current stage, mission, run ID, artifact paths, and next command.
- `/orchestra-reset` — clear the active run state (artifacts are preserved).

---

## 3. Artifact Layout

All runtime artifacts are stored under `.IDE_Plans/orchestra/`:

```text
.IDE_Plans/orchestra/
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
/orchestra-approve ──▶ auto-starts Implement
```

### Interview Step

- The discussion agent reads all scout outputs and drafts 2-5 focused questions.
- The main agent asks the questions via the `AskUserQuestion` tool.
- The user answers in the terminal dialog.
- The main agent appends the answers to `discussion-notes.md`.

### Approval Gate

- If the plan and reviews look good → run `/orchestra-approve` to approve the plan and automatically start the Implement stage.
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
/orchestra-approve ──▶ auto-starts Document
```

### Hard Rules

- Only the implementer edits source files.
- One writer at a time.
- The stage must not start until `plan.md` exists.

### Approval Gate

- If all checks pass → run `/orchestra-approve` to approve implementation and automatically start the Document stage.
- If any check fails → fix and re-run the stage.

---

## 6. Stage 3 — Document

### Purpose

Produce and update all project documentation.

### Sequence

```
readme-writer      ──┐
changelog-writer   ──┤
api-docs-writer    ──┼──▶ All complete
other-docs-writer  ──┘
         │
         ▼
  /orchestra-approve ──▶ auto-starts Deliver
```

### Notes

- All four writers run in parallel.
- Each writer works on a different output, so there is no conflict.
- No source code edits in this stage.

### Approval Gate

- If docs are acceptable → run `/orchestra-approve` to approve documentation and automatically start the Deliver stage.
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
/orchestra-approve ──▶ run marked delivered
```

### Approval Gate

- If security gate passes → run `/orchestra-approve` to finish the run.
- If issues are found → fix and re-run.

---

## 8. Runtime Artifacts

All auto-generated files go into `.IDE_Plans/orchestra/`:

```text
.IDE_Plans/orchestra/
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

1. **Plan before implement.** Always run `/orchestra-plan` before `/orchestra-implement` for non-trivial work.
2. **Never skip review.** Every producing stage ends with a reviewer or approval gate.
3. **Parent owns decisions.** Subagents advise. The parent Pi session approves or rejects.
4. **Async by default.** All subagents launch in parallel where dependencies allow.
5. **One writer at a time.** Never run two worker agents in parallel on the same worktree.
6. **Escalate, don't guess.** If a subagent needs an unapproved decision, it asks via the main agent.
7. **Read-only plan stage.** No plan-stage agent edits project source files.
8. **Approve auto-runs the next stage.** `/orchestra-approve` is the single command that moves the run forward; manual stage commands are still available as overrides.
9. **Fresh scouts every run.** The main agent must spawn new scouts for each run and must not reuse scout reports from previous runs.
10. **Configure agents first.** Stage commands require a valid `.pi/orchestra/agents.json`. Run `/orchestra-configure-agents` before the first stage.
