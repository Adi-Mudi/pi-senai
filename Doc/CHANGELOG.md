# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **scout-4** (requirements / documentation auditor) to the Plan stage. The Plan stage now spawns four parallel scouts, with `scout-angle_4.md` captured in constants, prompts, tests, and documentation.
- Pi.dev best-practice guidance in `skills/senai-plan.md`: context modes (`spawn`/`fork`), explicit output paths, review loops, worktree isolation for parallel writers, autonomous completion (`auto-exit: true`), and per-agent turn budgets (`max_turns` where the active subagent extension supports it).
- Added synchronization and checkpoint rules to `skills/senai-plan.md` so the main agent waits for completion notifications and checks the live subagent widget before respawning or showing the approval gate.
- New `README.md` and updated `AGENTS.md` with project conventions, layout, and test commands.
- Full production-readiness test coverage: 66 unit tests covering every exported function and major edge case.
- Unit tests for `loadSkill` and `buildStagePrompt` across all four stage skills.
- Unit tests for `checkStageArtifact` success and failure paths for implement, document, and deliver stages.
- Unit tests verifying the Plan-stage scout rule is injected during `planning` and not outside it.
- New end-to-end smoke test (`pi-extension/test/smoke.test.ts`) that simulates the full Plan → Implement → Document → Deliver lifecycle.
- `AGENTS.md` future-upgrade section describing planned project-specific agent definitions under `.pi/agents/`.

### Changed

- Renamed extension branding and all user-facing identifiers from Orchestra to Senai.
  - Slash commands now use `/senai-*`.
  - Runtime directories are `.IDE_Plans/senai` and `.pi/senai`.
  - Skill files are `skills/senai-*.md`.
  - Extension tools are `senai_merge_architect_drivers` and `senai_finalize_architecture`.
  - The npm package was renamed from `pi-orchestra` to `pi-senai`.
- `skills/senai-plan.md` rewritten to be concise and turn-budget aware, with explicit instructions to continue immediately between internal steps and a stronger fresh-scout rule. Now includes scout-4, concrete `max_turns` caps, and a clarified review-loop decision tree.
- `skills/senai-deliver.md` final approval gate now highlights that the full **Plan → Implement → Document → Deliver** cycle is complete before asking the user to run `/senai-approve`.
- `checkStageArtifact` now verifies both `security-report.md` and `deliver-summary.md` when checking Deliver artifacts, and verifies `plan.md` plus all four `scout-angle_*.md` files when checking Plan artifacts.
- Removed optional model-override hints from `skills/senai-plan.md`; Plan-stage agents now rely on Pi’s default model.
- Replaced fragile `replace("d", "")` command-name derivation in `ensureStage` with an explicit `STAGE_COMMAND_NAME` map.
- Updated all documentation (`README.md`, `AGENTS.md`, `Doc/senai-sequence.md`, `Doc/senai-full-sequence.md`, `Doc/step-by-step-guide.md`) to reflect the current artifact paths, command behavior, and stage prerequisites.

### Added

- New `plan-overview.md` artifact under `plan/`. The Plan stage now writes both:
  - `plan.md` — concrete, actionable implementation plan for agents.
  - `plan-overview.md` — user-friendly summary with mission, approach, key decisions, and expected outcome.

### Changed

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
