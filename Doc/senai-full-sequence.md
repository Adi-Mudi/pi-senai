# Senai Full Sequence
## Stage-Gated Agent Senaition — Plan → Implement → Document → Deliver

> **Implementation note:** This specification is implemented by the `pi-senai` extension in this repository. The commands below reference the `pi-senai` slash-command names (`/senai-*`).

**Version:** 1.4  
**Date:** 2026-07-01  
**Status:** Current

---

## 1. Overview

Senai runs software work as a sequence of gated stages. Each stage is one slash command. Each command launches a chain of specialized subagents. The parent Pi session owns every decision — no stage advances without approval. Once a stage is approved with `/senai-approve`, the next stage starts automatically.

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

## 2. Stage Summary

| Stage | Command | Purpose | Output |
|-------|---------|---------|--------|
| 1. Plan | `/senai-plan "<mission>"` | Research and plan before coding | Approved `.IDE_Plans/senai/runs/<run-id>/plan/plan.md` + user-facing `plan-overview.md` |
| 2. Implement | `/senai-implement` | Build and test the approved plan | Working, tested code |
| 3. Document | `/senai-document` | Write all project docs | Updated README, CHANGELOG, API docs, etc. |
| 4. Deliver | `/senai-deliver` | Security audit and package | `security-report.md` + `deliver-summary.md` |

Use `/senai-approve` to approve a finished stage and automatically run the next stage. Manual stage commands are available as overrides, but they require the preceding stage to be in the exact completed state and its artifacts to exist.

Configuration commands:

- `/senai-configure-agents` — discover project, user, and built-in agents and interactively map each Senai role to a subagent name.
- `/senai-agents` — show the current role-to-agent mapping and report any missing custom agents.
- `/senai-configure-files` — interactively configure code paths, input documents, and test paths in `.pi/senai/files.json`.
- `/senai-files` — show the configured project file list.
- `/senai-configure-agents-files` — interactively assign truth and comparison documents per role in `.pi/senai/agents_files.json`.
- `/senai-agents-files` — show configured document assignments per role.
- `/senai-configure-architect-inputs` — select the documents and constraints the architect agent reads (`.pi/senai/architect-inputs.json`).
- `/senai-generate-architect` — generate the project architecture, five architecture agents, and four architecture skills; creates or updates `.pi/senai/agents.json` and auto-maps the seven architecture-bound roles.
- `/senai-doctor` — run a full diagnostic on Senai configuration, agent-role fit, file scope, runtime environment, and the architecture factory output (agent mapping, generated agent content, drift).
- `/senai-generate-sub-agents` — generate project-specific sub-agents for the 14 non-architecture roles from bundled technology resources (basic mode: 3–4 questions). Covers fresh roles (built-in defaults) and regeneration of previously generated agents: only manifest-proven untouched files are overwritten, user-edited files are kept, and a deleted file with a surviving mapping is recreated. One confirmation previews the exact write set before anything is written.

Other commands:

- `/senai-status` — show current stage, mission, run ID, artifacts, and next command.
- `/senai-reset` — clear the active run state (artifacts are preserved).

---

## 3. Configuration

Before running any stage, Pi Senai requires three configuration files under `.pi/senai/`:

1. `agents.json` — maps each Senai role to the name of a subagent that the main agent should spawn.
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

`agents.json` is normally created for you: `/senai-generate-architect` creates or updates it and auto-maps the seven architecture-bound roles, and `/senai-generate-sub-agents` maps the remaining fourteen roles (creating the file if missing). `/senai-configure-agents` is the optional manual override for hand-picking your own agents.

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

Use `/senai-configure-files` to create or edit this file.

### Agent document assignments (`agents_files.json`)

```json
{
  "version": 2,
  "documents": {
    "scout-1": { "primary": "docs/PRD.md" }
  }
}
```

Each role may have a `primary` truth document and a `reads` list of comparison documents. Use `/senai-configure-agents-files` to create or edit this file.

## 4. Stage 1 — Plan

**Command:** `/senai-plan "<mission>"`

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
Parent approval gate (/senai-approve)
    │
    ▼
