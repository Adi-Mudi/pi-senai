# Senai Full Sequence
## Stage-Gated Agent Orchestration — Plan → Implement → Document → Deliver

**Version:** 1.0  
**Date:** 2026-06-12  
**Status:** Current

---

## 1. Overview

Senai runs software work as a sequence of gated stages. Each stage is one slash command. Each command launches a chain of specialized subagents. The parent Pi session owns every decision — no stage advances without approval.

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────┐
│  PLAN   │ ──▶ │  IMPLEMENT  │ ──▶ │  DOCUMENT   │ ──▶ │  DELIVER  │
└────┬────┘     └──────┬──────┘     └──────┬──────┘     └─────┬─────┘
     │                 │                   │                   │
     ▼                 ▼                   ▼                   ▼
 Parent approval   Parent approval    Parent approval     Parent approval
```

---

## 2. Stage Summary

| Stage | Command | Purpose | Output |
|-------|---------|---------|--------|
| 1. Plan | `/senai-plan "<mission>"` | Research and plan before coding | Approved `.IDE_Plans/.senai/plan.md` |
| 2. Implement | `/senai-implement` | Build and test the approved plan | Working, tested code |
| 3. Document | `/senai-document` | Write all project docs | Updated README, CHANGELOG, API docs, etc. |
| 4. Deliver | `/senai-deliver` | Security audit and package | Security report + archive artifact |

---

## 3. Stage 1 — Plan

**Command:** `/senai-plan "<mission>"`

### Purpose
Research the codebase, interview the user to clarify scope, write a concrete implementation plan, and review it.

### Sequence

```
coordinator (pi-subagents)
    │
    ▼
scouts × 3 (pi-teams — visible Zellij panes)
    │
    ▼
discussion (pi-subagents)
    │
    ▼
parent interview with user
    │
    ▼
discussion writes discussion-notes.md
    │
    ▼
planner (pi-subagents)
    │
    ▼
reviewers × 3 (pi-subagents — parallel)
    │
    ▼
Parent approval gate
```

### Agents

| Step | Agent | System | Context | Output |
|------|-------|--------|---------|--------|
| 1 | coordinator | pi-subagents | fresh | `.IDE_Plans/.senai/scout-coordinator.md` |
| 2 | scout-1 | pi-teams | fresh | `.IDE_Plans/.senai/scout-angle_1.md` |
| 2 | scout-2 | pi-teams | fresh | `.IDE_Plans/.senai/scout-angle_2.md` |
| 2 | scout-3 | pi-teams | fresh | `.IDE_Plans/.senai/scout-angle_3.md` |
| 3 | discussion | pi-subagents | fork | Drafts interview questions for the user |
| 4 | parent + user | main session | — | User answers via `AskUserQuestion` |
| 5 | planner | pi-subagents | fork | `.IDE_Plans/.senai/plan.md` |
| 6 | reviewer-correctness | pi-subagents | fresh | `.IDE_Plans/.senai/review-correctness.md` |
| 6 | reviewer-security | pi-subagents | fresh | `.IDE_Plans/.senai/review-security.md` |
| 6 | reviewer-tests | pi-subagents | fresh | `.IDE_Plans/.senai/review-tests.md` |

### Interview Step
- The discussion agent reads all scout outputs and drafts 2-5 focused questions.
- It sends the questions to the parent session via intercom (`reason: "need_decision"`).
- The parent asks the user via `AskUserQuestion`.
- The parent sends the user's answers back to the discussion agent via intercom.
- The discussion agent writes `.IDE_Plans/.senai/discussion-notes.md` with clarified scope, decisions, and open questions.

### Approval Gate
- If all reviews PASS → approve plan, then run `/senai-implement`.
- If any review NEEDS_FIX → fix the plan, re-run review, then approve.

---

## 4. Stage 2 — Implement

**Command:** `/senai-implement`

### Purpose
Build the approved plan and validate with tests and code review.

### Sequence

```
test-skeleton (pi-subagents)
    │
    ▼
implementer / worker (pi-subagents)
    │
    ▼
lint (pi-subagents)
    │
    ▼
test (pi-subagents)
    │
    ▼
code-review (pi-subagents)
    │
    ▼
full-test (pi-subagents)
    │
    ▼
