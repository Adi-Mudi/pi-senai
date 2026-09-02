# AGENTS.md — Pi Senai

Agent-focused guidance for working on the `pi-senai` Pi extension.

## Project layout

- `.pi/` — Pi's official project-local directory. Holds agents, skills, extensions, and permanent architecture factory output.
- `.IDE_Plans/` — A project-local folder for temporary planning artifacts and run state. Not a standard Pi directory; used by this project to keep the repo root clean.

## Project overview

`pi-senai` is a local Pi extension that adds stage-gated orchestration slash commands:

```
Plan → Implement → Document → Deliver
```

It does **not** spawn subagents itself. Spawning is delegated to the [`pi-interactive-subagents`](https://github.com/HazAT/pi-interactive-subagents) extension. This extension only manages sequence logic, state, and stage skill prompts.

## Tech stack

- **Language:** TypeScript
- **Runtime:** Node.js (tests use `node --test`)
- **Package manager:** npm
- **Build:** `tsc` (see `tsconfig.json`)
- **Target layout:** ESM under `dist/`
- **Peer dependency:** `@mariozechner/pi-coding-agent`

## Build and test

Always build before testing. The test script builds automatically, but running build first catches TypeScript errors faster.

```bash
npm run build
npm test
```

- `npm run build` — compiles `pi-extension/src/**/*.ts` to `dist/pi-extension/`.
- `npm test` — builds, then runs `node --test dist/pi-extension/test/**/*.test.js`.

## Project structure

```text
.
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── AGENTS.md            # this file
├── .gitignore
├── pi-extension/src/    # extension source
│   ├── index.ts         # entry point: register commands, hooks, guards, tools
│   ├── commands.ts      # slash command handlers
│   ├── architect-tools.ts # deterministic tools for the architecture factory
│   ├── state.ts         # read/write .IDE_Plans/senai/state.json
│   ├── prompt.ts        # load stage skills and build prompts
│   ├── constants.ts     # paths, stage enum, transitions, helpers
│   ├── agent-discovery.ts   # discover project/user/built-in agents
│   ├── agent-suggestions.ts # suggest agents per Senai role
│   ├── agent-config.ts           # load/save/validate .pi/senai/agents.json
│   ├── agent-registry.ts         # build agent registry prompt block
│   ├── agent-generator.ts        # deterministic sub-agent generator (/senai-generate-sub-agents)
│   ├── files-config.ts           # load/save/validate .pi/senai/files.json
│   ├── agents-files-config.ts    # load/save/validate .pi/senai/agents_files.json
│   ├── compaction.ts             # deterministic compaction summary for active runs
│   ├── completion-guard.ts       # artifact-based subagent completion/stall guard
│   ├── doc-catalog.ts            # doc-type catalog: fixed templates + length caps (single source of truth)
│   ├── doc-selection.ts          # deterministic Document stage writer selection + batched write plan
│   └── mission-brief.ts          # /senai-discussion helpers: draft marker, monotonic sequence, amendment cross-out, section validation
├── pi-extension/test/   # unit tests
├── skills/              # stage skill markdown files
│   ├── senai-plan.md
│   ├── senai-implement.md
│   ├── senai-document.md
│   └── senai-deliver.md
└── Doc/                 # human-facing design docs
    ├── senai-sequence.md
    ├── senai-full-sequence.md
    └── step-by-step-guide.md
```

## Key design principles

1. **No duplicate subagent engine.** Do not add subagent spawning logic here. The extension injects prompts; the LLM calls the `subagent` tool provided by `pi-interactive-subagents`.
2. **Local-only state.** Run state and run artifacts live under `.IDE_Plans/senai/`. Architecture factory state lives under `.pi/architect/`.
3. **Soft approval gates.** The extension enforces stage order and artifact existence; the user approves advancement.
4. **Approve auto-runs the next stage.** `/senai-approve` advances the state and immediately sends the next stage prompt. Manual `/senai-XXX` commands remain available as overrides. Before advancing, approve verifies the completed stage's artifacts; missing or empty artifacts trigger a warn-and-ask confirm instead of a hard block, and the outcome (approval time + artifact check) is recorded in `state.json` `stageResults`. When parent context usage is 50% or higher (or absolute tokens reach 40% of the context window, which covers the post-compaction window where `percent` is null), approve also compacts the session first; a `session_before_compact` hook supplies a deterministic run-state summary (run id, stage, artifact paths), so compaction costs no LLM call and no run state is lost.
5. **Document scope is prompt-level guidance.** The extension injects a `## Document Scope` block into stage prompts. It does not enforce a filesystem sandbox; subagents still decide what to read.

## Document scope configuration

Three config files live under `.pi/senai/`:

| File | Command | Purpose |
|---|---|---|
| `agents.json` | `/senai-configure-agents` | Maps each Senai role to a subagent name. Roles are shown with friendly labels (e.g., `Scout 1 — Architecture / big-picture`). |
| `files.json` | `/senai-configure-files` | Categorized project context: code paths, input documents, and test paths. |
| `agents_files.json` | `/senai-configure-agents-files` | Per-role truth document and comparison documents. The picker shows only the 7 picker-visible roles (`PICKER_ROLES` in `agent-suggestions.ts`) with colored guidance tags (`ROLE_GUIDANCE`); the 4 sequence-orchestrated roles (`SEQUENCE_ROLES`: discussion, planner, code-review, security-gate) and artifact-driven roles are hidden but stay valid in JSON, and doctor keeps suggesting documents for the sequence roles. Document suggestions come from `architect-inputs.json` document types first, then `files.json` `inputDocuments`. When recommended roles lack a truth document, doctor warns with concrete suggestions (`document-suggestions.ts`). Rows show the plain document type each role needs (`roleDocumentNeed` in `document-suggestions.ts`) and doctor's suggested file for unassigned roles. Misassignments are errors: artifact-driven roles carrying documents, or a truth document that contradicts the role's expected document type. Roles without suggestion rules (`scout-2`, `plan-overview`) are checked against the agent's mandate; `scout-3` stays existence-only; unverifiable assignments get an explicit warning. |

All three files are required before any stage command (`/senai-plan`, `/senai-implement`, `/senai-document`, `/senai-deliver`) will run. `agents.json` is normally created by the generate commands (see below); `/senai-configure-agents` is the optional manual override for hand-picking custom agents. Run `/senai-configure-files` and `/senai-configure-agents-files` for the other two files.

Every `.pi/senai/` config file (these three plus `architect-inputs.json`) starts with a `_comment` field: a one-line plain instruction saying what the file is for and which command manages it. Savers always write it; loaders strip it after parsing, so the in-memory shape and validation are unchanged.

Use `/senai-doctor` to audit the full setup. Every report opens with a "Setup progress" section that marks the 7 setup steps done or pending and names the one next command, so a first-time user can follow it step by step. It reports the exact source of every mapped agent (project, user, or built-in), checks whether each agent has the tools and mandate needed for its Senai role, validates file scopes and truth documents, verifies the runtime environment, and verifies the architecture factory outputs. Once an architecture exists, it also validates the architecture agent mapping (the seven architecture-bound roles must resolve to the generated agents (code-review shares the reviewer-correctness agent)), the generated agent file contents (tools, skill link, architecture.md/ADR references, forbidden patterns), and drift (content-hash manifest). Strict checks also cover generated team agents (mandate and technology craft), technology resources, every skill referenced by any agent (exists and is a valid SKILL.md), agent file integrity (name matches filename, no tool typos, valid thinking level, non-empty body), and a secret scan over agent, skill, and config files. A "Subagent extension" section audits pi's package list (pi-interactive-subagents present and >= 3.7.2, warnings for multiple subagent providers and dead package entries), a "Stray files" section flags leftover `tmp_*.sh`/`tmp_*.ts` helper scripts in the project root and run directories, and the environment section recommends `retry.maxRetries >= 5`, warns when compaction is disabled, and shows pi's auto-compact threshold. The run audit reports a delivered run with missing deliver artifacts, an empty `document/` directory, or implement-stage files inside `deliver/` as errors, and warns when plan.md exceeds 50KB. A "Documentation factory" section validates the docs skeleton from `/senai-generate-docs-structure` (missing stubs warn; filled docs must contain their template's required sections and stay within the catalog length cap; stray non-stub files in factory docs folders are info). Each run saves the report to `.IDE_Plans/senai/doctor-report.md`.

A "Discussions" section validates every `mission-brief.md` (pre-run and per-run) against the required section list (Problem statement, Mission type, Success criteria, Out-of-scope, Open questions, Refined mission), flags runs with multiple active `discussion-*` subfolders, and reports orphan pre-run transcripts with no brief. Setup progress gains one optional step noting `/senai-discussion` as a pre-Plan refinement pass.

## Document factory

`/senai-generate-docs-structure` reads the doc-selection write plan (architecture profile + package.json/manifest signals; project-wise only) and creates the docs skeleton: `docs/tutorials|how-to|reference|explanation|adr/` subfolders only for selected types, `README.md`/`CHANGELOG.md`/`CONTRIBUTING.md` at the root, one template stub per selected doc, and a manifest at `.pi/senai/docs-structure.json`. Existing non-stub docs are never overwritten (stubs carry a `<!-- pi-senai doc stub -->` marker). Templates and hard length caps live in `pi-extension/src/doc-catalog.ts` (Standard Readme, Keep a Changelog 1.1.0, Nygard ADR, Google API style, Diátaxis, arc42-lite) — the single source of truth shared by selection, the skeleton command, generated writer agents, and doctor. The Document stage fills the stubs batch-wise: max 4 concurrent writers, batch N+1 waits for batch N, enforced by the stage prompt plus the completion guard only (pi.dev has no official concurrency/locking).

## Architecture factory layout

The `/senai-generate-architect` command produces a one-time architecture for the project.

**Input config (stays in `.pi/senai/`):**

| File | Command | Purpose |
|---|---|---|
| `architect-inputs.json` | `/senai-configure-architect-inputs` | Documents and constraints used to derive the architecture. |

**Generated state and artifacts (live in `.pi/architect/`):**

| File | Purpose |
|---|---|
| `architectural-drivers.json` | Merged architectural drivers from all input documents. |
| `architect-profile.json` | Project name/slug and selected architecture id. |
| `architect-report.json` | Full architecture report. |
| `architecture.md` | Human-readable architecture description. |
| `adrs/*.md` | Architecture decision records. |
| `.IDE_Plans/architect-map/*.json` | Intermediate per-document driver files (temporary; outside `.pi/`). |

**Generated Pi-discoverable outputs (live in `.pi/` per Pi docs):**

| Location | Purpose |
|---|---|
| `.pi/agents/<project>-<architecture-id>-<role>.md` | Five generated architecture agents. |
| `.pi/skills/<project>-<architecture-id>-<stage>/SKILL.md` | Four generated architecture skills. |

The factory uses two deterministic tools to avoid LLM drift:

- `senai_merge_architect_drivers` — merges map outputs for the currently configured documents only, deletes stale map files from removed or renamed documents, and cleans stale root files.
- `senai_finalize_architecture` — generates docs, agents, and skills with exact names. Removes agents and skills left over from previous architecture runs only when the generation manifest proves pi-senai wrote them and the user never edited them (name pattern + sha256 guard); anything else is kept and reported as `keptStaleArtifacts`. Regenerates the ADR set to match the report, and preserves sub-agent entries in `generated-manifest.json` (merge, not wipe) so team-agent drift tracking survives an architect re-run. Generated architecture agents declare `session-mode: lineage-only`, `auto-exit: true`, and `spawning: false`; reviewer agents keep `write` for their review artifact but do not get the `edit` tool. Also auto-maps the seven architecture-bound roles in `agents.json` (creating the file if missing) via `autoMapArchitectureAgents`: roles on built-in defaults or pointing at stale generated agents for the same project are remapped; other custom mappings are never touched. The role→agent mapping lives in the shared `ARCHITECTURE_AGENT_MAPPING` constant in `architect.ts`, which doctor also uses.

## Sub-agent generation

`/senai-generate-sub-agents` deterministically generates sub-agents for the 14 non-architecture roles (the 7 architecture-bound roles belong to the architecture factory). Agent content is assembled, never LLM-generated: role template + technology resource + architect report context. Generated agents declare `session-mode: lineage-only`, `auto-exit: true`, and `spawning: false`; artifact-writing roles (scout-2/3/4, discussion, plan-overview, security-gate, and since generator v3 also linter and full-test, which write report artifacts) carry the `write` tool; and every generated body ends with a completion contract (final message ≤ 10 lines: outcome + artifact path, never pasted content). Doc-writer roles (readme-writer, changelog-writer, api-docs-writer, other-docs-writer) also carry a documentation contract from the doc catalog: default target path, template id, required sections, and the hard length cap.

- Technology resources live in `resources/technologies/` (bundled) and `.pi/technologies/` (project overrides). Adding a technology means adding one markdown file with `id`, `name`, `keywords` frontmatter — no code change. When nothing matches, the user chooses: fetch the resource from official documentation (distilled into `.pi/technologies/<tech>.md`), use `generic`, or cancel — generic is never a silent default.
- Every resource must be sourced from official documentation with cited URLs and carry the template sections (core rules, testing patterns, tooling/limits, common mistakes). Doctor validates all of this in the "Technology resources" section, plus keyword matchability.
- Generation targets two groups: roles on built-in defaults (fresh) and roles already mapped to their generated name (regenerate). The confirmation dialog previews the exact write set before anything is written: create, regenerate in place, recreate (file missing but mapping exists), kept (user-edited), skipped (unknown origin). Overwriting happens only for files the generation manifest proves pi-senai wrote and the user never edited (sha256 match in `.pi/architect/generated-manifest.json`); user-edited files are kept and reported, and custom agents and mappings are never touched. Every generated footer carries the generator version (`generator v4`) so doctor can flag stale files; a deleted generated file with a surviving mapping is recreated automatically. After one confirmation, files land in `.pi/agents/` and `agents.json` is updated (created if missing — no prior configuration is needed).


### `files.json` schema (version 2)

```json
{
  "version": 2,
  "codePaths": ["src/", "app/"],
  "inputDocuments": ["docs/PRD.md", "README.md"],
  "testPaths": ["tests/"],
  "excludedPaths": [".git/", "node_modules/", "dist/"]
}
```

- `codePaths` — folders that contain implementation code.
- `inputDocuments` — individual files the agent should read as instructions.
- `testPaths` — folders or files that contain tests.
- `excludedPaths` — folders the scanner should ignore.

The `/senai-configure-files` command deep-scans the project and suggests items for each category. It recognizes standard names like `src/`, `docs/`, and `tests/`, and also detects custom folder names by looking at the file types inside them. Selecting a folder blocks selection of any file inside it, and vice versa, to prevent overlap.

The Document Scope block in stage prompts shows:

1. Which roles have truth documents and comparison documents.
2. The categorized project context for unconfigured roles.
3. A fallback instruction to read current stage artifacts when needed.

Validation checks JSON shape and known role names. It does not require files to exist, because earlier stages may create them.

## State and artifacts

State file:

```text
.IDE_Plans/senai/state.json
```

`state.json` schema (version 1): `version`, `mission`, `runId`, `currentStage`, `startedAt`, `updatedAt`, `stageResults`, plus (since the discussion entry point) the optional fields `discussions: number`, `discussionEvents: Array<{ts, transcriptPath, briefPath, afterStage?}>`, and `missionBriefPath?: string`. Legacy v1 states load with these fields undefined; `defaultState()` seeds `discussions: 0` and `discussionEvents: []` for fresh runs.

Run artifacts:

```text
.IDE_Plans/senai/runs/<run-id>/
├── mission-brief.md          # living doc updated by /senai-discussion (when active run)
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
├── deliver/
│   ├── security-report.md
│   └── deliver-summary.md
└── discussions/              # per-run transcripts (monotonic NN)
    ├── discussion-01-<slug>.md
    ├── discussion-02-<slug>.md
    └── …
```

Pre-run discussion folder (no run active yet):

```text
.IDE_Plans/senai/discussions/pre-run/
├── mission-brief.md          # consumed by /senai-plan on next start
├── discussion-01-<slug>.md
└── …
```

Run ID format:

```text
YYYY-MM-DD-HH-MM-<mission-slug>
```

## Stage workflow

| Stage transition | Command that triggers it |
|---|---|
| `none` → `planning` | `/senai-plan <mission>` |
| `planning` → `planned` → `implementing` | `/senai-approve` |
| `planned` → `implementing` | `/senai-implement` (manual override) |
| `implementing` → `implemented` → `documenting` | `/senai-approve` |
| `implemented` → `documenting` | `/senai-document` (manual override) |
| `documenting` → `documented` → `delivering` | `/senai-approve` |
| `documented` → `delivering` | `/senai-deliver` (manual override) |
| `delivering` → `delivered` | `/senai-approve` |

Stage transitions are defined in `constants.ts` as `STAGE_TRANSITIONS`.

**Discussion is orthogonal.** `/senai-discussion` and `/senai-discussion-approve` are NOT stages — they do NOT appear in `STAGE_TRANSITIONS` and never mutate `state.json.stage`. The state machine stays linear. Discussions run from `none`, any active stage, or `delivered`. When a run is active, artifacts live under `.IDE_Plans/senai/runs/<run-id>/`; otherwise under `.IDE_Plans/senai/discussions/pre-run/`. Plan replacement uses an ADR-style supersede banner on `plan.md` rather than overwriting it.

## Coding conventions

- Use TypeScript strict mode.
- Prefer explicit types; export public interfaces from their modules.
- Use `path.join` for all file-system paths.
- Keep command handlers thin. State logic belongs in `state.ts`; prompt logic belongs in `prompt.ts`.
- Do not mutate loaded state objects in place. Use `advanceStage()` and `saveState()` helpers.
- Notifications should be concise and tell the user the next command to run.

## Testing

- Tests are in `pi-extension/test/` using Node's built-in test runner.
- Each test file focuses on one module.
- Tests use temporary directories created with `fs.mkdtempSync`.
- When testing commands, build the handler map by calling `registerCommands` with a mock `ExtensionAPI`.
- End-to-end tests (RPC harness against `pi --mode rpc`) live in `pi-extension/test/e2e/` and require `pi` on PATH plus `RUN_E2E=1`. Run with `RUN_E2E=1 npm run test:e2e`; default `npm test` skips them. See `Doc/step-by-step-guide.md` → "Running E2E tests" for the snapshot workflow.

## Extension loading

The extension guards against loading inside subagent processes:

```typescript
if (process.env.PI_SUBAGENT_NAME) return;
```

Do not remove this guard.

## Development symlink

For local testing, the extension can be symlinked into Pi:

```bash
ln -sf /mnt/Just_Do_It/02_Devp_Soft/pi-senai/Pi-Senai_v4 ~/.pi/agent/extensions/pi-senai
```

After code changes, run `npm run build` and restart Pi or run `/reload`.

## Documentation

When changing behavior, update both code-facing docs (`README.md`, `CHANGELOG.md`) and design docs (`Doc/*.md`) plus stage skill files (`skills/*.md`) if the user-facing workflow changes.

### Doc map

- `Doc/senai-sequence.md` — high-level stage flow and artifact layout.
- `Doc/senai-full-sequence.md` — full sequence specification with agents and contexts.
- `Doc/step-by-step-guide.md` — hands-on walkthrough for running a full cycle.

## Agent configuration

Pi Senai supports project-specific and user-specific agent definitions in `.pi/agents/*.md` files with YAML frontmatter. The extension discovers them and maps each Senai role to an agent name.

### Discovery order

1. **Project agents** — nearest `.pi/agents/*.md` found by walking up from the current working directory.
2. **User agents** — files in Pi's user agent directory (`getAgentDir()/agents`).
3. **Built-in defaults** — `scout`, `planner`, `worker`, `reviewer`, `security-auditor`.

A project agent overrides a user agent with the same name. Built-ins are used only when no project or user agent with that name exists.

### Agent file format

Each `.md` file must include `name` and `description` in its YAML frontmatter:

```markdown
---
name: gas-coder
description: Writes TypeScript implementation and tests
---

# gas-coder

Use this agent for implementation work...
```

Files missing `name` or `description` are skipped. Only `.md` files are considered; symlinks are followed.

### Configuration file

The interactive `/senai-configure-agents` command writes `.pi/senai/agents.json`:

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

Only roles that differ from the default need to be listed. Stage commands validate the file and warn if a mapped custom agent is missing.

### Modules

- `agent-discovery.ts` — walks the project tree, reads user agents, and appends built-in defaults.
- `agent-suggestions.ts` — maps role keywords to discovered agent names.
- `agent-config.ts` — loads, validates, saves, and resolves the JSON config.
- `agent-registry.ts` — builds the markdown registry block injected into stage prompts.

## Branches

Active development happens on the `development` branch. Do not run git mutations (commit, push, reset, rebase) unless explicitly asked.