Auto-starts Implement
```

### Agents

| Step | Agent | Context | Output |
|------|-------|---------|--------|
| 1 | scout-1 | fresh | `.IDE_Plans/senai/runs/<run-id>/plan/scouts/scout-angle_1.md` |
| 1 | scout-2 | fresh | `.IDE_Plans/senai/runs/<run-id>/plan/scouts/scout-angle_2.md` |
| 1 | scout-3 | fresh | `.IDE_Plans/senai/runs/<run-id>/plan/scouts/scout-angle_3.md` |
| 1 | scout-4 | fresh | `.IDE_Plans/senai/runs/<run-id>/plan/scouts/scout-angle_4.md` |
| 2 | discussion | lineage-only | Drafts interview questions for the user |
| 3 | parent + user | main session | User answers via `AskUserQuestion` |
| 4 | planner | lineage-only | `.IDE_Plans/senai/runs/<run-id>/plan/plan.md` |
| 5 | plan-overview | lineage-only | `.IDE_Plans/senai/runs/<run-id>/plan/plan-overview.md` |
| 6 | reviewer-correctness | fresh | `.IDE_Plans/senai/runs/<run-id>/plan/reviews/review-correctness.md` |
| 6 | reviewer-security | fresh | `.IDE_Plans/senai/runs/<run-id>/plan/reviews/review-security.md` |
| 6 | reviewer-tests | fresh | `.IDE_Plans/senai/runs/<run-id>/plan/reviews/review-tests.md` |

### Interview Step
- The discussion agent reads all scout outputs and drafts 2-5 focused questions.
- The main agent asks the user via the `AskUserQuestion` tool.
- The main agent appends the user's answers to `discussion-notes.md`.

### Approval Gate
- If the plan and reviews look good → run `/senai-approve`. This marks the plan approved and automatically starts the Implement stage.
- If changes are needed → ask the main agent to update the plan and reviews, then approve.

---

## 5. Stage 2 — Implement

**Command:** `/senai-implement`

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
Parent approval gate (/senai-approve)
    │
    ▼
Auto-starts Document
```

### Agents

| Step | Agent | Context | Purpose |
|------|-------|---------|---------|
| 1 | test-skeleton | lineage-only | Write test stubs and scaffolding first |
| 2 | implementer | lineage-only | Implement the approved plan |
| 3 | linter | fresh | Run linter and write the violations report to the run's implement directory |
| 4 | test | fresh | Run unit tests |
| 5 | code-review | fresh | Review the diff for correctness and regressions |
| 6 | full-test | fresh | Run integration / e2e tests and write the results report to the run's implement directory |

### Hard Rules
- Only the implementer edits source files.
- One writer at a time.
- The stage must not start until `plan.md` exists.

### Approval Gate
- If all checks pass → run `/senai-approve`. This marks implementation complete and automatically starts the Document stage.
- If any check fails → fix and re-run the stage.

---

## 6. Stage 3 — Document

**Command:** `/senai-document`

### Purpose
Fill the documentation skeleton created by `/senai-generate-docs-structure`: few, short, standard-formatted docs with hard length caps.

### Sequence

```
Batch 1 (≤4 writers) ──▶ all artifacts verified ──▶ Batch 2 ──▶ ...
         │
         ▼
  Parent approval gate (/senai-approve)
         │
         ▼
  Auto-starts Deliver
```

### Agents

| Step | Agent | Context | Output |
|------|-------|---------|--------|
| 1 | readme-writer | fresh | `README.md` (always selected; Standard Readme template, ≤150 lines) |
| 1 | changelog-writer | fresh | `CHANGELOG.md` (versioned projects; Keep a Changelog, ~15 lines/entry) |
| 1 | api-docs-writer | fresh | `docs/reference/` (packages with a public API surface; Google API style, ≤60 lines/symbol page) |
| 1 | other-docs-writer | fresh | `CONTRIBUTING.md` (projects accepting contributions), `docs/explanation/architecture.md` (when an architecture exists), guides — each within its template cap |

### Notes
- A deterministic decision table (`doc-selection.ts`) selects which writers this project needs and injects a concrete write plan into the stage prompt: each task names its target path, template id, and length cap, grouped into explicit batches of max 4 writers.
- Templates and caps live in the doc catalog (`doc-catalog.ts`), shared by selection, `/senai-generate-docs-structure`, the generated writer agents (documentation contract in their body, generator v4), and doctor (section/format validation).
- Writers fill the existing template stub at their target path — they never invent new documents or sections, and never exceed the cap.
- Batch N+1 waits until every batch-N artifact is verified on disk; enforcement is the stage prompt plus the completion guard — pi.dev has no official concurrency/locking. Spawns within a batch are staggered to avoid provider 429 rate limits.
- No source code edits in this stage.

### Approval Gate
- If docs look good → run `/senai-approve`. This marks documentation complete and automatically starts the Deliver stage.
- If changes needed → fix and re-run.

---

## 7. Stage 4 — Deliver

