# Pi Senai

Stage-gated agent orchestration extension for Pi — **Plan → Implement → Document → Deliver**.

> **Note:** This extension and all its slash commands are branded as **Senai** (`/senai-*`). Pi loads it automatically from `package.json`.
>
> **Why "Senai"?** Senai (சேனை) is a Tamil word meaning "army," "troop," or "crowd." It describes a disciplined force where every member has a role, follows orders, and advances only when commanded. That matches how Senai works: agents are assigned roles, follow stage-gated slash commands, and obey system-prompt injections and approval gates before moving forward. "Orchestra" is a common English word with no built-in sense of command or discipline, so Senai gives the project a clearer identity.

## Quick install

```bash
pi install npm:@adi-mudi/pi-senai
```

Then open Pi in any directory and run `/senai-doctor` to verify.

For all install paths (global, project-local, dev), upgrade/uninstall, troubleshooting, and maintainer publishing instructions, see **[INSTALL.md](./INSTALL.md)**.

## Project layout

- `.pi/` — Pi's official project-local directory. Holds agents, skills, extensions, and the permanent architecture factory output (`architect/`).
- `.IDE_Plans/` — A project-local folder used to keep temporary planning artifacts, run state, and draft documents out of the repo root. It is **not** a standard Pi directory; it is a convention used by this project for transient files.

## What it does

Pi Senai splits software work into four explicit stages. Each stage runs a dedicated skill, produces artifacts in `.IDE_Plans/pi-senai/runs/<run-id>/`, and requires user approval before the next stage starts.

- **Plan** — Spawn four scout agents, interview the user, write an approved `plan.md` (capped at ~15KB and ending with a `## Verification` section that proves the mission).
- **Implement** — Build and test the feature according to the plan.
- **Document** — Update README, CHANGELOG, API docs, and other project docs — only the writers a deterministic per-project selection says this project needs.
- **Deliver** — Re-run the plan's verification steps as a blocking gate, run a final security audit, and package the deliverable.

## Before your first run

Run these commands in order. The generate commands create your sub-agent team and the `agents.json` mapping for you:

1. **Project file configuration** — tell Senai which code, input documents, and tests to include:

   ```
   /senai-configure-files
   ```

2. **Architect inputs** — select the documents the architect agent reads:

   ```
   /senai-configure-architect-inputs
   ```

3. **Architecture generation** — create the architecture documents, agents, and skills. This also creates `.pi/senai/agents.json` and maps the seven architecture-bound roles:

   ```
   /senai-generate-architect
   ```

4. **Sub-agent generation** — generate agents for the remaining fourteen roles and map them in `agents.json`. Existing custom agents are skipped, never touched:

   ```
   /senai-generate-sub-agents
   ```

5. **Agent document assignments** — assign truth and comparison documents to each role:

   ```
   /senai-configure-agents-files
   ```

Optionally, create the documentation skeleton up front — otherwise the Document stage will ask for it when it runs:

```
/senai-generate-docs-structure
```

This creates only the docs your project needs: template stubs with fixed section order and hard length caps (Standard Readme, Keep a Changelog, Nygard ADR, Google API style, Diátaxis, arc42-lite), under `docs/tutorials|how-to|reference|explanation|adr/` (only for selected types) with `README.md`/`CHANGELOG.md`/`CONTRIBUTING.md` at the root. Existing hand-written docs are never overwritten.

You can check the current settings with `/senai-agents`, `/senai-files`, and `/senai-agents-files`.

`/senai-configure-agents` is optional: use it only to hand-pick your own agents instead of the generated ones. Pi Senai requires all three configuration files (`agents.json`, `files.json`, `agents_files.json`) before any stage command will run.

After configuring, run a full diagnostic:

```
/senai-doctor
```

This checks that all config files exist, every mapped agent is found in the right place, each agent has the right tools for its Senai role, file scopes are valid, truth documents exist, and you are running inside a supported terminal multiplexer.

