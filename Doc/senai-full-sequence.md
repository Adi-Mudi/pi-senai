# Senai Full Sequence
## Stage-Gated Agent Orchestration — Plan → Implement → Document → Deliver

> **Implementation note:** This specification is implemented by the `pi-orchestra` extension in this repository. The commands below reference the `pi-orchestra` slash-command names (`/orchestra-*`).

**Version:** 1.4  
**Date:** 2026-07-01  
**Status:** Current

---

## 1. Overview

Senai runs software work as a sequence of gated stages. Each stage is one slash command. Each command launches a chain of specialized subagents. The parent Pi session owns every decision — no stage advances without approval. Once a stage is approved with `/orchestra-approve`, the next stage starts automatically.

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

## 2. Stage Summary

| Stage | Command | Purpose | Output |
|-------|---------|---------|--------|
| 1. Plan | `/orchestra-plan "<mission>"` | Research and plan before coding | Approved `.IDE_Plans/orchestra/runs/<run-id>/plan/plan.md` + user-facing `plan-overview.md` |
| 2. Implement | `/orchestra-implement` | Build and test the approved plan | Working, tested code |
| 3. Document | `/orchestra-document` | Write all project docs | Updated README, CHANGELOG, API docs, etc. |
| 4. Deliver | `/orchestra-deliver` | Security audit and package | `security-report.md` + `deliver-summary.md` |

Use `/orchestra-approve` to approve a finished stage and automatically run the next stage. Manual stage commands are available as overrides, but they require the preceding stage to be in the exact completed state and its artifacts to exist.

Configuration commands:

- `/orchestra-configure-agents` — discover project, user, and built-in agents and interactively map each Orchestra role to a subagent name.
- `/orchestra-agents` — show the current role-to-agent mapping and report any missing custom agents.
- `/orchestra-configure-files` — interactively configure code paths, input documents, and test paths in `.pi/orchestra/files.json`.
- `/orchestra-files` — show the configured project file list.
- `/orchestra-configure-agents-files` — interactively assign truth and comparison documents per role in `.pi/orchestra/agents_files.json`.
- `/orchestra-agents-files` — show configured document assignments per role.
- `/orchestra-doctor` — run a full diagnostic on Orchestra configuration, agent-role fit, file scope, and runtime environment.

Other commands:

- `/orchestra-status` — show current stage, mission, run ID, artifacts, and next command.
- `/orchestra-reset` — clear the active run state (artifacts are preserved).

---

## 3. Configuration

Before running any stage, Pi Orchestra requires three configuration files under `.pi/orchestra/`:

1. `agents.json` — maps each Orchestra role to the name of a subagent that the main agent should spawn.
2. `files.json` — categorizes project context into code paths, input documents, and test paths.
3. `agents_files.json` — assigns truth and comparison documents to each role.

### Agent mapping (`agents.json`)

A typical config looks like:

```json
{
  "version": 1,
  "agents": {
    "planner": "gas-planner",
    "implementer": "gas-coder",
    "security-gate": "security-auditor"
  }
}
```

Only roles that differ from the default need to be listed. Defaults are:

| Role | Default agent |
|------|---------------|
| `scout-1` .. `scout-4` | `scout` |
| `discussion`, `planner`, `plan-overview` | `planner` |
| `reviewer-correctness`, `reviewer-security`, `reviewer-tests`, `code-review` | `reviewer` |
| `test-skeleton`, `implementer`, `linter`, `full-test`, `readme-writer`, `changelog-writer`, `api-docs-writer`, `other-docs-writer`, `archive` | `worker` |
| `security-gate` | `security-auditor` |

Agents are discovered from:

1. Project `.pi/agents/*.md` files (nearest by walking up directories).
2. User agents directory (`getAgentDir()/agents`).
3. Built-in defaults.

Project agents override user agents, and both override built-ins. Agent files must contain `name` and `description` YAML frontmatter fields.

### Project file context (`files.json`)

