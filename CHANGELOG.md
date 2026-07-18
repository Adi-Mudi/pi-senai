# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Doctor architecture validation.
  - New `/senai-doctor` section "Architecture agent mapping": once an architecture is generated, the seven architecture-bound roles (`scout-1`, `planner`, `implementer`, `reviewer-correctness`, `reviewer-security`, `reviewer-tests`, `code-review`) must resolve to the generated `<project>-<architecture>-<role>` agents. `code-review` shares the generated reviewer-correctness agent, so Implement-stage code reviews also check architecture conformance. Mismatches are errors with the exact `/senai-configure-agents` fix. Display names are explicit (e.g., "Scout Architecture (scout-1)").
  - New `/senai-doctor` section "Generated agent content": opens each generated agent file and verifies the `tools`/`skills` frontmatter, that the referenced skill folder exists, and that the body still references `.pi/architect/architecture.md`, the ADRs, and the forbidden patterns section.
  - New `/senai-doctor` section "Architecture drift": warns when a generated architecture file (agents, skills, architecture.md, ADRs) was modified after the architect report was written.
  - Unit tests for all three sections.

- Doctor final-authority upgrade.
  - New sections: "Generated team agents" (mandate and technology craft present in `/senai-generate-sub-agents` output), "Technology resources" (frontmatter validity, `generic` fallback required), "Agent skill references" (every skill named in an agent's `skills:` line exists and is a valid SKILL.md), "Agent file integrity" (frontmatter name matches filename, no tool-name typos, valid thinking level, non-empty body), and "Secret scan" (API keys, tokens, passwords, private keys in agent/skill/config files with file and line).
  - Generated team agents are now drift-tracked: `/senai-generate-sub-agents` merges their hashes into `.pi/architect/generated-manifest.json`.
  - Every doctor run saves the report to `.IDE_Plans/senai/doctor-report.md`.

- Sub-agent generation.
  - New slash command: `/senai-generate-sub-agents` — generates project-specific sub-agents for the 14 non-architecture Senai roles (scouts 2–4, discussion, plan overview, test skeleton, linter, full test, the four doc writers, security gate, archive).
  - New source module: `agent-generator.ts` — fully deterministic assembly (role template + technology resource + architect report context); no LLM content generation.
  - New bundled technology resource library: `resources/technologies/` with `google-apps-script`, `python`, and `generic` resources plus a `_template.md`. Projects can add or override resources in `.pi/technologies/`; adding a technology requires no code change.
  - Every resource is sourced from official documentation with cited URLs.
  - Only roles on built-in defaults are generated; existing custom agents and mappings are never touched. One confirmation gate, then files are written to `.pi/agents/` and mapped in `agents.json`.
  - Unit tests for the generator module and the command.

- Document scope configuration.
  - New source modules: `files-config.ts` and `agents-files-config.ts`.
  - New slash commands: `/senai-configure-files`, `/senai-files`, `/senai-configure-agents-files`, `/senai-agents-files`.
  - New config files: `.pi/senai/files.json` and `.pi/senai/agents_files.json`.
  - Per-role truth document and comparison document assignment.
  - `## Document Scope` block injected into every stage prompt.
  - Stage commands now validate the new config files before running.
  - Unit tests for all new modules and updated command/prompt tests.

- Categorized file configuration with deep scanning.
  - New source module: `files-discovery.ts`.
  - `files.json` schema upgraded to version 2 with `codePaths`, `inputDocuments`, `testPaths`, and `excludedPaths`.
  - Old `version: 1` configs are automatically migrated on load.
  - `/senai-configure-files` now deep-scans the project and suggests real files and folders.
  - Selections are split into code paths, input documents, and test paths.
  - Folder and child-file mutual exclusion prevents overlapping selections.
  - Scanner recognizes standard folder names and detects custom folder names by file contents.
  - Suggestions include a reason so users understand why each item was picked.
  - Unit tests for discovery, migration, and command behavior.

- Local agent configuration feature.
  - New source modules: `agent-discovery.ts`, `agent-suggestions.ts`, `agent-config.ts`, `agent-registry.ts`.
  - New slash commands: `/senai-configure-agents` and `/senai-agents`.
  - Interactive per-project mapping of Senai roles to subagent names, saved in `.pi/senai/agents.json`.
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
- Unit tests verifying that `/senai-document` and `/senai-deliver` reject manual starts when the preceding stage's artifacts are missing.
- Unit test verifying that `/senai-document` rejects running from the `planned` stage.
- New `plan-overview.md` artifact under `plan/`. The Plan stage now writes both:
  - `plan.md` — concrete, actionable implementation plan for agents.
  - `plan-overview.md` — user-friendly summary with mission, approach, key decisions, and expected outcome.
- New `/senai-doctor` diagnostic command.
  - Audits `agents.json`, `files.json`, and `agents_files.json` for validity.
  - Reports the exact source of every mapped agent (project, user, or built-in).
  - Checks agent-role capability fit by reading agent frontmatter (`tools`, `output`, description/mandate).
  - Validates file scopes, truth documents, and runtime environment (tmux/Zellij).
  - No separate agent file; runs directly in the main Pi session.
  - Unit tests cover missing configs, missing agents, conflicting mandates, missing tools, path conflicts, and missing truth documents.

### Fixed

- The doctor drift check no longer flags freshly generated files. It now compares content hashes from `.pi/architect/generated-manifest.json` (written by the finalize tool at generation time) instead of file timestamps. The old timestamp comparison flagged every generated file on every project, because the factory writes the report before the other files. Old projects without a manifest see a quiet info line instead of false warnings.
- Architect reports with a numeric `confidence` (e.g., `95` from older generators) are now read correctly: 80+ maps to high, 50+ to medium, below 50 to low.
- Generated agents now reference the correct stage skill in their frontmatter: the architecture id is used instead of the human-readable architecture name, and the implementer agent links to the `-implement` skill instead of `-plan`.
- Re-running `/senai-generate-architect` is now safe against stale data and orphans.
  - `areDriversStale` also watches `architect-inputs.json`, so editing `additionalConstraints` or the document list triggers the re-run confirmation.
  - The merge tool only merges map outputs for currently configured documents and deletes stale map files left by removed or renamed documents (the document manifest is never touched).
  - The finalize tool removes agents and skills generated by previous architecture runs (same project slug, different architecture id) before generating the new set. User-created agents and skills are never touched.
  - ADR regeneration clears the old `adrs/*.md` files first, so the ADR set always matches the current report.
  - Unit tests cover the re-run confirm flow (accept and decline), stale map cleanup, orphan removal, ADR replacement, and config-based staleness.

### Changed

- Renamed `/senai-generate-agents` to `/senai-generate-sub-agents` for clarity. The old name remains registered as an alias, so existing usage keeps working.
- Renamed extension branding and all user-facing identifiers from Orchestra to Senai.
  - Slash commands now use `/senai-*`.
  - Runtime directories are `.IDE_Plans/senai` and `.pi/senai`.
  - Skill files are `skills/senai-*.md`.
  - Extension tools are `senai_merge_architect_drivers` and `senai_finalize_architecture`.
  - The npm package was renamed from `pi-orchestra` to `pi-senai`.
- `skills/senai-plan.md` rewritten to be concise and turn-budget aware, with explicit instructions to continue immediately between internal steps and a stronger fresh-scout rule.
- `skills/senai-deliver.md` final approval gate now highlights that the full **Plan → Implement → Document → Deliver** cycle is complete before asking the user to run `/senai-approve`.
- `checkStageArtifact` now verifies both `security-report.md` and `deliver-summary.md` when checking Deliver artifacts.
- Replaced fragile `replace("d", "")` command-name derivation in `ensureStage` with an explicit `STAGE_COMMAND_NAME` map.
- `advanceStage` now clones the state object before updating `currentStage` and `updatedAt`, aligning with the project convention to avoid in-place mutation.
- `ensureStage` no longer silently advances through intermediate stages. Manual `/senai-implement`, `/senai-document`, and `/senai-deliver` commands now require the exact preceding completed stage.
- `checkStageArtifact` now supports checking artifacts for `implement`, `document`, and `deliver` stages in addition to `plan`.
- `/senai-document` now verifies that the `implement/` directory contains artifacts before starting.
- `/senai-deliver` now verifies that the `document/` directory contains artifacts before starting.
- Stage commands now require valid `.pi/senai/agents.json`, `.pi/senai/files.json`, and `.pi/senai/agents_files.json` before running.
- Updated all documentation to reflect the current artifact paths, command behavior, and stage prerequisites.
- Run IDs now include the local hour and minute: `YYYY-MM-DD-HH-MM-<mission-slug>`.
- `/senai-approve` now automatically advances through the completed stage and immediately starts the next working stage (Implement, Document, or Deliver).
- `/senai-status` now shows the next command for every stage.
- Stage commands emit completion remarks that tell the user to run `/senai-approve` next.
- Manual `/senai-XXX` commands remain available as an alternative to auto-advance.
- Moved artifact directory from `.pi/orchestra/` to `.IDE_Plans/orchestra/` (later renamed to `.IDE_Plans/senai/` as part of the Senai rebrand).
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