**Command:** `/senai-deliver`

### Purpose
Final security check and packaging.

### Sequence

```
mission verification
    │
    ▼
security-gate
    │
    ▼
archive
    │
    ▼
Parent approval gate (/senai-approve)
    │
    ▼
Run marked delivered
```

### Agents

| Step | Agent | Context | Output |
|------|-------|---------|--------|
| 0 | mission verification (parent, blocking) | — | Runs every step of the plan's `## Verification` section via bash; any failure stops the stage before the security gate |
| 1 | security-gate | fresh | `.IDE_Plans/senai/runs/<run-id>/deliver/security-report.md` |
| 2 | archive | lineage-only | `.IDE_Plans/senai/runs/<run-id>/deliver/deliver-summary.md` (includes the verification outcome) + archive artifact |

### Approval Gate
- If verification and the security gate pass → run `/senai-approve` to finish the run.
- If a verification step fails → stop and report it; the user decides to fix first or accept the failure explicitly.
- If security issues found → fix and re-run.

---

## 8. Runtime Artifacts

All auto-generated files go into `.IDE_Plans/senai/runs/<run-id>/`:

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

Run IDs have the form `YYYY-MM-DD-HH-MM-<mission-slug>`.

---

## 9. Context Modes

| Stage | Agent | Context | Why |
|-------|-------|---------|-----|
| Plan | scouts | fresh | Adversarial eyes on codebase |
| Plan | discussion | lineage-only | Reads the scout report paths passed in its task |
| Plan | planner | lineage-only | Reads scout reports and discussion notes from disk |
| Plan | plan-overview | lineage-only | Reads the plan from disk |
| Plan | reviewers | fresh | Adversarial review of plan |
| Implement | test-skeleton | lineage-only | Reads the plan from disk |
| Implement | implementer | lineage-only | Reads the plan from disk |
| Implement | lint / test / code-review / full-test | fresh | Stateless checks |
| Document | all writers | fresh | Parallel work on different files |
| Deliver | security-gate | fresh | Adversarial security review |
| Deliver | archive | lineage-only | Reads run artifacts from disk |

`fork` is banned for senai agents: it copies the parent's full conversation into the child and wastes tokens. Every agent that needs context gets artifact paths in its task and reads the files itself.

---

## 10. Cross-Cutting Rules

1. **Plan before implement.** Always run `/senai-plan` before `/senai-implement` for non-trivial work.
2. **Never skip review.** Every producing stage ends with a reviewer or approval gate.
3. **Parent owns decisions.** Subagents advise. The parent session approves or rejects.
4. **Async by default.** All subagents launch in parallel where dependencies allow.
5. **One writer at a time.** Never run two worker agents in parallel on the same worktree.
6. **Escalate, don't guess.** If a subagent needs an unapproved decision, it asks via the main agent.
7. **Read-only plan stage.** No plan-stage agent edits project source files.
8. **No direct subagent calls from the extension.** The extension injects prompts; the LLM invokes the `subagent` tool.
9. **Mapped names enforced.** During an active run, a `tool_call` guard blocks `subagent` spawns that omit the `agent` parameter or use a bare role/built-in name while the role is mapped to a custom or generated agent (the built-in is read-only and stalls the run).
9. **Approve auto-runs the next stage.** `/senai-approve` is the single command to move forward; manual stage commands are still available as overrides.
10. **Fresh scouts every run.** The main agent must spawn new scouts for each run and must not reuse scout reports from previous runs.
11. **Configure first.** Valid `.pi/senai/agents.json`, `.pi/senai/files.json`, and `.pi/senai/agents_files.json` are required before any stage command will run.
12. **Parent never does a subagent's job.** If a subagent cannot finish, fix the spawn (agent, tools, task) and relaunch — prefer `subagent_resume` over a cold respawn. No polling while waiting; completion notifications arrive automatically. Every `subagent()` call passes the mapped `agent:` name.
13. **Deterministic compaction at stage boundaries.** `/senai-approve` compacts the parent context when usage is 50% or higher; the senai compaction hook supplies a zero-LLM run-state summary (run id, stage, artifact paths).

---

## 10. Document Map

| Topic | File |
|-------|------|
| High-level sequence | `Doc/senai-sequence.md` |
| Step-by-step user guide | `Doc/step-by-step-guide.md` |
| This full sequence spec | `Doc/senai-full-sequence.md` |
| Changelog | `CHANGELOG.md` |
| Agent / contributor notes | `AGENTS.md` |
| Quick start | `README.md` |
