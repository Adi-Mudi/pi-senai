---
name: orchestra-plan
description: Pi Orchestra Plan stage — research, interview, plan, review
---

# Plan Stage

Turn the mission into an approved implementation plan at `<plan>`.

## Sequence

```
scout-1, scout-2, scout-3 (parallel) → discussion → AskUserQuestion → planner → plan-overview → reviewer-correctness, reviewer-security, reviewer-tests (parallel) → approval gate
```

**Critical rules:**
- Spawn fresh scouts every run. Do NOT reuse or read scout reports from any previous run folder.
- Do not edit source files in this stage.
- Do not wait for user input except at the AskUserQuestion step and the final approval gate.

## 1. Parallel scouts

Spawn three scouts in parallel. Each must write its own report.

- **scout-1** (agent `scout`): Architecture / big-picture reconnaissance for mission `"<mission>"`. Write to `<scoutAngle1>`.
- **scout-2** (agent `scout`): Target-area deep-dive. Write to `<scoutAngle2>`.
- **scout-3** (agent `scout`): Risk / dependency audit. Write to `<scoutAngle3>`.

Wait for all three to finish, then read the reports. If any report is missing, respawn that scout.

## 2. Discussion agent

Spawn one discussion agent (agent `planner`) that reads the three scout reports and drafts 2-5 clarifying questions for the user about `"<mission>"`. Write questions and a brief analysis to `<discussionNotes>`.

## 3. AskUserQuestion

Read `<discussionNotes>` and ask the drafted questions using the **AskUserQuestion** tool. Wait for the answers. Do not proceed until the user answers.

## 4. Update discussion notes

Append the user's answers to `<discussionNotes>`.

## 5. Planner

Spawn the planner (agent `planner`) with the mission, scout reports, and `<discussionNotes>`. Write the implementation plan to `<plan>`. The plan must contain concrete, executable tasks.

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