```json
{
  "version": 2,
  "codePaths": ["src/", "app/"],
  "inputDocuments": ["docs/PRD.md", "README.md"],
  "testPaths": ["tests/"],
  "excludedPaths": [".git/", "node_modules/", "dist/"]
}
```

Use `/orchestra-configure-files` to create or edit this file.

### Agent document assignments (`agents_files.json`)

```json
{
  "version": 2,
  "documents": {
    "scout-1": { "primary": "docs/PRD.md" }
  }
}
```

Each role may have a `primary` truth document and a `reads` list of comparison documents. Use `/orchestra-configure-agents-files` to create or edit this file.

## 4. Stage 1 — Plan

**Command:** `/orchestra-plan "<mission>"`

### Purpose
Research the codebase, interview the user to clarify scope, write a concrete implementation plan, and review it.

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
parent interview with user (AskUserQuestion)
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
Parent approval gate (/orchestra-approve)
    │
    ▼
Auto-starts Implement
```

### Agents

| Step | Agent | Context | Output |
|------|-------|---------|--------|
| 1 | scout-1 | fresh | `.IDE_Plans/orchestra/runs/<run-id>/plan/scouts/scout-angle_1.md` |
| 1 | scout-2 | fresh | `.IDE_Plans/orchestra/runs/<run-id>/plan/scouts/scout-angle_2.md` |
| 1 | scout-3 | fresh | `.IDE_Plans/orchestra/runs/<run-id>/plan/scouts/scout-angle_3.md` |
| 1 | scout-4 | fresh | `.IDE_Plans/orchestra/runs/<run-id>/plan/scouts/scout-angle_4.md` |
| 2 | discussion | fork | Drafts interview questions for the user |
| 3 | parent + user | main session | User answers via `AskUserQuestion` |
| 4 | planner | fork | `.IDE_Plans/orchestra/runs/<run-id>/plan/plan.md` |
| 5 | plan-overview | fork | `.IDE_Plans/orchestra/runs/<run-id>/plan/plan-overview.md` |
| 6 | reviewer-correctness | fresh | `.IDE_Plans/orchestra/runs/<run-id>/plan/reviews/review-correctness.md` |
| 6 | reviewer-security | fresh | `.IDE_Plans/orchestra/runs/<run-id>/plan/reviews/review-security.md` |
| 6 | reviewer-tests | fresh | `.IDE_Plans/orchestra/runs/<run-id>/plan/reviews/review-tests.md` |

### Interview Step
- The discussion agent reads all scout outputs and drafts 2-5 focused questions.
- The main agent asks the user via the `AskUserQuestion` tool.
- The main agent appends the user's answers to `discussion-notes.md`.

### Approval Gate
- If the plan and reviews look good → run `/orchestra-approve`. This marks the plan approved and automatically starts the Implement stage.
- If changes are needed → ask the main agent to update the plan and reviews, then approve.

---

## 5. Stage 2 — Implement

**Command:** `/orchestra-implement`

### Purpose
Build the approved plan and validate with tests and code review.

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
Parent approval gate (/orchestra-approve)
    │
    ▼
Auto-starts Document
```

### Agents

| Step | Agent | Context | Purpose |
|------|-------|---------|---------|
| 1 | test-skeleton | fork | Write test stubs and scaffolding first |
| 2 | implementer | fork | Implement the approved plan |
| 3 | linter | fresh | Run linter and report style issues |
| 4 | test | fresh | Run unit tests |
| 5 | code-review | fresh | Review the diff for correctness and regressions |
| 6 | full-test | fresh | Run integration / e2e tests |

### Hard Rules
- Only the implementer edits source files.
- One writer at a time.
- The stage must not start until `plan.md` exists.

### Approval Gate
- If all checks pass → run `/orchestra-approve`. This marks implementation complete and automatically starts the Document stage.
- If any check fails → fix and re-run the stage.

---

## 6. Stage 3 — Document

**Command:** `/orchestra-document`

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
  Parent approval gate (/orchestra-approve)
         │
         ▼
  Auto-starts Deliver
