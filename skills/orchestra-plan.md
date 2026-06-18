---
name: orchestra-plan
description: Pi Orchestra Plan stage — research, interview, plan, review
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

## Subagent conventions

Use the `Agent` tool (provided by `pi-interactive-subagents`) with pi.dev best practices:

- **Context mode** — Use `inherit_context: false` (`spawn`) for scouts and reviewers so they get a clean session with only the task you provide. Use `inherit_context: true` (`fork`) for the discussion agent, planner, and plan-overview writer so they can see the codebase and earlier reports.
- **Max turns** — Set a hard `max_turns` cap on every subagent to avoid runaway exploration and keep the Plan stage within budget. Use the caps below unless the mission explicitly requires deeper research:
  - **Scouts:** `max_turns: 15` — read-only reconnaissance; respawn with a narrower task if a report is incomplete.
  - **Discussion agent:** `max_turns: 15` — reads four scout reports and drafts questions.
  - **Planner:** `max_turns: 25` — reads all context and writes the concrete plan.
  - **Plan-overview writer:** `max_turns: 15` — reads the plan and writes the summary.
  - **Reviewers:** `max_turns: 15` each — reads the plan and writes the review.
- **Explicit output** — Every writer subagent must be told exactly which artifact path to write (`<scoutAngle1>`, `<plan>`, `<reviewCorrectness>`, etc.).
- **Review loops** — If a reviewer reports a blocking issue, do not restart the whole Plan stage. Instead:
  1. **Plan-level issue** (unclear task, missing step, wrong approach) → respawn the **planner** with the reviewer feedback.
  2. **Context issue** (wrong assumption, missing dependency, stale code info) → respawn the relevant **scout** first, then the **planner**.
  3. Re-run only the affected reviewers after the fix.
  4. Go back to `AskUserQuestion` only if the issue reveals a requirement only the user can answer.
- **Worktree isolation** — Parallel writers that edit source files should use `isolation: "worktree"`. Plan-stage scouts are read-only, so no worktree is needed here.

## 1. Parallel scouts

Spawn four scouts in parallel. Each must write its own report.

- **scout-1** (agent `scout`): Architecture / big-picture reconnaissance for mission `"<mission>"`. Write to `<scoutAngle1>`.
- **scout-2** (agent `scout`): Target-area deep-dive. Write to `<scoutAngle2>`.
- **scout-3** (agent `scout`): Risk / dependency audit. Write to `<scoutAngle3>`.
- **scout-4** (agent `scout`): Requirements / documentation audit. Read customer documents such as PRD, RTM, development order, and atomic-function specs. Summarize requirements, acceptance criteria, constraints, and open questions. Write to `<scoutAngle4>`.

Wait for all four to finish, then read the reports. If any report is missing, respawn that scout.

## 2. Discussion agent

Spawn one discussion agent (agent `planner`) that reads the four scout reports and drafts 2-5 clarifying questions for the user about `"<mission>"`. Write questions and a brief analysis to `<discussionNotes>`.

## 3. AskUserQuestion

Read `<discussionNotes>` and ask the drafted questions using the **AskUserQuestion** tool. Wait for the answers. Do not proceed until the user answers.

## 4. Update discussion notes

Append the user's answers to `<discussionNotes>`.

## 5. Planner

Spawn the planner (agent `planner`) with the mission, the four scout reports, and `<discussionNotes>`. Write the implementation plan to `<plan>`. The plan must contain concrete, executable tasks.

## 6. Plan overview writer

Spawn the plan-overview writer (agent `planner`) to read `<plan>` and `<discussionNotes>` and write a user-friendly summary to `<planOverview>`.

## 7. Parallel reviewers

Spawn three reviewers in parallel. Each writes to its assigned path.

- **reviewer-correctness** → `<reviewCorrectness>`: Is the plan technically correct and complete?
- **reviewer-security** → `<reviewSecurity>`: Security and privacy concerns?
- **reviewer-tests** → `<reviewTests>`: Is the test strategy adequate?

## 8. Approval gate

Present the plan, overview, and reviews to the user:

> Plan: `<plan>`. Overview: `<planOverview>`. Reviews: correctness `<reviewCorrectness>`, security `<reviewSecurity>`, tests `<reviewTests>`. Approve to move to Implement?

Do NOT start Implement until the user approves. Once approved, tell the user to run `/orchestra-approve`, which will mark the plan approved and automatically start the Implement stage.
