# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Adaptive spawn cadence for the Plan stage: a new `pi-extension/src/spawn-cadence.ts` module persists a per-project dispatch tier (A = parallel burst, B = staggered 5s, C = batch-2 with 10s gap, D = fully serial) in `.IDE_Plans/senai/spawn-cadence.json`. Default tier is A (fastest). The tier demotes one step on rate-limit-style errors (429 / 5xx / `stopReason:error` from pi-interactive-subagents v3.7.2+) detected in extension steer messages, and promotes one step after 3 consecutive clean Plan-stage approvals. Tier D is the floor and requires 7 clean runs + a manual `/senai-cadence-reset` to escape. The Plan-stage prompt injects a `Spawn Cadence (adaptive)` block with the current dispatch rule so scouts and reviewers do not need a static stagger rule; the existing 60s + `subagent_resume` recovery playbook still applies at every tier. Only the Plan stage is affected — Document / Implement / Deliver are unchanged. Two new commands: `/senai-cadence-status` (read-only) and `/senai-cadence-reset` (with confirm dialog). `/senai-doctor` now has a Spawn cadence section between Lock state and Configuration files.
- E2E coverage for the cadence feature: new `pi-extension/test/e2e/10-cadence.test.ts` adds four tests — `get_commands` registration check for both cadence commands and the lock helpers, an on-disk format round-trip for `.IDE_Plans/senai/spawn-cadence.json`, and two slash-command smoke tests (status on a fresh project, reset on a tier-D state) that skip cleanly when the RPC prompt handler is broken on the local pi binary. The existing `01-registration.test.ts` EXPECTED_COMMANDS list is updated to include `senai-cadence-status`, `senai-cadence-reset`, `senai-lock-info`, and `senai-lock-force`.
- Comprehensive E2E coverage expansion (Tier 1 + Tier 2 + CI): the E2E suite under `pi-extension/test/e2e/` grew from 10 suites to 22 suites and from 17 tests to 35 tests. Phase A (Tier 1, always-on, no LLM): `11-caden-approve` proves `recordCleanRun` fires from `/senai-approve` and only Plan approvals count; `12-doctor-cadence` drives the doctor via a `bash` RPC + `node -e` subprocess so the Spawn cadence section is rendered without hitting the prompt bug; `13-state-machine-edges` covers `/senai-plan` replace-active-run warn-and-ask, `/senai-reset` preserves run artifacts, and Deliver → reset → replan starts a fresh run id; `14-discussion-idempotent` proves `/senai-discussion-approve` is a no-op on the second call; `15-doctor-full-run` asserts every canonical doctor section appears on a fresh project; `16-generator-preview` covers `previewRegeneration` for the sub-agent generator; `17-docs-factory` covers `/senai-generate-docs-structure` skeleton creation and oversize-doc detection; `18-mission-brief-amend` proves `amendBullet` preserves old bullets via strike-through cross-out. Phase B (Tier 2, real LLM, gated by `RUN_LLM_E2E=1` + a provider API key): `20-real-llm-scout` waits up to 120s for 4 parallel scouts to write substantive `scout-angle_*.md` files; `21-real-llm-reviewer` waits for 3 reviewers to write `review-*.md`; `22-real-llm-caden-demote` proves a real Plan-stage burst either demotes cadence via a 429 (low-quota provider) or leaves it valid at A (generous provider); `23-real-llm-discussion` captures `extension_ui_request` events from `/senai-discussion`. New helper: `seedCadenceState(cwd, state)` in `helpers/fixtures.ts`. New gate: `shouldRunLLME2E()` in `helpers/test-home.ts`. New script: `npm run test:e2e:tier2` (runs only files matching `2*.test.js` with `RUN_LLM_E2E=1` and a 300s timeout). `04-prompt-injection.test.ts` REQUIRED_SUBSTRINGS grew to include `"## Spawn Cadence (adaptive)"` and `"parallel burst"` so any regression that drops the cadence block from the Plan-stage prompt is caught. Phase C (CI): new `.github/workflows/e2e.yml` runs Tier 1 on every PR + push to `development`/senai-discussion, runs Tier 2 on nightly + manual dispatch + the `e2e:llm` PR label, with npm cache, `pi` install step, artifact upload on failure, and an optional Slack notification.
- E2E field-name fix + LLM skip gate: `helpers/rpc-client.ts` `request()` now normalizes `payload.text` to `payload.message` for `type: "prompt"` so the prompt call works against pi 0.84.3 (the bug logged in earendil-works/pi#2461 as "first prompt fails" is actually a missing-field bug that fires on every prompt when called with `text` instead of `message`). New `hasRealLlmKey()` gate in `helpers/test-home.ts` lets tests that drive `/senai-plan`, `/senai-approve`, `/senai-discussion`, etc. skip cleanly when only the dummy CI key is available. New 15s default timeout in `waitForIdle()` so a pi process that never emits `agent_settled` fails the test fast instead of hanging for 60s. `10-cadence.test.ts` updated: removed unnecessary `waitForIdle()` calls after pure extension commands (`/senai-cadence-status` and `/senai-cadence-reset` don't trigger agent turns); added cleanup of the cadence state file between tests (the suite shares one `home`); added `extension_ui_response` handling so the confirm dialog from `/senai-cadence-reset` is auto-accepted. Net effect on this machine against pi 0.84.3 with no real API key: 6 tests pass + 29 skip + 0 fail (was 5 pass + 30 skip + 0 fail). On pi 0.84.3 with a real API key, the LLM-needing tests will pass automatically.
- Discussion entry point: two new slash commands that are NOT state-machine stages — `/senai-discussion "<topic>"` opens a conversational mission-refinement pass with the user (parent LLM only, AskUserQuestion loops, no subagents) and writes a draft `mission-brief.md` plus a transcript `discussions/discussion-NN-<slug>.md`; `/senai-discussion-approve` finalizes the brief (clears the draft marker, appends a `discussionEvents` entry). Discussions are invocable from any state — `none`, active stages, or `delivered` — and never mutate `state.json.stage`. When a run is active, artifacts live under `.IDE_Plans/senai/runs/<run-id>/`; otherwise under `.IDE_Plans/senai/discussions/pre-run/`. Multiple sequential discussions per run are supported (monotonic NN). Plan replacement uses an ADR-style supersede banner on the old `plan.md` rather than overwriting it.
- Tier-1 end-to-end test suite under `pi-extension/test/e2e/`: a borrowed adaptation of Pi's `RpcClient` (MIT, strict LF-only JSONL over `pi --mode rpc --no-session`) plus 9 focused tests covering registration, the full state-machine lifecycle, every transition in `STAGE_TRANSITIONS`, plan-stage prompt injection (with a base64-encoded golden for snapshot drift), the `session_before_compact` summary, the spawn guard (typed vs. untyped), the completion guard, the architect tools, and the pre-run mission-brief shape. Tests skip cleanly when `pi` is not on PATH or `RUN_E2E!=1`, so CI never fails on developer-machine prereqs. Run with `RUN_E2E=1 npm run test:e2e`; refresh the golden with `RUN_E2E=1 npm run test:e2e:update-snapshots`.
- `/senai-plan` now warns and asks before replacing an active run. When `state.json.stage` is anything other than `none` or `delivered`, the command shows a `runSimpleConfirm` dialog naming the current run id + mission; default = cancel. If the user prefers to update the existing run, the dialog suggests `/senai-discussion`. The plan command also consumes the latest pre-run `mission-brief.md` (when present) and stores its path in `state.missionBriefPath`.
- `state.json` extended (backwards compatible) with `discussions: number`, `discussionEvents: Array<{ts, transcriptPath, briefPath, afterStage?}>`, and `missionBriefPath?: string`. Legacy states load with defaults from `defaultState()`; no migration bump.
- `/senai-doctor` Discussions section: validates every `mission-brief.md` (pre-run and per-run) against the required section list (Problem statement, Mission type, Success criteria, Out-of-scope, Open questions, Refined mission), flags runs with multiple active `discussion-*` subfolders, and reports orphan pre-run transcripts with no brief.
- `skills/senai-discussion.md`: mission-type question first (feature / bugfix / exploration), then 2-5 focused AskUserQuestion rounds, brief amendment via strike-through cross-out, plan supersede via ADR-style banner on `plan.md`.
- Completion guard: during an active run, a deterministic `input` hook inspects subagent completion notices (pi-interactive-subagents steer messages) and appends a resume instruction when the subagent's recorded artifact is missing or empty — "completed" no longer ends a stage without its file on disk. Spawn calls are recorded via the existing `tool_call` hook; the guard never blocks input and steps aside when no run is active.
- `/senai-doctor` new checks: subagent extension audit (pi-interactive-subagents present and >= 3.7.2, warns on multiple subagent providers and on dead package entries in pi settings), stray `tmp_*` helper file detection in the project root and run directories, retry.maxRetries >= 5 recommendation, compaction.enabled warning, and the pi auto-compact threshold (contextWindow - reserveTokens) shown as info.
- Document stage writer selection: a deterministic decision table (`doc-selection.ts`) picks which document writers a project needs (README always; changelog for versioned projects; api-docs for packages with a public API surface; other-docs for projects accepting contributions) and injects the set into the Document stage prompt.
- Document factory: a doc-type catalog (`doc-catalog.ts`) defines fixed, standard-based Markdown templates (Standard Readme, Keep a Changelog 1.1.0, Nygard ADR, Google API style, Diátaxis, arc42-lite) with hard length caps; doc-selection now emits a concrete write plan per selected doc (target path, template id, cap) grouped into execution batches of max 4 writers (batch N+1 waits for batch N; enforced by the stage prompt plus the completion guard — pi.dev has no official concurrency/locking).
- `/senai-generate-docs-structure`: creates the docs folder skeleton (`docs/tutorials|how-to|reference|explanation|adr/`, only for selected types; README/CHANGELOG/CONTRIBUTING at root) and template stub files; never overwrites existing non-stub docs, and writes a manifest (`.pi/senai/docs-structure.json`) that doctor validates against.
- `/senai-doctor` doc checks: filled docs are validated against their template (required sections, in order) and length cap, the docs folder structure is validated against the factory skeleton (missing stubs warn, stray non-stub files are info), and the missing-truth-document warning now lists one item per role with the exact default path to assign.
- Project-wide run lock (`pi-extension/src/lock.ts`): both `/senai-approve` and `/senai-discussion-approve` now acquire a shared lock at `.IDE_Plans/senai/.lock/meta.json` (PID + host + command + startedAt + heartbeatAt + mode). The two commands mutually exclude each other; two concurrent Pi sessions on the same project surface as a clear "Lock busy" error with holder pid/host/command/startedAt/heartbeatAt. The lock heartbeat refreshes every `SENAI_LOCK_HEARTBEAT_MS` (default 5000ms); a holder whose pid is dead or whose heartbeat is older than `SENAI_LOCK_STALE_MS` (default 60000ms) is auto-stolen by the next acquire. `SENAI_LOCK_TIMEOUT_MS` (default 5000ms) controls how long the second call waits before failing. `/senai-discussion-approve` is also now idempotent: a second call on the same already-finalized brief short-circuits with "already finalized" and does not bump the `discussions` counter or append a duplicate event.
- Atomic file writes (`pi-extension/src/atomic-write.ts`): every config and state file the extension owns is now written through a single helper that uses temp-file + fsync + atomic rename, so a crash mid-write never leaves a half-written file. Migrated: `state.json`, the four `.pi/senai/*.json` config files, all architect outputs (profile, report, manifest, generated agents, skills, ADRs, architecture.md, generated manifest), `mission-brief.md` (recordDiscussion + finalize), the per-run mission.md, the docs factory manifest, the doctor report. The session-start hook also removes orphan `.tmp-*` files left behind by a previous crashed session.
- `/senai-doctor` Lock state section: shows the holder (pid, host, command, mode, runId, startedAt, heartbeatAt) and warns when the heartbeat is older than the stale threshold so the user knows the next `/senai-approve` will auto-steal.
- Two new slash commands for single-purpose lock control: `/senai-lock-info` shows the current holder (or reports the lock as free), and `/senai-lock-force` force-takes the lock after a user confirm. `/senai-doctor`'s Lock state section is the diagnostic view; these are the escape hatches when the user just wants to see or clear the lock without running the full audit.
- `session_start` hook is now per-`ctx.cwd` instead of `process.cwd()`: cleanup of orphan `.tmp-*` files, `releaseStaleLockIfHeldByUs`, and the lock-status surface all run against the project's actual working directory. Multi-project workspaces get the right cleanup, and the hook is unit-testable without `process.chdir`.
- Cross-process lock contention test: `lock-contention.test.ts` forks real Node children through `helpers/lock-child.ts` to prove two real OS processes serialize through the lock (the second waits, then succeeds after the first releases) and that a crashed previous holder is auto-stolen after `staleMs`.

### Changed

- Migration completion (Phases 5–8g): the last 3 stragglers at `src/` root moved to their layer folders — `spawn-guard.ts` and `completion-guard.ts` into `hooks/`, `architect-inputs-config.ts` into `architect/inputs-config.ts`. The 2794-line `doctor/index.ts` was split into a 220-line composer + 8 sibling files: `_types.ts` and `_helpers.ts` for the shared type/helper surface, plus 6 `checks-*.ts` groups (runstate, config, agents, architecture, environment, docs) holding the 27 check functions. `runSenaiDiagnostic()` and `formatDiagnosticReport()` stay in `index.ts`; all check functions are still re-exported so existing imports of `../doctor/index.js` keep working. As a side effect, `STAGE_RANK` is now derived from `STAGES` in `core/paths.ts` and re-exported, replacing the local copy that was only used by `checkRunArtifacts`. No behavior change: 1407/1407 unit tests pass throughout. E2E suite: 24 pass, 23 skip (require a real LLM key), 3 fail — `e2e/15-doctor-full-run`, `e2e/16-generator-preview`, `e2e/17-docs-factory` all time out on `type=bash` RPC against the local pi binary. Confirmed pre-existing on the pre-refactor commit (same `pi exited with code 1` from the upstream pi#2461 `text` vs `message` field bug); not a regression from this work.
- Layered source architecture (Phases 3a–4n): `pi-extension/src/` now follows Pi's own layered package model. `commands.ts` (2006 lines) was split into `commands/` — one file per command group (`stage-commands.ts`, `status.ts`, `approve.ts`, `ops.ts`, `configure-*.ts`, `generate-*.ts`, `doctor.ts`, `discussion.ts`) plus `_helpers.ts`, `_shared.ts`, and `_commands-constants.ts`; `commands/index.ts` is now a 60-line composition root. `architect.ts` was split into `architect/{index,drivers,tools}.ts`. Supporting modules moved into `core/`, `io/`, `agents/`, `hooks/`, `ui/`, `implement/`, `docs-factory/`, `doctor/`, and `scouts/`. The temporary `src/commands.ts` and `src/architect.ts` re-export shims were removed once all importers pointed at the new paths, and an architecture-invariants test guards against shim accumulation. No behavior change: 1407/1407 tests pass throughout.
- Generated doc-writer agents (`readme-writer`, `changelog-writer`, `api-docs-writer`, `other-docs-writer`) embed a documentation contract from the catalog — target path, template id, required sections, hard length cap; generator version bumped to v4 so doctor flags stale generated teams for regeneration.
- The Document stage skill now runs the factory flow: skeleton first (`/senai-generate-docs-structure`), then batch-wise template filling (max 4 concurrent writers, batch N+1 waits for batch N), with every task carrying its target path, template id, and length cap.
- `/senai-doctor` setup progress gains an optional step noting `/senai-discussion` as a pre-Plan refinement pass.
- Generated `linter` and `full-test` agents now carry the `write` tool (they write report artifacts); generator version bumped to v3 so doctor flags older generated teams for regeneration. Doctor no longer treats linter/full-test as read-only roles — `write` is now required for them (this reverses the earlier warning about these roles carrying `write`).
- `/senai-approve` now verifies the completed stage's artifacts before advancing: missing or empty artifacts trigger a warn-and-ask confirm instead of silently advancing (a real run reached `delivered` with an empty `document/` folder). Each approval records its outcome (time + artifact check) in `state.json` `stageResults`.
- `/senai-approve` compaction gate now also fires on absolute tokens >= 40% of the context window, so it no longer silently skips when `percent` is null and fires before pi's own auto-compact threshold on large windows.
- Artifact-path placeholders (`<plan>`, `<securityReport>`, `<deliverSummary>`, …) in stage skills are substituted with real run paths when the prompt is built, so approval gates never render literal `<...>` tokens.
- Run-id slugs now strip pasted temp paths and UUID/hex noise before slugging, and a truncated slug never ends in a dash.
- All four stage skills gained an artifact-verification playbook (a "completed" notice is not proof — verify with `test -s` and resume instead of stalling or asking the user), staggered spawns with a 429 resume playbook (wait ~60s, then `subagent_resume`), real-tool-only discipline, the AskUserQuestion 12-char header rule, and an explainer for the subagent pane's "N denied" counter.
- The Plan stage skill now caps plan.md at ~15KB and requires a `## Verification` section; the Deliver stage runs that section as a blocking gate before the security gate and records its outcome in the deliver summary.
- `/senai-doctor` run audit: a delivered run missing deliver artifacts is now an error (was a warning), delivered-with-empty-`document/` and implement-stage files found in `deliver/` are errors, and plan.md over 50KB gets a token-bloat warning.
- Renamed artifact root directory from `.IDE_Plans/senai/` to `.IDE_Plans/pi-senai/` for naming consistency with the project. No auto-migration: existing artifacts stay in the old directory; doctor emits a single warning when the old directory still exists so the user can `mv` or delete it. The single source of truth is `SENAI_DIR` in `pi-extension/src/constants.ts`; all path helpers (`getSenaiDir`, `getRunDir`, `getLockDir`, `getCommunityResearchCacheDir`, etc.) now resolve to the new root.

### Added

- Spawn guard: during an active senai run, a `tool_call` hook now blocks `subagent`/`subagent_resume` calls that omit the `agent` parameter or pass a bare role/built-in name (e.g. `planner`) while that role is mapped to a custom or generated agent. The built-in agent is read-only and can never write the role's artifact, which stalled real runs; the block message names the correct mapped agent so the spawn is retried correctly. The guard steps aside when no run is active, when configs are missing/corrupt, and for non-colliding custom names.
- `/senai-doctor` is stricter: it now warns when roles remap a built-in default name (spawns must use the exact mapped name — the bare name silently loads the read-only built-in), audits the recorded run's artifacts (plan and deliver files must exist and be non-empty once their stage is complete, catching "subagent reported completed but wrote nothing"), and flags runs parked in an active stage with missing artifacts as possibly stuck.

### Changed

- Stage prompts and the plan skill now carry one unified stall playbook: interrupt a stalled subagent once, wait, ask the user to close its pane if it stays alive (no kill tool exists yet in pi-interactive-subagents), then respawn with a unique name — never leave two agents of the same role running. Writer completions must be verified by checking the artifact file exists before spawning the next agent.

### Fixed

- Fixed a Pi TUI crash (`Rendered line ... exceeds terminal width`) when confirm dialogs rendered text wider than the terminal — most visible on first-time `/senai-generate-sub-agents`, whose write-set preview is long. All custom picker/editor components (`simple-picker`, `role-picker`, `list-editor`) now truncate every rendered line to the terminal width via pi-tui's `truncateToWidth`, and multi-line confirm messages are split into separate rendered lines, matching Pi's documented custom-component pattern.

### Changed

- `/senai-generate-sub-agents` now regenerates in place: roles already mapped to their generated agent are regenerate candidates alongside roles on built-in defaults. Overwriting happens only for files the generation manifest proves pi-senai wrote and the user never edited (sha256 match in `.pi/architect/generated-manifest.json`); user-edited files are kept and reported, and a deleted generated file with a surviving mapping is recreated automatically. The confirmation dialog previews the exact write set (create / regenerate / recreate / kept / skipped) before anything is written. Generated agent footers now carry the generator version (`generator v2`).
- `senai_finalize_architecture` stale-artifact cleanup now requires a manifest hash match — the name pattern alone is no longer enough — and reports kept files as `keptStaleArtifacts`. It also preserves sub-agent entries in the generation manifest (merge, not wipe) so re-running the architecture factory no longer disables team-agent drift tracking and regeneration.
- `/senai-doctor`: drift advice is per file type (team agents point to `/senai-generate-sub-agents`); mapped team agents generated by an older pi-senai version get a staleness warning; orphaned generated agents (marker present, no role mapped) are reported as info items.
- Generated sub-agents and architecture agents now declare `session-mode: lineage-only`, `auto-exit: true`, and `spawning: false`, and every artifact-writing role (scout-2/3/4, discussion, plan-overview, security-gate) carries the `write` tool so subagents can finish their deliverables without the parent session taking over. Generated agent bodies also carry a completion contract: the final message is at most 10 lines (outcome + artifact path), never pasted deliverable content.
- Architecture reviewer agents (reviewer-correctness/security/tests) no longer carry the `edit` tool; reviewers report, they do not modify source.
- Stage prompts and skills now enforce spawn discipline: always pass `agent:` with the mapped agent, pass artifact paths instead of pasted content, no polling while waiting, `subagent_resume` before cold respawn, and the parent never does a subagent's job. Removed the stale `isolation: "worktree"` guidance (no such parameter exists in the subagent tool). Plan-stage guidance now uses `lineage-only` for all agents instead of `fork` (which copied the parent's full conversation into each child).
- Long missions (>1000 chars) are stored once as `mission.md` in the run directory; stage prompts carry only a preview plus the file path.

### Added

- Deterministic compaction support: while a senai run is active, a `session_before_compact` hook supplies a zero-LLM summary of the run state (run id, stage, artifact paths) so compaction costs no summarization call and run state survives it. `/senai-approve` now auto-compacts the parent context at stage boundaries when usage is 50% or higher.
- `/senai-doctor` now checks pi retry settings (warns when `retry.enabled` is false), warns when linter/full-test agents carry the `write` tool, and warns when scout-2/3/4 are mapped to planner-style agents.

### Added (earlier)

- Subagent model inheritance guard: every stage prompt's Agent Registry block now carries an explicit rule — never pass the `model` parameter to `subagent()` and never set a model override; subagents must inherit pi's configured default model (the parent session model). This prevents the LLM from freelancing a model (e.g., copying the subagent extension's doc examples) and spawning agents on an unconfigured provider, which left them stuck at the login prompt. `/senai-doctor` agent file integrity now also warns when a mapped agent pins a `model` in its frontmatter, naming the pinned model and explaining the default-model impact.

### Changed

- All one-shot dialogs (files menu, folder browser, truth-document picker, project-type and technology prompts, per-role agent menus, and the four yes/no confirms) now use a shared single-choice picker (`ui/simple-picker.ts`) with the same visual language as the role picker and list editor (border, title, `→` cursor, dim footer). Handlers use stable item ids instead of label matching. Non-TUI fallback behavior is unchanged.
- `/senai-configure-agents` now uses the same role-list flow as the other configure commands instead of the 21-step wizard: one list of all roles with a static Back button (cancel, nothing saved) and Finish (save all), cursor returns to the edited role, esc on the per-role menu changes nothing. Save semantics are unchanged — untouched roles keep their current or suggested agent. The role picker component gained an opt-in `showBack` flag; other commands are unaffected.
- `/senai-configure-files`, `/senai-configure-agents-files`, and `/senai-configure-architect-inputs` list editors now show two clear sections — `✅ Selected (N)` pinned on top and `💡 Suggestions (N)` below — with uniform markers instead of the mixed `Suggest:`/`Remove:` rows. Long paths are middle-truncated with the filename always visible, and the focused row shows its full path in a detail line below the list.
- `/senai-configure-agents-files` now hides the four sequence-orchestrated roles (discussion, planner, code-review, security-gate) — their primary input is stage artifacts and Senai runs them automatically. The picker shows the 7 scout/reviewer roles (`PICKER_ROLES`). Hidden roles stay assignable via `agents_files.json`, and doctor keeps suggesting documents for them.

### Added

- All four `.pi/senai/` config files (`agents.json`, `files.json`, `agents_files.json`, `architect-inputs.json`) now start with a `_comment` field: a one-line plain instruction saying what the file is for and which command manages it. Savers always write it, loaders strip it, so the in-memory shape and validation are unchanged. A removed or edited instruction self-heals on the next save — covered by module-level tests and command-level regeneration tests for all four configure commands.

- `/senai-doctor` now fails on document misassignments: artifact-driven roles (implementer, linter, writers, archive, …) carrying truth/comparison documents, and truth documents that contradict the role's expected document type (e.g., a PRD assigned to the security reviewer). Both are errors with fix hints pointing at `/senai-configure-agents-files`.
- `/senai-doctor` mandate check: for roles the suggestion rules do not cover (`scout-2`, `plan-overview`), the assigned truth document is compared against the agent's mandate (frontmatter description + generator mandate) using document signals (classified type, filename, first heading). A clear contradiction is an error; an assignment with too little signal to judge is reported as unverifiable (warning) instead of passing silently. `scout-3` keeps existence-only checking per user decision.
- `/senai-configure-agents-files` picker rows now show colored guidance tags (`ROLE_GUIDANCE` in `agent-suggestions.ts`): `[design-defined]` (green) for scout-1, `[recommended]` (yellow) for roles that should be configured, `[optional]` (dim) for scout-3.
- `/senai-configure-agents-files` rows now show the plain document type each role needs (e.g., `needs: RTM / traceability document`) and doctor's concrete suggested file for unassigned roles (e.g., `suggested: docs/RTM.md`), so beginners can assign correctly without prior knowledge.

### Fixed

- `doctor.ts` — the setup-progress "Agent documents assigned" step no longer shows done for an empty `agents_files.json`. The step now requires at least one real assignment (truth or reads), so the progress section and the assignment-suggestion warning can no longer contradict each other.

- `doctor.ts` — a corrupted `architect-inputs.json` no longer crashes the whole `/senai-doctor` run; `checkArchitectureSetup` now reports it as an error item with a fix hint, matching the neighboring drivers check.

- `commands.ts` — the truth-document picker's "(clear truth document)" item now actually clears the truth document. It previously returned the same `undefined` as a cancel, so the caller kept the current value; `pickTruthDocument` now returns an explicit set/clear/cancel result.

- All 12 known issues from `Doc/test-plan.md` (found during the edge-case test round):
  - `agent-registry.ts` — empty-string agent mappings now fall back to the default agent name.
  - `agent-generator.ts` — an architect report with all-empty arrays no longer emits a bare `## Project context` header in generated agents.
  - `agent-config.ts` — validation now rejects an `agents` array and non-string mapping values.
  - `agents-files-config.ts` — config versions below 1 are rejected instead of being silently migrated.
  - `architect-tools.ts` — `senai_finalize_architecture` validates `agents.json` before writing any artifacts, eliminating the partial-write crash hazard.
  - `architect.ts` — `autoMapArchitectureAgents` no longer remaps a user's custom agent whose name starts with the project slug; stale detection requires the mapped agent file to be missing from disk.
  - `document-ingest.ts` — `buildIngestBatches` throws on zero, negative, or non-integer batch sizes instead of looping forever.
  - `files-discovery.ts` — uppercase file extensions are classified correctly; `isExcluded` requires a path-segment boundary (`"dist"` no longer excludes `distfoo.ts`); test-path matching is delimiter-aware (`latest/`, `contest.md` no longer match; `foo.test.ts`, `unit-tests/` still do).
  - `files-config.ts` — v1 migration uses the same delimiter-aware test-path check via the shared `looksLikeTestPath` helper.
  - `state.ts` — an invalid `currentStage` is reset to `"none"` on load instead of crashing `advanceStage` later.
  - `driver-extractor.ts` — `findDriverGaps` recognizes `"scalability"` as scale coverage.

### Changed

- Sequence-consistency sweep: all design docs and user-facing hints now match the generate-first setup order.
  - `Doc/architect-sequence.md` no longer lists the three config files as preconditions for `/senai-generate-architect`; `Doc/senai-sequence.md` Rule 10 states the new one-time setup order; `Doc/senai-full-sequence.md` documents that the generate commands create `agents.json`; command lists gained `/senai-configure-architect-inputs` and `/senai-generate-architect`; next-step hints no longer skip `/senai-generate-sub-agents`.
  - Doctor's missing-`agents.json` hint names the generate commands as the primary fix; the architecture-mapping fix hint mentions re-running `/senai-generate-architect` for default/stale roles.
  - Config-missing notifications in stage commands and `/senai-agents` mention the generation path alongside `/senai-configure-agents`.
  - `formatStageStatus` now lists `/senai-approve` (the primary flow command) in the run-status block.

- Setup sequence: generate commands now own `agents.json`.
  - `/senai-generate-architect` and `/senai-generate-sub-agents` no longer require a pre-existing agent configuration. Both create or update `.pi/senai/agents.json` themselves.
  - `senai_finalize_architecture` now auto-maps the seven architecture-bound roles (`scout-1`, `planner`, `implementer`, `reviewer-correctness`, `reviewer-security`, `reviewer-tests`, `code-review`) to the generated agents — roles still on built-in defaults or pointing at stale generated agents for the same project are remapped; other custom mappings are never touched.
  - The role→agent mapping is now a single shared constant (`ARCHITECTURE_AGENT_MAPPING` in `architect.ts`) used by both the factory and doctor, so the writer and the checker can never drift apart.
  - New one-time setup order: `/senai-configure-files` → `/senai-configure-architect-inputs` → `/senai-generate-architect` → `/senai-generate-sub-agents` → `/senai-configure-agents-files` → `/senai-doctor`. `/senai-configure-agents` is now an optional manual override for hand-picking custom agents. Stage commands still require all three config files.
  - Unit tests for the auto-mapping (create, preserve custom, remap stale, no-op) and for running both generate commands without an existing `agents.json`.

### Added

- Document-scope guidance (suggest, don't force).
  - `/senai-doctor` now warns when recommended document-reading roles have no truth document, with concrete per-role suggestions from the new `document-suggestions.ts` module — matched by `architect-inputs.json` document types first, filename keywords second, silence when nothing is confident. Assignments stay optional; the user approves by running `/senai-configure-agents-files`.
  - The `/senai-configure-agents-files` picker now shows only the 11 document-reading roles (`DOCUMENT_ROLES` in `agent-suggestions.ts`). Artifact-driven roles (implementer, linter, writers, archive, …) are hidden to keep the picker clean; the config format and validation still accept every role for advanced hand-editing.
  - New tests: `document-suggestions.test.ts` (11 tests), doctor suggestion scenarios, and a picker visibility test.

- Doctor setup-progress guidance.
  - Every `/senai-doctor` report now opens with a "Setup progress" section: the 7 one-time setup steps marked done or pending, a completed-checks count, and a `Next: run <command>` line naming the exact next command (or "Setup complete — run /senai-plan <mission>").
  - Detection is read-only and mirrors the documented setup order (`/senai-configure-files` → `/senai-configure-architect-inputs` → `/senai-generate-architect` → `/senai-generate-sub-agents` → `/senai-configure-agents-files`). Guidance only — the section never emits errors, so the report's pass/fail verdict is unchanged.
  - 8 new tests cover every step transition, first-position placement, and the no-error guarantee.

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

- Technology resource fetch + doctor technical validation.
  - When no technology resource matches, `/senai-generate-sub-agents` now offers three choices instead of silently using generic: **Fetch from official docs** (recommended) — the agent searches official documentation and distills a real resource file into `.pi/technologies/<tech>.md` following `_template.md` with source URLs cited per section; **Use generic**; **Cancel**.
  - The doctor "Technology resources" section now validates resources technically: template sections (core rules, testing patterns, tooling/limits or common mistakes) are required, at least one official source URL must be cited (the generic resource is exempt), and the resource id must appear in its keywords (separator-insensitive).

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

- Code hygiene cleanup: removed dead code (2 unused constants, an unused UI helper and state class), removed ~36 unused imports across source and tests, made `GENERATED_ROLES` the single source of role tool requirements (doctor derives its capability table from it), and enabled `noUnusedLocals`/`noUnusedParameters` in `tsconfig.json` so dead code fails the build from now on.
- Renamed `/senai-generate-agents` to `/senai-generate-sub-agents` for clarity. The old name is no longer registered.
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

### Added — Testing Discipline (Plan v2.0, Option C phased)

- **Phase 1 — Rules in agents.** `skills/senai-implement.md` gains a `## Testing discipline` block (AAA, equivalence partitioning + boundary value analysis, naming convention, table-driven cases, property-based tests for pure functions, FIRST quality, coverage target, anti-pattern rejection, test-double taxonomy, run discipline, anti-pattern scan) and a stricter `## Approval gate` that requires three signals before prompting the user. `skills/senai-plan.md` `reviewer-tests` expands from a one-liner to an 8-item blocking checklist (Verification section, high-risk areas, input validation, boundaries, test framework named, no contract left untested, property-based tests for pure functions, coverage floor named). Generated `test-skeleton` agent body (in `agent-generator.ts`) carries the discipline into every fresh regeneration. Architecture-generated `implementer`, `reviewer-tests`, and `reviewer-correctness` (which `code-review` re-uses per `ARCHITECTURE_AGENT_MAPPING`) gain `## Testing discipline` / `## Review checklist` / `## Anti-pattern scan` sections respectively.
- **Phase 1.5 — Deterministic scanner.** New `pi-extension/src/test-discipline.ts` defines a `ScanReport` with 8 heuristics (zero-assertion, over-mocking, mirror-logic, flaky-timing, no-AAA, mystery-guest, private-method, god-test) — each a small pure function with severity (blocking / actionable / informational). Mirror-logic uses a paren-aware splitter so `assert(decode(x), decode(x))` fires but `assert(decode(encode(x)), x)` does not. False-positive guards: parametrize tests, hypothesis `@given`, fast-check `fc.assert`, RSpec `it_behaves_like`, and polling-helper wrapping (`pollUntil`, `eventually`, `waitForCondition`) are all explicitly tested to NOT flag. New tool `senai_scan_test_smells` registered in `index.ts` wraps `scanTestFilesOnDisk` for LLM invocation. The scanner is a pure module — no LLM call, deterministic.
- **Phase 2 — Wired approval.** New `pi-extension/src/implement-signals.ts` defines `collectImplementSignals(cwd, state): Promise<ImplementSignals>` which runs three signals before `/senai-approve` advances from `implementing`: (1) the scanner on resolved test paths, (2) coverage from `coverage/coverage-summary.json` if present, (3) mission verification re-run by parsing `<plan>` `## Verification` and executing each step via `bash` (60s timeout each, output capped at 2000 chars). The handler surfaces a multi-line summary after every implement approval. Strict mode is OFF by default; failed required verification steps ALWAYS block, regardless of strict mode. Coverage floor defaults to 80%, override via `SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR` env var.
- **Phase 2 — Doctor rule.** `checkGeneratedAgentContent` in `doctor.ts` now adds a `warning` (informational, not error) when an architecture-bound agent file is missing the discipline section that Plan v2.0 introduced (`implementer` → `## Testing discipline`, `reviewer-tests` → `## Review checklist`, `reviewer-correctness` → `## Anti-pattern scan`). Suppressed when the agent already has structural problems so the user gets one clean error item, not noise. Re-run `/senai-generate-architect` to pick up the new sections.
- **Phase 3 — Operational.** Setting `SENAI_TEST_DISCIPLINE_STRICT=1` promotes blocking findings and below-floor coverage to hard gates; the orchestrator shows a confirm dialog with the specific file:line of each finding. Strict mode is opt-in so teams can validate the heuristics against their codebase before turning it on.
- **Tests.** New `pi-extension/test/test-discipline.test.ts` (~30 cases, including false-positive guards for parametrize, hypothesis, fast-check, RSpec). New `pi-extension/test/implement-signals.test.ts` (~10 cases covering parseVerificationSteps, signalsBlockAdvance, formatImplementSignals). Additions to `pi-extension/test/agent-generator.test.ts` and `pi-extension/test/architect.test.ts` pin the new discipline sections so they cannot silently regress. Net test count: 1338 → 1390 (52 new cases).
- **No new npm dependencies.** The scanner is pure TypeScript with `node:fs` / `node:path` only. Coverage and verification reuse existing bash execution. No changes to `package.json`, `tsconfig.json`, or `state.json` schema.

### Added — Generator Fine-Tune v5

- Every `GeneratedRoleDef` row now carries an `invocationHint` string and an `outOfScope: string[]` array. The two fields render into the generated agent body as: (1) the YAML `description:` frontmatter becomes a true auto-invocation trigger (`"Spawn first in implement stage before the implementer; write failing test stubs. — Test Skeleton for inventory-app. Generated by pi-senai."`) instead of a static label; (2) a new `## Out of scope` section sits between `## Your mandate` and `## Completion contract`, listing the agent's boundaries (e.g. test-skeleton must NOT implement source code; linter must NOT auto-fix findings; full-test must NOT skip tests silently). Closes the two community-norm gaps (trigger description + boundary) found in the research pass — pubnub.com best-practices, Anthropic official sub-agents docs, arXiv 2508.08322 (Context Engineering for Multi-Agent LLM Code Assistants), lst97/claude-code-sub-agents, oh-my-claudecode.
- `GENERATOR_VERSION` bumped from 4 to 5. The existing doctor check in `checkGeneratedTeamContent` automatically flags older v4 files with the existing advice ("Re-run /senai-generate-sub-agents to update it in place") so users see drift immediately and regenerate.
- Net test count: 1393 → 1399 (6 new pinning tests: every role carries invocationHint + outOfScope; test-skeleton specifics; assembled body has `## Out of scope` between mandate and completion contract; description frontmatter contains the invocationHint; GENERATOR_VERSION is 5). All existing tests still pass.
- No new commands. No new npm dependencies. No changes to `package.json`, `tsconfig.json`, or `state.json` schema. Existing tools per role, the 8 anti-patterns, AAA/EP/BVA/coverage rules, the Q3 linter and full-test mandates, the completion contract, and the technology craft sections are unchanged.

### Added — Generator Fine-Tune v6 (Follow-Up)

- Every doc-writer role's `outOfScope` now forbids modifying test files or changing code examples that are exercised by tests. Appended to all four doc-writer rows (`readme-writer`, `changelog-writer`, `api-docs-writer`, `other-docs-writer`). Prevents doc drift from silently breaking the test suite when a writer rewrites a README example that the suite imports or asserts on.
- `skills/senai-document.md` gains a `## Testing discipline` block between Sequence and Approval gate. The orchestrator must run the project's test runner AND call `senai_scan_test_smells` on the doc-writers' batch output paths before presenting the approval gate. "All docs updated" now means: every doc at its target path is non-empty, respects its catalog length cap, AND the test suite is still green.
- `skills/senai-deliver.md` gains a `## Testing discipline` block between Sequence and Approval gate. The orchestrator must re-run `senai_scan_test_smells` on the implement-stage test paths and compare against the implement-stage report. Any **new** blocking finding is drift — it blocks the approval gate and surfaces in the deliver summary. Existing findings the user already approved are not re-surfaced.
- `GENERATOR_VERSION` bumped 5 → 6. The existing doctor check automatically flags v5 files as "generated by an older pi-senai version" with the standard regeneration advice.
- Net tests: 1399 → 1401 (2 new pinning tests: every doc-writer carries the new boundary; non-doc-writers do NOT carry it; GENERATOR_VERSION is 6).
- No new commands. No new npm dependencies. No changes to `package.json`, `tsconfig.json`, or `state.json` schema. The body assembly logic (`buildGeneratedAgentMarkdown`) is unchanged — only the data in `GENERATED_ROLES` got one new entry per doc-writer row.

### Added — Doctor Testing-Discipline Sections

- `/senai-doctor` gains two new sections:
  - **Testing discipline** (6 items): strict-mode status, coverage floor, test-paths-configured (warns when empty), scanner module compiled (checks for `dist/pi-extension/src/test-discipline.js`), stage skills carry the discipline block (checks all three: implement, document, deliver), generated agents on the latest version. All items are info or warning — never error — because the discipline is opt-in.
  - **Sub-agent generator completeness** (2 items): every `GENERATED_ROLES` row has the v5 fields `invocationHint` + `outOfScope`, and the agent version distribution count. Catches future code regressions where a role is added without the new fields.
- Net tests: 1401 → 1405 (4 new pinning tests for the new sections). All existing 1401 tests still pass.
- No new commands. No new npm dependencies. Doctor remains read-only — does not run the scanner, does not read coverage-summary.json, does not depend on run-state structure.

### Docs — Testing Discipline

- `README.md` gains a `## Testing discipline` section listing the 8 anti-patterns, the `senai_scan_test_smells` tool, the `SENAI_TEST_DISCIPLINE_STRICT` and `SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR` env vars, and the 9 places the discipline shows up (skills, generated agents, architecture-bound agents, doctor).
- `AGENTS.md` design principle 8 documents the deterministic scanner, the strict-mode opt-in, the coverage floor, and the `GENERATOR_VERSION` constant.
- `Doc/senai-full-sequence.md` Stage 2 (Implement) gains a `### Testing discipline` subsection listing the rules, the 8 anti-patterns with severities, and the strict-mode behavior.
- `Doc/senai-sequence.md` Stage 2 gains a one-paragraph summary of the discipline.
- `Doc/step-by-step-guide.md` gains a "Setting up the testing discipline" subsection showing the env vars and what the new `/senai-doctor` sections report.
- No code or test changes in this commit.

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

### Changed (architecture upgrade)

- **Internal:** `pi-extension/src/` reorganized into a layered folder structure matching Pi's own `packages/ai → agent-core → coding-agent` model. No public API change; 25 slash commands unchanged; all artifact paths and config schemas unchanged.
- `core/` — domain layer (paths, state, mission-brief, compaction-summary)
- `io/` — I/O helpers (atomic-write, lock, migrate)
- `hooks/` — one file per Pi lifecycle hook (session-start, session-before-compact, tool-call, input, before-agent-start)
- `agents/` — sub-agent management (discovery, config, generator, files-config, etc.)
- `architect/` — architecture factory (tools, drivers, inputs-config)
- `doctor/` — diagnostic (kept monolithic for now; incremental split is future work)
- `docs-factory/` — document factory (catalog, selection, ingest)
- `implement/` — implement stage (signals, discipline, cadence)
- Tests reorganized under `test/` to mirror `src/`. 2342/2342 tests pass.
- `commands.ts` (2365 lines) and `architect.ts` (1150 lines) deliberately left as single files; their cross-cutting dependencies make one-shot splitting unsafe (see `.IDE_Plans/architecture_refactor_plan_20260905_1052_v1.0.md`).