```

### Agents

| Step | Agent | Context | Output |
|------|-------|---------|--------|
| 1 | readme-writer | fresh | `README.md` |
| 1 | changelog-writer | fresh | `CHANGELOG.md` |
| 1 | api-docs-writer | fresh | `docs/api/` |
| 1 | other-docs-writer | fresh | `CONTRIBUTING.md`, `LICENSE`, etc. |

### Notes
- All four writers run in parallel because they write to different files.
- No source code edits in this stage.

### Approval Gate
- If docs look good → run `/orchestra-approve`. This marks documentation complete and automatically starts the Deliver stage.
- If changes needed → fix and re-run.

---

## 7. Stage 4 — Deliver

**Command:** `/orchestra-deliver`

### Purpose
Final security check and packaging.

### Sequence

```
security-gate
    │
    ▼
archive
    │
    ▼
Parent approval gate (/orchestra-approve)
    │
    ▼
Run marked delivered
```

### Agents

| Step | Agent | Context | Output |
|------|-------|---------|--------|
| 1 | security-gate | fresh | `.IDE_Plans/orchestra/runs/<run-id>/deliver/security-report.md` |
| 2 | archive | fork | `.IDE_Plans/orchestra/runs/<run-id>/deliver/deliver-summary.md` + archive artifact |

### Approval Gate
- If security gate passes → run `/orchestra-approve` to finish the run.
- If security issues found → fix and re-run.

---

## 8. Runtime Artifacts

All auto-generated files go into `.IDE_Plans/orchestra/runs/<run-id>/`:

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

Run IDs have the form `YYYY-MM-DD-HH-MM-<mission-slug>`.

---

## 9. Context Modes

| Stage | Agent | Context | Why |
|-------|-------|---------|-----|
| Plan | scouts | fresh | Adversarial eyes on codebase |
| Plan | discussion | fork | Needs scout context for decisions |
| Plan | planner | fork | Needs scout and discussion context |
| Plan | plan-overview | fork | Needs the approved plan |
| Plan | reviewers | fresh | Adversarial review of plan |
| Implement | test-skeleton | fork | Needs plan context |
| Implement | implementer | fork | Needs plan context |
| Implement | lint / test / code-review / full-test | fresh | Stateless checks |
| Document | all writers | fresh | Parallel work on different files |
| Deliver | security-gate | fresh | Adversarial security review |
| Deliver | archive | fork | Needs full project context |

---

## 10. Cross-Cutting Rules

1. **Plan before implement.** Always run `/orchestra-plan` before `/orchestra-implement` for non-trivial work.
2. **Never skip review.** Every producing stage ends with a reviewer or approval gate.
3. **Parent owns decisions.** Subagents advise. The parent session approves or rejects.
4. **Async by default.** All subagents launch in parallel where dependencies allow.
5. **One writer at a time.** Never run two worker agents in parallel on the same worktree.
6. **Escalate, don't guess.** If a subagent needs an unapproved decision, it asks via the main agent.
7. **Read-only plan stage.** No plan-stage agent edits project source files.
8. **No direct subagent calls from the extension.** The extension injects prompts; the LLM invokes the `subagent` tool.
9. **Approve auto-runs the next stage.** `/orchestra-approve` is the single command to move forward; manual stage commands are still available as overrides.
10. **Fresh scouts every run.** The main agent must spawn new scouts for each run and must not reuse scout reports from previous runs.
11. **Configure first.** Valid `.pi/orchestra/agents.json`, `.pi/orchestra/files.json`, and `.pi/orchestra/agents_files.json` are required before any stage command will run.

---

## 10. Document Map

| Topic | File |
|-------|------|
| High-level sequence | `Doc/orchestra-sequence.md` |
| Step-by-step user guide | `Doc/step-by-step-guide.md` |
| This full sequence spec | `Doc/senai-full-sequence.md` |
| Changelog | `CHANGELOG.md` |
| Agent / contributor notes | `AGENTS.md` |
| Quick start | `README.md` |