Once an architecture is generated, doctor also validates it: the seven architecture-bound roles (`scout-1`, `planner`, `implementer`, `reviewer-correctness`, `reviewer-security`, `reviewer-tests`, `code-review`) must map to the generated agents, each generated agent file must be intact (tools, a working skill link, and references to `architecture.md`, the ADRs, and the forbidden patterns), and no generated file may be modified after generation (drift warning).

Doctor is the final authority on your setup. Every report opens with a **Setup progress** section that shows which of the 7 setup steps are done and names the one next command — run `/senai-doctor` after every step and follow the arrow. Beyond the basics it also checks: generated team agents (mandate and technology craft present), technology resources (valid frontmatter, `generic` fallback present), every skill referenced by any agent (exists and is a valid SKILL.md), agent file integrity (name matches filename, no tool typos, valid thinking level, non-empty body), document misassignments (artifact-driven roles carrying truth/comparison documents, a truth document that contradicts the role's expected document type, or a document that does not match the agent's mandate — all errors, with an explicit warning when an assignment cannot be verified), and secrets accidentally committed in agent, skill, or config files. It also audits the subagent extension setup (pi-interactive-subagents present and up to date, no competing subagent providers, no dead package entries), flags stray `tmp_*` helper files left by subagent workarounds, recommends retry/compaction settings for long runs, and treats a run whose stage state disagrees with its artifacts (delivered but missing reports, empty `document/`, implement files in `deliver/`, oversized plan.md) as an error. When a docs skeleton was generated, doctor also validates it: missing stubs warn, filled docs must contain their template's required sections and stay within the length cap, and stray non-stub files in factory docs folders are reported as info.

Every run saves the full report to `.IDE_Plans/pi-senai/doctor-report.md` (overwritten each run).

## Usage

Start a new run:

```
/senai-plan <mission>
```

The agent will run the Plan stage. When the plan is ready, approve it:

```
/senai-approve
```

`/senai-approve` marks the current stage complete and automatically starts the next stage. Before advancing it verifies the stage's artifacts — if any are missing or empty it asks whether to advance anyway — and records the outcome in the run's `state.json` (`stageResults`). While a run is active, a completion guard also watches subagent completion notices: if a subagent reports "completed" but its artifact file was never written, the guard appends a resume instruction so the run cannot stall on an empty deliverable.

The Document stage runs as a factory: doc writers fill the template stubs created by `/senai-generate-docs-structure`, working in batches of at most 4 concurrent writers (batch N+1 waits for batch N; enforced by the stage prompt plus the completion guard — pi.dev has no official concurrency/locking). Every write task carries its target path, template id, and length cap, so docs stay few, short, and standard-formatted. Generated doc-writer agents embed the same contract (target, template, cap) in their agent body.

You can also run stages manually when the previous stage is already approved:

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

Refine the mission in a conversational pass before planning (parent LLM only, no subagents; invocable from any state):

