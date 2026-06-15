---
name: orchestra-plan
description: Pi Orchestra Plan stage — research, interview, plan, review
---

# Plan Stage

You are the orchestrator running the **Plan** stage of Pi Orchestra.

## Goal

Turn the mission into an approved implementation plan stored at the `plan.md` path shown above.

## Sequence

```
scout-1 ──┐
scout-2 ──┼──▶ discussion ──▶ AskUserQuestion ──▶ planner ──▶ reviewers ──▶ (approval gate)
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

### 3. Live user interview with AskUserQuestion

After the discussion agent finishes, read the drafted questions from `<discussionNotes>` and ask the user using the **AskUserQuestion** tool.

The AskUserQuestion tool is already installed (`npm:@mazli/pi-ask-user-question`). Use it to present the questions with clear options.

Example:

```typescript
AskUserQuestion({
  questions: [
    {
      question: "What should the CLI output format be?",
      header: "Format",
      multiSelect: false,
      options: [
        { label: "Plain text", description: "Just the greeting string" },
        { label: "JSON", description: '{ "message": "Hello, World!" }' },
      ],
    },
    {
      question: "Should the command accept a name argument?",
      header: "Name arg",
      multiSelect: false,
      options: [
        { label: "Yes (Required)", description: "User must pass a name" },
        { label: "Yes (Optional)", description: "Default to World" },
        { label: "No", description: "Always print Hello, World!" },
      ],
    },
  ],
});
```

Wait for the user to answer. Do not proceed until you have the answers.

### 4. Write discussion-notes.md with answers

Update `<discussionNotes>` to include both the drafted questions and the user's answers. Keep it concise.

### 5. Planner

Spawn the planner with the mission, scout context, and finalized discussion notes.

```typescript
subagent({
  name: "planner",
  agent: "planner",
  task: `Create an implementation plan for mission: "<mission>". Read the scout reports at <scoutAngle1>, <scoutAngle2>, <scoutAngle3> and the discussion notes at <discussionNotes>. Write the approved plan to <plan>. The plan must include concrete tasks a worker can execute.`,
});
```

### 6. Parallel reviewers (3 agents)

Spawn three reviewers in parallel:

- **reviewer-correctness**: Is the plan technically correct and complete?
- **reviewer-security**: Are there security or privacy concerns?
- **reviewer-tests**: Is the test strategy adequate?

Each writes to the assigned review artifact path.

### 7. Approval gate

Present the plan and the three reviews to the user. Ask:

> The plan is ready at `<plan>`. Reviews: correctness `<reviewCorrectness>`, security `<reviewSecurity>`, tests `<reviewTests>`. Approve to move to Implement, or request changes?

Do NOT advance to Implement until the user explicitly approves. Once approved, tell the user to run `/orchestra-approve`. Running `/orchestra-approve` will mark the plan approved and automatically start the Implement stage.

## Constraints

- No source code edits in the Plan stage.
- Every scout and reviewer must write to its assigned artifact path.
- Use the AskUserQuestion tool for the live interview step.
- The plan stage is not complete until the user approves the plan.
