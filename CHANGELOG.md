# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Document scope configuration.
  - New source modules: `files-config.ts` and `agents-files-config.ts`.
  - New slash commands: `/orchestra-configure-files`, `/orchestra-files`, `/orchestra-configure-agents-files`, `/orchestra-agents-files`.
  - New config files: `.pi/orchestra/files.json` and `.pi/orchestra/agents_files.json`.
  - Per-role truth document and comparison document assignment.
  - `## Document Scope` block injected into every stage prompt.
  - Stage commands now validate the new config files before running.
  - Unit tests for all new modules and updated command/prompt tests.

- Categorized file configuration with deep scanning.
  - New source module: `files-discovery.ts`.
  - `files.json` schema upgraded to version 2 with `codePaths`, `inputDocuments`, `testPaths`, and `excludedPaths`.
  - Old `version: 1` configs are automatically migrated on load.
  - `/orchestra-configure-files` now deep-scans the project and suggests real files and folders.
  - Selections are split into code paths, input documents, and test paths.
  - Folder and child-file mutual exclusion prevents overlapping selections.
  - Scanner recognizes standard folder names and detects custom folder names by file contents.
  - Suggestions include a reason so users understand why each item was picked.
  - Unit tests for discovery, migration, and command behavior.

- Local agent configuration feature.
  - New source modules: `agent-discovery.ts`, `agent-suggestions.ts`, `agent-config.ts`, `agent-registry.ts`.
  - New slash commands: `/orchestra-configure-agents` and `/orchestra-agents`.
  - Interactive per-project mapping of Orchestra roles to subagent names, saved in `.pi/orchestra/agents.json`.
  - Agent discovery from project `.pi/agents/*.md`, user agent directory, and built-in defaults.
  - Agent registry block injected into every stage prompt so subagents are spawned by the configured names.
  - Unit tests for all new modules and updated tests for commands and prompt injection.
- New `README.md` and updated `AGENTS.md` with project conventions, layout, and test commands.
- Full production-readiness test coverage: 66 unit tests covering every exported function and major edge case.
- Unit tests for `loadSkill` and `buildStagePrompt` across all four stage skills.
- Unit tests for `checkStageArtifact` success and failure paths for implement, document, and deliver stages.
- Unit tests verifying the Plan-stage scout rule is injected during `planning` and not outside it.
- New end-to-end smoke test (`pi-extension/test/smoke.test.ts`) that simulates the full Plan → Implement → Document → Deliver lifecycle.
- Unit tests verifying that `advanceStage` returns a new state object and does not mutate the input.
- Unit tests verifying that `/orchestra-document` and `/orchestra-deliver` reject manual starts when the preceding stage's artifacts are missing.
- Unit test verifying that `/orchestra-document` rejects running from the `planned` stage.
- New `plan-overview.md` artifact under `plan/`. The Plan stage now writes both:
  - `plan.md` — concrete, actionable implementation plan for agents.
  - `plan-overview.md` — user-friendly summary with mission, approach, key decisions, and expected outcome.
- New `/orchestra-doctor` diagnostic command.
  - Audits `agents.json`, `files.json`, and `agents_files.json` for validity.
  - Reports the exact source of every mapped agent (project, user, or built-in).
  - Checks agent-role capability fit by reading agent frontmatter (`tools`, `output`, description/mandate).
  - Validates file scopes, truth documents, and runtime environment (tmux/Zellij).
  - No separate agent file; runs directly in the main Pi session.
  - Unit tests cover missing configs, missing agents, conflicting mandates, missing tools, path conflicts, and missing truth documents.

### Changed

- `skills/orchestra-plan.md` rewritten to be concise and turn-budget aware, with explicit instructions to continue immediately between internal steps and a stronger fresh-scout rule.
- `skills/orchestra-deliver.md` final approval gate now highlights that the full **Plan → Implement → Document → Deliver** cycle is complete before asking the user to run `/orchestra-approve`.
- `checkStageArtifact` now verifies both `security-report.md` and `deliver-summary.md` when checking Deliver artifacts.
- Replaced fragile `replace("d", "")` command-name derivation in `ensureStage` with an explicit `STAGE_COMMAND_NAME` map.
- `advanceStage` now clones the state object before updating `currentStage` and `updatedAt`, aligning with the project convention to avoid in-place mutation.
- `ensureStage` no longer silently advances through intermediate stages. Manual `/orchestra-implement`, `/orchestra-document`, and `/orchestra-deliver` commands now require the exact preceding completed stage.
- `checkStageArtifact` now supports checking artifacts for `implement`, `document`, and `deliver` stages in addition to `plan`.
- `/orchestra-document` now verifies that the `implement/` directory contains artifacts before starting.
- `/orchestra-deliver` now verifies that the `document/` directory contains artifacts before starting.
- Stage commands now require valid `.pi/orchestra/agents.json`, `.pi/orchestra/files.json`, and `.pi/orchestra/agents_files.json` before running.
- Updated all documentation to reflect the current artifact paths, command behavior, and stage prerequisites.
- Run IDs now include the local hour and minute: `YYYY-MM-DD-HH-MM-<mission-slug>`.
- `/orchestra-approve` now automatically advances through the completed stage and immediately starts the next working stage (Implement, Document, or Deliver).
- `/orchestra-status` now shows the next command for every stage.
- Stage commands emit completion remarks that tell the user to run `/orchestra-approve` next.
- Manual `/orchestra-XXX` commands remain available as an alternative to auto-advance.
- Moved artifact directory from `.pi/orchestra/` to `.IDE_Plans/orchestra/` to align with the Senai spec.
- Reorganized run artifacts into stage subfolders:
  - `plan/` with nested `scouts/` and `reviews/`
  - `implement/`
  - `document/`
  - `deliver/`
- Updated all documentation to reflect the new auto-advance behavior and artifact paths.
- Updated unit tests to assert the new directory layout and auto-advance behavior.

## [0.1.0] - 2026-06-12

### Added

- Initial `pi-orchestra` extension with stage-gated orchestration commands:
  - `/orchestra-plan <mission>`
  - `/orchestra-approve`
  - `/orchestra-implement`
  - `/orchestra-document`
  - `/orchestra-deliver`
  - `/orchestra-status`
  - `/orchestra-reset`
- State persistence under `.IDE_Plans/orchestra/state.json`.
- Run-specific artifact directory under `.IDE_Plans/orchestra/runs/<run-id>/`.
- Stage skill prompts for Plan, Implement, Document, and Deliver.
- System prompt injection showing active orchestra stage.
- Subagent-process guard to prevent recursive orchestration.
- Unit tests covering constants, state, prompt, commands, and index modules.
- TypeScript build setup with `npm run build` and `npm test`.
- Documentation: README, CHANGELOG, and step-by-step guide.