```
/senai-brainstorm "<topic>"
/senai-brainstorm-approve
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

The picker shows two clear sections: `✅ Selected (N)` pinned on top and `💡 Suggestions (N)` below, with uniform markers — Enter toggles an item between the groups. Long paths are middle-truncated so the filename always stays visible, and the focused row shows its full path in a detail line below the list.

Configure document assignments for each role:

```
/senai-configure-agents-files
```

This command shows the document-reading Senai roles in a custom top-level picker with friendly labels (e.g., `Scout 1 — Architecture / big-picture`) so you can see what each role does before assigning documents. Only the 7 picker-visible roles are listed — the four scouts and the three reviewers. The sequence-orchestrated roles (discussion, planner, code review, security gate) follow stage artifacts automatically and are hidden; the artifact-driven roles (implementer, linter, writers, archive, …) consume stage outputs and are also hidden. Hidden roles stay valid in `agents_files.json` if you want to assign them by hand, and `/senai-doctor` still suggests documents for the sequence roles. Roles that already have a truth document or comparison documents are highlighted, so configured and unconfigured roles are easy to tell apart. Each row also shows a colored guidance tag: `[design-defined]` (green — set by the architecture factory), `[recommended]` (yellow — should be configured), or `[optional]` (dim — your choice). Rows also name the plain document type each role needs (e.g., `needs: RTM / traceability document`), and unassigned roles show doctor's concrete suggestion (e.g., `suggested: docs/RTM.md`), so you can assign correctly without prior knowledge. Selecting a role opens the same custom list editor used by `/senai-configure-files`, pre-filled with documents from `/senai-configure-files` (the `inputDocuments` pool plus discovered markdown files). Assignments are optional; when recommended roles have no truth document, `/senai-doctor` warns and suggests specific documents (from your `architect-inputs.json` document types first).

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

## Testing discipline

Pi Senai enforces a testing discipline across the four stages. It is opt-in by default — strict mode is off, so all checks are advisory until you opt in.

### What is enforced

Every test written in the **Implement** stage follows these rules:

- **AAA** structure — Arrange, Act, Assert, separated by blank lines or comments
- **Equivalence partitioning** — one representative value per input class
- **Boundary value analysis** — boundary, just-below, just-above for every numeric / length / range contract
- **Naming** — one convention everywhere (`should_<expected>_<when>_<condition>`)
- **Table-driven / parameterized** cases for repeated logic
- **Property-based** tests for pure functions (Hypothesis, fast-check, jqwik, proptest, FsCheck)
- **FIRST** quality — Fast, Independent, Repeatable, Self-validating, Timely
- **Coverage target** — 80% line + branch on changed files, 100% on security-critical paths

### Anti-patterns the scanner rejects

The deterministic scanner (`pi-extension/src/test-discipline.ts`) flags:

| # | Anti-pattern | Severity | Description |
|---|---|---|---|
| 1 | `zero-assertion` | blocking | Test runs but has no assert/expect/should |
| 2 | `over-mocking` | blocking | More than 3 test doubles in one test |
| 3 | `mirror-logic` | actionable | Assertion duplicates the production expression (e.g. `assert(add(a,b), a+b)`) |
| 4 | `flaky-timing` | actionable | `sleep`/`setTimeout` not wrapped in a polling helper |
| 5 | `no-aaa` | informational | Test body has no blank lines or Arrange/Act/Assert comments |
| 6 | `mystery-guest` | actionable | Test reads a file from outside the configured fixture paths |
| 7 | `private-method` | actionable | Test calls a method starting with `_` or `@private` |
| 8 | `god-test` | actionable | More than 5 asserts or body longer than 50 lines |

### Tool: `senai_scan_test_smells`

Call the scanner on test paths:

```
senai_scan_test_smells
```

Or from Node:

```typescript
import { scanTestFilesOnDisk } from "./dist/pi-extension/src/test-discipline.js";
const report = scanTestFilesOnDisk(["tests/", "src/**/*.test.ts"]);
console.log(report.blockingCount, report.findings);
```

### Environment variables

| # | Variable | Default | Purpose |
|---|---|---|---|
| 1 | `SENAI_TEST_DISCIPLINE_STRICT=1` | unset | Promote blocking findings + below-floor coverage to hard gates (otherwise advisory) |
| 2 | `SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR` | 80 | Minimum line + branch coverage % on changed files (0 disables the floor) |

### Where the discipline shows up

| # | Where | What |
|---|---|---|
| 1 | `skills/senai-implement.md` | `## Testing discipline` block tells the orchestrator what good tests look like; `## Approval gate` requires scan + coverage + verification before prompting |
| 2 | `skills/senai-document.md` | Orchestrator must run `npm test` AND `senai_scan_test_smells` before presenting the doc-stage approval gate |
| 3 | `skills/senai-deliver.md` | Orchestrator must re-scan and block on any NEW blocking finding not seen at implement-end (drift detection) |
| 4 | Generated `<project>-test-skeleton.md` | Carries the discipline rules in its `## Your mandate`; its `## Out of scope` forbids implementing source code |
| 5 | Generated `<project>-linter.md` | Flags the 8 anti-patterns alongside style violations |
| 6 | Generated `<project>-full-test.md` | Refuses to declare success when there are skipped tests without TODO comments |
| 7 | Generated doc-writer agents | `## Out of scope` forbids modifying test files or tested code examples |
| 8 | Architecture-generated `implementer` / `reviewer-tests` / `reviewer-correctness` | `## Testing discipline` / `## Review checklist` / `## Anti-pattern scan` sections |
| 9 | `/senai-doctor` | Two new sections: **Testing discipline** (strict mode, coverage, scanner, skills, version distribution) and **Sub-agent generator completeness** (every GENERATED_ROLES row has the v5 fields) |

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

   The architecture library includes 36 entries grouped into three categories:
   - **Application architectures** (17): monolith, modular monolith, microservices, event-driven, serverless, layered, clean, SOA, hexagonal, CQRS, pipeline, microkernel, space-based, embedded-iot, plc-scada, and Google Apps Script spreadsheet automation.
   - **Pi extension sub-patterns** (10): orchestrator, subagent-delegator, memory, tool-provider, guard, compactor, theme, provider, mcp-bridge, rpc.
   - **Pi official specs** (6): package-manifest, lifecycle-events, api-surface, skill-format, agent-format, discovery-paths.
   - **Pi-aware project architectures** (3): coding-agent, skill-package, rpc-host.

   When `/senai-generate-architect` runs on a project whose `package.json` imports from `@mariozechner/pi-*` or has a `pi-package` keyword, the factory detects the Pi extension shape (4 signal sources: drivers, inputsConfig, packageJson, agent files), biases architecture selection toward `pi-architecture`, and emits a "Pi Extension Mandatory Rules" section in the generated `architecture.md` (12 official rules covering layered deps, peerDependencies, atomic writes, skill/agent frontmatter, lifecycle event handlers, TypeBox schemas, `ctx.signal` use, and run state paths). Generated agents carry a "Pi Extension Tool Constraints" block; generated skills carry a "Pi Extension Compliance" pointer. The architecture library itself is shipped at `.pi/architecture-library/` and is project-overridable: copy any entry into the project's `.pi/architecture-library/` to shadow the bundled version without forking.

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

