# Orchestra Sequence

## Subagent Orchestration — Plan → Implement → Document → Deliver

**Version:** 1.1  
**Date:** 2026-06-13  
**Status:** Current

---

## 1. Overview

Pi Orchestra is a stage-gated agent orchestration extension for Pi. Each stage is a sequence of specialized subagents. Every stage ends with a parent approval gate before the next stage can begin.

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────┐
│  PLAN   │ ──▶ │  IMPLEMENT  │ ──▶ │  DOCUMENT   │ ──▶ │  DELIVER  │
└────┬────┘     └──────┬──────┘     └──────┬──────┘     └─────┬─────┘
     │                 │                   │                   │
     ▼                 ▼                   ▼                   ▼
 Parent approval   Parent approval    Parent approval     Parent approval
```

---

## 2. Stage Flow

| Stage     | Command                  | Purpose                                                                            |
| --------- | ------------------------ | ---------------------------------------------------------------------------------- |
| Plan      | `/orchestra-plan <mission>` | Research the codebase, clarify scope, create an implementation plan, and review it |
| Implement | `/orchestra-implement`   | Build and test the approved plan                                                   |
| Document  | `/orchestra-document`    | Write all project documentation                                                    |
| Deliver   | `/orchestra-deliver`     | Run a final security audit and package the result                                  |

Use `/orchestra-approve` to advance through each approval gate.

---

## 3. Artifact Layout

All runtime artifacts are stored under `.IDE_Plans/orchestra/`:

```text
.IDE_Plans/orchestra/
├── state.json
└── runs/<run-id>/
    ├── plan/
    │   ├── plan.md
    │   ├── discussion-notes.md
    │   ├── scouts/
    │   │   ├── scout-angle_1.md
    │   │   ├── scout-angle_2.md
    │   │   └── scout-angle_3.md
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

## 4. Stage 1 — Plan

### Purpose

Understand the mission, explore the codebase, interview the user to clarify scope, and produce a reviewed implementation plan.

### Sequence

```
coordinator
    │
    ▼
scouts × 3 (parallel, visible panes)
    │
    ▼
discussion
    │
    ▼
AskUserQuestion interview with user
    │
    ▼
discussion writes discussion-notes.md
    │
    ▼
planner
    │
    ▼
reviewers × 3 (parallel)
    │
    ▼
/orchestra-approve
```

### Interview Step

- The discussion agent reads all scout outputs and drafts 2-5 focused questions.
- The main agent asks the questions via the `AskUserQuestion` tool.
- The user answers in the terminal dialog.
- The main agent writes `discussion-notes.md` with clarified scope, decisions, and open questions.

### Approval Gate

- If all reviewers PASS → run `/orchestra-approve` to move to Implement.
- If any reviewer NEEDS_FIX → fix the plan and re-run review before moving on.

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
/orchestra-approve
```

### Hard Rules

- Only the implementer edits source files.
- One writer at a time.
- The stage must not start until a plan exists.

### Approval Gate

- If all checks pass → run `/orchestra-approve` to move to Document.
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
  /orchestra-approve
```

### Notes

- All four writers run in parallel.
- Each writer works on a different output, so there is no conflict.
- No source code edits in this stage.

### Approval Gate

- If docs are acceptable → run `/orchestra-approve` to move to Deliver.
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
/orchestra-approve
```

### Approval Gate

- If security gate passes → run `/orchestra-approve` to finish.
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
    │   ├── discussion-notes.md
    │   ├── scouts/
    │   │   ├── scout-angle_1.md
    │   │   ├── scout-angle_2.md
    │   │   └── scout-angle_3.md
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
