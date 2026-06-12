# Orchestra Sequence

## Subagent Orchestration — Plan → Implement → Document → Deliver

**Version:** 1.0  
**Date:** 2026-06-12  
**Status:** Current

---

## 1. Overview

is a stage-gated agent orchestration system. Each stage is a sequence of specialized subagents. Every stage ends with a parent approval gate before the next stage can begin.

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

| Stage     | Purpose                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| Plan      | Research the codebase, clarify scope, create an implementation plan, and review it |
| Implement | Build and test the approved plan                                                   |
| Document  | Write all project documentation                                                    |
| Deliver   | Run a final security audit and package the result                                  |

---

## 3. Stage 1 — Plan

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
parent interview with user
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
Parent approval gate
```

### Interview Step

- The discussion agent reads all scout outputs and drafts 2-5 focused questions.
- It sends the questions to the parent session via intercom.
- The parent asks the user via an interview step.
- The parent sends the user's answers back to the discussion agent via intercom.
- The discussion agent writes `discussion-notes.md` with clarified scope, decisions, and open questions.

### Approval Gate

- If all reviewers PASS → move to Implement.
- If any reviewer NEEDS_FIX → fix and re-run review before moving on.

---

## 4. Stage 2 — Implement

### Purpose

Build the approved plan and validate it through tests and review.

### Sequence

```
test-skeleton
    │
    ▼
implementer
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
Parent approval gate
```

### Hard Rules

- Only the implementer edits source files.
- One writer at a time.
- The stage must not start until a plan exists.

### Approval Gate

- If all checks pass → move to Document.
- If any check fails → fix and re-run the stage.

---

## 5. Stage 3 — Document

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
  Parent approval gate
```

### Notes

- All four writers run in parallel.
- Each writer works on a different output, so there is no conflict.
- No source code edits in this stage.

### Approval Gate

- If docs are acceptable → move to Deliver.
- If changes are needed → fix and re-run.

---

## 6. Stage 4 — Deliver

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
Parent approval gate
```

### Approval Gate

- If security gate passes → ship.
- If issues are found → fix and re-run.

---
