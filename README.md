# Pi Senai

Stage-gated agent orchestration extension for Pi — **Plan → Implement → Document → Deliver**.

> **Note:** This extension and all its slash commands are branded as **Senai** (`/senai-*`). Pi loads it automatically from `package.json`.
>
> **Why "Senai"?** Senai (சேனை) is a Tamil word meaning "army," "troop," or "crowd." It describes a disciplined force where every member has a role, follows orders, and advances only when commanded. That matches how Senai works: agents are assigned roles, follow stage-gated slash commands, and obey system-prompt injections and approval gates before moving forward. "Orchestra" is a common English word with no built-in sense of command or discipline, so Senai gives the project a clearer identity.

## Project layout

- `.pi/` — Pi's official project-local directory. Holds agents, skills, extensions, and the permanent architecture factory output (`architect/`).
- `.IDE_Plans/` — A project-local folder used to keep temporary planning artifacts, run state, and draft documents out of the repo root. It is **not** a standard Pi directory; it is a convention used by this project for transient files.

## What it does

Pi Senai splits software work into four explicit stages. Each stage runs a dedicated skill, produces artifacts in `.IDE_Plans/senai/runs/<run-id>/`, and requires user approval before the next stage starts.

- **Plan** — Spawn four scout agents, interview the user, write an approved `plan.md`.
- **Implement** — Build and test the feature according to the plan.
- **Document** — Update README, CHANGELOG, API docs, and other project docs.
- **Deliver** — Run a final security audit and package the deliverable.

## Install

The extension is loaded automatically by Pi when the project is opened because it is listed in `package.json` under the `pi.extensions` field.

```bash
npm install
npm test
```

## Before your first run

Pi Senai requires three configuration files before any stage command will run:

1. **Agent configuration** — map each Senai role to a subagent name:

   ```
   /senai-configure-agents
   ```

2. **Project file configuration** — tell Senai which code, input documents, and tests to include:

   ```
   /senai-configure-files
   ```

3. **Agent document assignments** — assign truth and comparison documents to each role:

   ```
   /senai-configure-agents-files
   ```

You can check the current settings with `/senai-agents`, `/senai-files`, and `/senai-agents-files`.

After configuring, run a full diagnostic:

```
/senai-doctor
```

This checks that all config files exist, every mapped agent is found in the right place, each agent has the right tools for its Senai role, file scopes are valid, truth documents exist, and you are running inside a supported terminal multiplexer.

Once an architecture is generated, doctor also validates it: the six architecture-bound roles (`scout-1`, `planner`, `implementer`, `reviewer-correctness`, `reviewer-security`, `reviewer-tests`) must map to the generated agents, each generated agent file must be intact (tools, a working skill link, and references to `architecture.md`, the ADRs, and the forbidden patterns), and no generated file may be modified after generation (drift warning).

## Usage

Start a new run:

```
/senai-plan <mission>
```

The agent will run the Plan stage. When the plan is ready, approve it:

```
/senai-approve
```

`/senai-approve` marks the current stage complete and automatically starts the next stage. You can also run stages manually when the previous stage is already approved:

```
/senai-implement
/senai-document
/senai-deliver
```

Check status at any time:

```
/senai-status
```

Reset the current run:

```
/senai-reset
```

## Agent configuration

Before running any stage, Pi Senai needs three valid configuration files under `.pi/senai/`: `agents.json`, `files.json`, and `agents_files.json`.

Create the configuration interactively:

```
/senai-configure-agents
```

This discovers agents from:

1. The current project's `.pi/agents/*.md` files.
2. Your user agents directory (via Pi's `getAgentDir()`).
3. Built-in defaults: `scout`, `planner`, `worker`, `reviewer`, `security-auditor`.

For each Senai role you can accept a suggested agent, choose a different one, or fall back to the default.

Check the current mapping and validation status:

```
/senai-agents
```

Stage commands (`/senai-plan`, `/senai-implement`, `/senai-document`, `/senai-deliver`) will warn and stop if any of these configs is missing, invalid, or maps a custom agent that cannot be found.

## Document scope configuration

You can control which documents each subagent reads. Pi Senai uses three config files:

- `.pi/senai/files.json` — categorized project context (code paths, input documents, test paths).
- `.pi/senai/agents_files.json` — per-role truth document and comparison documents.

Configure the project context:

```
/senai-configure-files
```

This command deep-scans your project and suggests real files and folders. It splits selections into three categories:

1. **Code paths** — folders that contain source code (e.g., `src/`, `app/`, `backend/`).
2. **Input documents** — files the agent should read as instructions (e.g., `docs/PRD.md`, `README.md`).
3. **Test paths** — folders or files that contain tests (e.g., `tests/`, `e2e/`).

The scanner recognizes both standard folder names (like `src/`, `docs/`, `tests/`) and custom names by looking at the file types inside each folder. If you select a folder, the tool will not let you also select a file inside it, and vice versa, to avoid conflicts.

Configure document assignments for each role:

```
/senai-configure-agents-files
```

This command shows every Senai role in a custom top-level picker with friendly labels (e.g., `Scout 1 — Architecture / big-picture`) so you can see what each role does before assigning documents. Roles that already have a truth document or comparison documents are highlighted, so configured and unconfigured roles are easy to tell apart. Selecting a role opens the same custom list editor used by `/senai-configure-files`, pre-filled with documents from `/senai-configure-files` (the `inputDocuments` pool plus discovered markdown files).

Each role can have:

1. A **truth document** — the primary document the agent must follow.
2. **Comparison documents** — other files the agent checks against the truth document.

Use the action bar to set/clear the truth document or add a custom path. Press Enter on a suggestion to add it to the reads list, or on a selected read to remove it.

If a role has no assignment, it falls back to the relevant project context category plus the current stage artifacts.

Check the current settings:

```
/senai-files
/senai-agents-files
```

## Architecture generation

Pi Senai can generate project-specific architecture agents and skills from your requirements documents.

1. **Choose the input documents** the architect should read:

   ```
   /senai-configure-architect-inputs
   ```

   This command reuses the same file picker as `/senai-configure-files`. Select PRDs, NFRs, RTMs, test plans, READMEs, feasibility studies, and any other documents that describe the architecture. You can also add additional constraints that are not in any file.

   The selection is saved to `.pi/senai/architect-inputs.json`.

2. **Generate the architecture agents and skills**:

   ```
   /senai-generate-architect
   ```

   This runs the **architecture factory**. It reads the selected documents in parallel (Map-Reduce), extracts architectural drivers, asks clarifying questions, matches the drivers against the architecture library, and produces a complete software architecture.

   The factory uses two deterministic extension tools to avoid LLM drift:
   - `senai_merge_architect_drivers` — merges per-document map outputs into the final drivers file.
   - `senai_finalize_architecture` — generates docs, agents, and skills with exact names.

   The architecture library includes common patterns such as monolith, modular monolith, microservices, event-driven, serverless, layered, clean, SOA, hexagonal, CQRS, pipeline, microkernel, space-based, Pi's own layered monorepo, and Google Apps Script spreadsheet automation.

   Generated state and artifacts (kept in `.pi/architect/`):

   - `.pi/architect/architectural-drivers.json` — merged architectural drivers.
   - `.pi/architect/architect-profile.json` — the chosen architecture id and project profile.
   - `.pi/architect/architect-report.json` — the full architecture report.
   - `.pi/architect/architecture.md` — the human-readable software architecture document.
   - `.pi/architect/adrs/*.md` — architecture decision records.
   - `.IDE_Plans/architect-map/*.json` — intermediate per-document driver files (temporary).

   Generated Pi-discoverable outputs:

   - `.pi/agents/<project>-<architecture-id>-<role>.md` — project-specific agents for planner, implementer, reviewer-correctness, reviewer-security, and reviewer-tests.
   - `.pi/skills/<project>-<architecture-id>-<stage>/SKILL.md` — project-specific skills for plan, implement, document, and deliver stages.

   The generated planner agent is used for architecture scouting (`scout-1`), and all generated agents instruct subagents to read `.pi/architect/architecture.md` and the relevant ADRs before acting.

   If the input documents, the document list, or the additional constraints change, `/senai-generate-architect` detects it and asks whether to re-run the full architecture factory. Re-runs are safe: map files from removed documents are discarded before merging, agents and skills from a previous architecture are removed, and the ADR set is regenerated to match the new report.

   If the architecture library lacks a matching pattern, the agent falls back to web search to gather relevant guidance before generating the agents.

   After generation, `/senai-doctor` also validates the architecture setup.

## Artifact layout

```
.IDE_Plans/senai/
  state.json
  runs/
    YYYY-MM-DD-HH-MM-<mission-slug>/
      plan/
        plan.md
        plan-overview.md
        discussion-notes.md
        scouts/
          scout-angle_1.md
          scout-angle_2.md
          scout-angle_3.md
          scout-angle_4.md
        reviews/
          review-correctness.md
          review-security.md
          review-tests.md
      implement/
      document/
      deliver/
        security-report.md
        deliver-summary.md

.pi/architect/        # one-time architecture factory output
  architectural-drivers.json
  architect-profile.json
  architect-report.json
  architecture.md
  adrs/
    0001-<title>.md

.IDE_Plans/architect-map/   # intermediate per-document drivers (temporary)
  <sanitized-path>.json
```

## Development

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Tests are in `pi-extension/test/` and use Node's built-in test runner.

## See also

- [`Doc/senai-sequence.md`](Doc/senai-sequence.md) — high-level stage flow.
- [`Doc/senai-full-sequence.md`](Doc/senai-full-sequence.md) — full sequence specification.
- [`Doc/step-by-step-guide.md`](Doc/step-by-step-guide.md) — detailed walkthrough.
- [`AGENTS.md`](AGENTS.md) — contributor / agent notes.

## License

MIT