## Agent generation

`/senai-generate-sub-agents` creates project-specific sub-agents for the 14 non-architecture Senai roles (scouts 2–4, discussion, plan overview, test skeleton, linter, full test, the four doc writers, security gate, archive). The 7 architecture-bound roles are owned by `/senai-generate-architect` and are never generated here.

- **Basic mode (default):** if no architect report exists, you answer 3–4 questions (project type, language, framework) and the full team is generated with sensible defaults. With an architect report, the generator reuses its tech stack and constraints.
- **Technology resources:** agent craft comes from bundled resource files in `resources/technologies/` (`google-apps-script`, `python`, `generic`). The generator matches your tech stack against them. Every resource is sourced from official documentation with cited URLs.
- **No silent generic:** when no resource matches, you choose — **Fetch from official docs** (the agent searches official documentation and distills a real resource file into `.pi/technologies/<tech>.md`, cited per section; re-run the command to use it), **Use generic**, or **Cancel**.
- **Safety:** existing custom agents are never overwritten, and existing custom mappings are never changed. Re-running the command regenerates old generated agents in place — but only files the generation manifest proves pi-senai wrote and you never edited (sha256 match); your edited agents are detected and kept. A generated file you deleted is recreated automatically if its mapping still exists. The confirmation dialog shows the exact write set (create / regenerate / recreate / kept / skipped) before anything is written. After one confirmation, the new agents are written to `.pi/agents/` and mapped in `agents.json`.
- Run `/senai-doctor` afterwards to validate the setup.

To add a technology: copy `resources/technologies/_template.md` to `<technology>.md`, fill the sections from official documentation (cite the URLs), and it is picked up automatically — no code change needed. Projects can also add or override resources in `.pi/technologies/`.

## Artifact layout

```
.IDE_Plans/pi-senai/
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
