---
name: senai-plan
description: Pi Senai Plan stage — research, interview, plan, review
---

# Plan Stage

Turn the mission into an approved implementation plan at `<plan>`.

## Sequence

```
scout-1, scout-2, scout-3, scout-4 (parallel) → discussion → AskUserQuestion → planner → plan-overview → reviewer-correctness, reviewer-security, reviewer-tests (parallel) → approval gate
```

**Critical rules:**
- Spawn fresh scouts every run. Do NOT reuse or read scout reports from any previous run folder.
- Do not edit source files in this stage.
- Do not wait for user input except at the AskUserQuestion step and the final approval gate.
- The extension requires valid `.pi/senai/agents.json`, `.pi/senai/files.json`, and `.pi/senai/agents_files.json` before this command runs; if any are missing, tell the user to run the matching `/senai-configure-*` command.

## Subagent conventions

Use the `subagent` tool (provided by `pi-interactive-subagents`) with pi.dev best practices:

- **Context mode** — Use `session-mode: standalone` or `lineage-only` (`spawn`) for scouts and reviewers so they get a clean session with only the task you provide. Use `session-mode: fork` for the discussion agent, planner, and plan-overview writer so they can see the codebase and earlier reports.
- **Autonomous completion** — Scouts, reviewers, the planner, and the plan-overview writer should be autonomous agents. Prefer custom agent definitions with `auto-exit: true` (or explicitly tell the agent to finish and exit after writing its output) so the pane closes automatically and the main session receives a completion notification.
- **Turn / runaway guard** — If your subagent extension supports `max_turns`, set a hard cap:
  - **Scouts:** `15`
  - **Discussion agent:** `15`
  - **Planner:** `25`
  - **Plan-overview writer:** `15`
  - **Reviewers:** `15` each
  With `pi-interactive-subagents`, rely on `auto-exit: true` and `subagent_interrupt` for runaway or stalled agents instead.
- **Explicit output** — Every writer subagent must be told exactly which artifact path to write (`<scoutAngle1>`, `<plan>`, `<reviewCorrectness>`, etc.).
- **Review loops** — If a reviewer reports a blocking issue, do not restart the whole Plan stage. Instead:
  1. **Plan-level issue** (unclear task, missing step, wrong approach) → respawn the **planner** with the reviewer feedback.
  2. **Context issue** (wrong assumption, missing dependency, stale code info) → respawn the relevant **scout** first, then the **planner**.
  3. Re-run only the affected reviewers after the fix.
  4. Go back to `AskUserQuestion` only if the issue reveals a requirement only the user can answer.
- **Worktree isolation** — Parallel writers that edit source files should use `isolation: "worktree"`. Plan-stage scouts are read-only, so no worktree is needed here.

## Synchronization and checkpoint rules

`pi-interactive-subagents` runs each subagent asynchronously in its own multiplexer pane. The `subagent()` call returns immediately and the agent works in the background; a completion notification is steered back to the main session when the agent finishes. To avoid duplicate spawns and premature approval gates:

1. **Use unique names for every parallel subagent** so you can identify each one in the live subagent widget.
2. **Wait for all completion notifications before proceeding.** After launching parallel agents, do not continue until each one has reported back. Do not assume an agent failed just because its output file is not yet present.
3. **If an expected file is missing, check the live widget first.**
   - If the agent is still shown as `starting`/`active`/`waiting`, wait.
   - If the agent is `stalled`, or you received a failure / `caller_ping`, interrupt it with `subagent_interrupt({ name: "<name>" })` and then respawn it.
   - Only respawn after confirming the original run is no longer healthy.
4. **Strict checkpoints:**
   - Do not start the discussion agent until **all four** `scout-angle_*.md` files exist.
   - Do not start the planner until `<discussionNotes>` includes the user’s answers and all four scout files exist.
   - Do not start the reviewers until `<plan>` and `<planOverview>` exist.
   - Do not present the approval gate until `reviewCorrectness`, `reviewSecurity`, and `reviewTests` all exist and the live subagent widget shows no Plan-stage reviewers are still running.

## 1. Parallel scouts

Spawn four scouts in parallel. Each must write its own report.

- **scout-1** (agent `scout`): Architecture / big-picture reconnaissance for mission `"<mission>"`. Write to `<scoutAngle1>`.
- **scout-2** (agent `scout`): Coder Search. Write to `<scoutAngle2>`.
- **scout-3** (agent `scout`): Code Risk / dependency audit. Write to `<scoutAngle3>`.
- **scout-4** (agent `scout`): PRD / documentation audit. Read customer documents such as PRD, RTM, development order, and atomic-function specs. Summarize requirements, acceptance criteria, constraints, and open questions. Write to `<scoutAngle4>`.

Wait for all four to finish, then read the reports. If a report is missing, check the live subagent widget first; only respawn if the agent is stalled or has failed.

## 2. Discussion agent

Spawn one discussion agent (agent `planner`) that reads the four scout reports and drafts 2-5 clarifying questions for the user about `"<mission>"`. Write questions and a brief analysis to `<discussionNotes>`.

## 3. AskUserQuestion

Read `<discussionNotes>` and ask the drafted questions using the **AskUserQuestion** tool. Wait for the answers. Do not proceed until the user answers.

## 4. Update discussion notes

Append the user's answers to `<discussionNotes>`.

## 5. Planner

**Checkpoint:** Confirm all four scout reports and `<discussionNotes>` (including user answers) exist before spawning the planner.

Spawn the planner (agent `planner`) with the mission, the four scout reports, and `<discussionNotes>`. Write the implementation plan to `<plan>`. The plan must contain concrete, executable tasks.

## 6. Plan overview writer

Spawn the plan-overview writer (agent `planner`) to read `<plan>` and `<discussionNotes>` and write a user-friendly summary to `<planOverview>`.

## 7. Parallel reviewers

Spawn three reviewers in parallel. Each writes to its assigned path. Wait for all three to finish and confirm their files exist before the approval gate.

- **reviewer-correctness** → `<reviewCorrectness>`: Is the plan technically correct and complete?
- **reviewer-security** → `<reviewSecurity>`: Security and privacy concerns?
- **reviewer-tests** → `<reviewTests>`: Is the test strategy adequate?

## 8. Approval gate

**Checkpoint:** Confirm `reviewCorrectness`, `reviewSecurity`, and `reviewTests` exist and that no reviewer subagent is still running before presenting the approval gate.

Present the plan, overview, and reviews to the user:

> Plan: `<plan>`. Overview: `<planOverview>`. Reviews: correctness `<reviewCorrectness>`, security `<reviewSecurity>`, tests `<reviewTests>`. Approve to move to Implement?

Do NOT start Implement until the user approves. Once approved, tell the user to run `/senai-approve`, which will mark the plan approved and automatically start the Implement stage.