Parent approval gate
```

### Agents

| Step | Agent | System | Context | Purpose |
|------|-------|--------|---------|---------|
| 1 | test-skeleton | pi-subagents | fork | Write test stubs and scaffolding first |
| 2 | implementer | pi-subagents | fork | Implement the approved plan |
| 3 | linter | pi-subagents | fresh | Run linter and report style issues |
| 4 | test | pi-subagents | fresh | Run unit tests |
| 5 | code-review | pi-subagents | fresh | Review the diff for correctness and regressions |
| 6 | full-test | pi-subagents | fresh | Run integration / e2e tests |

### Hard Rules
- Only the implementer edits source files.
- One writer at a time.
- Stop if `plan.md` is missing and prompt user to run `/senai-plan` first.

### Approval Gate
- If all checks pass → approve, then run `/senai-document`.
- If any check fails → fix and re-run the stage.

---

## 5. Stage 3 — Document

**Command:** `/senai-document`

### Purpose
Write and update all project documentation.

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

### Agents

| Step | Agent | System | Context | Output |
|------|-------|--------|---------|--------|
| 1 | readme | pi-subagents | fresh | `README.md` |
| 1 | changelog | pi-subagents | fresh | `CHANGELOG.md` |
| 1 | api-docs | pi-subagents | fresh | `docs/api/` |
| 1 | other-docs | pi-subagents | fresh | `CONTRIBUTING.md`, `LICENSE`, etc. |

### Notes
- All four writers run in parallel because they write to different files.
- No source code edits in this stage.

### Approval Gate
- If docs look good → approve, then run `/senai-deliver`.
- If changes needed → fix and re-run.

---

## 6. Stage 4 — Deliver

**Command:** `/senai-deliver`

### Purpose
Final security check and packaging.

### Sequence

```
security-gate (pi-subagents)
    │
    ▼
archive (pi-subagents)
    │
    ▼
Parent approval gate
```

### Agents

| Step | Agent | System | Context | Output |
|------|-------|--------|---------|--------|
| 1 | security-gate | pi-subagents | fresh | `.IDE_Plans/.senai/security-report.md` |
| 2 | archive | pi-subagents | fork | `.IDE_Plans/.senai/deliver-summary.md` + archive artifact |

### Approval Gate
- If security gate passes → approve and ship.
- If security issues found → fix and re-run.

---

## 7. Inline Overrides

Most stage commands accept inline overrides to change the default agent for a slot.

### Plan overrides
```
/senai-plan "<mission>" --coordinator=worker --scout-count=5 --discussion=oracle --planner=planner --reviewer-correctness=reviewer --reviewer-security=reviewer --reviewer-tests=reviewer
```

### Implement overrides
```
/senai-implement --test-skeleton=worker --implementer=worker --linter=worker --code-reviewer=reviewer
```

### Document overrides
```
/senai-document --readme=worker --changelog=worker --api-docs=worker --other-docs=worker
```

### Deliver overrides
```
/senai-deliver --security-gate=reviewer --archive=worker
```

---

## 8. Runtime Artifacts

All auto-generated files go into `.IDE_Plans/.senai/`:

```
.IDE_Plans/.senai/
├── scout-coordinator.md
├── scout-angle_1.md
├── scout-angle_2.md
├── scout-angle_3.md
├── discussion-notes.md
├── plan.md
├── review-correctness.md
├── review-security.md
├── review-tests.md
├── security-report.md
└── deliver-summary.md
```

---

## 9. Context Modes

| Stage | Agent | Context | Why |
|-------|-------|---------|-----|
| Plan | coordinator | fresh | No parent bias when assessing project |
| Plan | scouts | fresh | Adversarial eyes on codebase |
| Plan | discussion | fork | Needs parent context for decisions |
| Plan | planner | fork | Needs parent context for planning |
| Plan | reviewers | fresh | Adversarial review of plan |
| Implement | test-skeleton | fork | Needs plan context |
| Implement | implementer | fork | Needs plan context |
| Implement | lint / test / code-review / full-test | fresh | Stateless checks |
| Document | all writers | fresh | Parallel work on different files |
| Deliver | security-gate | fresh | Adversarial security review |
| Deliver | archive | fork | Needs full project context |

---

## 10. Cross-Cutting Rules

1. **Plan before implement.** Always run `/senai-plan` before `/senai-implement` for non-trivial work.
2. **Never skip review.** Every producing stage ends with a reviewer or approval gate.
3. **Parent owns decisions.** Subagents advise. The parent session approves or rejects.
4. **Async by default.** All subagents launch with `async: true` unless the user asks for blocking.
5. **One writer at a time.** Never run two worker agents in parallel on the same worktree.
6. **Escalate, don't guess.** If a subagent needs an unapproved decision, it asks via intercom.
7. **Read-only plan stage.** No plan-stage agent edits project source files.
8. **No direct subagent calls from the extension.** The extension injects prompts; the LLM invokes the `subagent` tool.

---

## 11. Document Map

| Topic | File |
|-------|------|
| Product requirements | `docs/PRD.md` |
| System architecture | `docs/ARCHITECTURE.md` |
| Plan stage agent specs | `docs/senai-plan-spec.md` |
| Plan stage config | `docs/senai-plan-config.md` |
| Scout phase design | `docs/senai-plan-scout-design.md` |
| Plan phase roadmap | `docs/senai-plan-phases.md` |
| Agent config | `docs/senai-plan-agents.md` |
