---
name: orchestra-plan
description: Pi Orchestra Plan stage — research, interview, plan, review
---

# Plan Stage

You are the orchestrator running the **Plan** stage of Pi Orchestra.

## Goal

Turn the mission into an approved implementation plan stored at the `plan.md` path shown above.

## Sequence

Run these steps in order. Use the `subagent` tool for each agent. Wait for each agent to finish before moving to the next step that depends on it.

```
scout-1 ──┐
scout-2 ──┼──▶ discussion ──▶ planner ──▶ reviewers ──▶ (approval gate)
scout-3 ──┘
```

### 1. Parallel scouts (3 agents)

Spawn three scouts in parallel with different angles. Each scout writes to its assigned artifact path.

- **scout-1**: Architecture / big-picture reconnaissance. What exists, tech stack, conventions.
- **scout-2**: Target area deep-dive. Find the exact files and patterns the mission will touch.
- **scout-3**: Risk / dependency audit. What could break, what integrations matter.

Example tool call:

```typescript
subagent({
  name: "scout-1",
  agent: "scout",
  task: `You are scout-1 for mission: "<mission>". Do architecture reconnaissance. Write findings to <scoutAngle1>. Do not edit source files.`,
});
```

Wait for all three scouts to report results.

### 2. Discussion

Spawn a discussion agent that reads all three scout reports and drafts 2-5 focused clarifying questions for the user.

```typescript
subagent({
  name: "discussion",
  agent: "planner",
  task: `Read <scoutAngle1>, <scoutAngle2>, and <scoutAngle3>. Draft 2-5 focused clarifying questions for the user about mission: "<mission>". Write the questions and your own brief analysis to <discussionNotes>. Do not edit source files.`,
});
```

After the discussion agent finishes, ask the user those questions. Wait for answers.

### 3. Planner

Spawn the planner with the mission, scout context, discussion notes, and user answers.

```typescript
subagent({
  name: "planner",
  agent: "planner",
  task: `Create an implementation plan for mission: "<mission>". Read the scout reports at <scoutAngle1>, <scoutAngle2>, <scoutAngle3> and the discussion notes at <discussionNotes>. Write the approved plan to <plan>. The plan must include concrete tasks a worker can execute.`,
});
```

### 4. Parallel reviewers (3 agents)

Spawn three reviewers in parallel:

- **reviewer-correctness**: Is the plan technically correct and complete?
- **reviewer-security**: Are there security or privacy concerns?
- **reviewer-tests**: Is the test strategy adequate?

Each writes to the assigned review artifact path.

### 5. Approval gate

Present the plan and the three reviews to the user. Ask:

> The plan is ready at `<plan>`. Reviews: correctness `<reviewCorrectness>`, security `<reviewSecurity>`, tests `<reviewTests>`. Approve to move to Implement, or request changes?

Do NOT advance to Implement until the user explicitly approves. Once approved, update state to `planned` by telling the user to run `/orchestra-implement`.

## Constraints

- No source code edits in the Plan stage.
- Every scout and reviewer must write to its assigned artifact path.
- The plan stage is not complete until the user approves the plan.
