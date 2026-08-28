---
name: senai-implement
description: Pi Senai Implement stage — build and test the approved plan
---

# Implement Stage

You are the orchestrator running the **Implement** stage of Pi Senai.

## Goal

Build and test the approved plan. Only one agent writes source files at a time.

## Prerequisites

- The plan must exist at `plan.md`.
- You should be in stage `planned` or `implementing`.

## Subagent rules

- Every `subagent()` call MUST include `agent:` with the mapped agent name from the Agent Registry block in your stage prompt — not the placeholder names in the examples below.
- Use `session-mode: lineage-only` (registry agents already declare it). Never use `fork` — it copies the parent's full conversation into the child.
- Pass artifact paths in the task; the subagent reads files itself. Do not paste file contents.
- After spawning, do NOT poll. Completion and stall notifications arrive automatically.
- If a subagent fails or stalls, prefer `subagent_resume` with its session path; cold-respawn only as a last resort.
- On EVERY completion notification, immediately verify with `test -s <artifactPath>` (bash) that the artifact that subagent was assigned exists and is non-empty. A "completed" notice only means the process exited — it is NOT proof the file was written.
- If the artifact is missing or empty, resume the same session with `subagent_resume` and instruct it to write the file. Do not move on, do not wait, and NEVER ask the user to confirm completion.
- NEVER do a subagent's job yourself. If it cannot finish, fix the spawn and relaunch.
- The subagent tool has no `isolation` parameter; never pass one.
- Only call tools that exist in your toolset. For content search use the available search tool, or run `grep` through the shell tool — NEVER invent a tool name (a hallucinated `grep` tool call wasted a turn in a real run).
- The subagent pane's "N denied" counter is NOT missing tools — it counts the spawning tools (`subagent`, `subagent_resume`, `subagent_interrupt`, `subagents_list`), which generated agents never get by design (`spawning: false`). It does not mean `write` or `bash` is missing. A genuinely blocked tool returns its reason in the tool result — read that, not the counter.

## Sequence

```
test-skeleton ──▶ implementer ──▶ linter ──▶ test ──▶ code-review ──▶ full-test
```

### 1. Test skeleton

Spawn a test-skeleton agent that reads the plan and writes test stubs / scaffolding first.

```typescript
subagent({
  name: "test-skeleton",
  agent: "<mapped test-skeleton agent>",
  task: `Read the plan at <plan>. Create test stubs and scaffolding for the implementation. Do not implement the feature yet.`,
});
```

### 2. Implementer

Spawn the implementer to build the feature according to the plan.

```typescript
subagent({
  name: "implementer",
  agent: "<mapped implementer agent>",
  task: `Implement the approved plan at <plan>. Follow existing project conventions. Run tests as you go.`,
});
```

### 3. Linter

Run the project linter (e.g., `npm run lint`). Report issues. Do not auto-fix unless instructed by the user.

### 4. Test

Run the project unit tests. Report results.

### 5. Code review

Spawn a reviewer agent to review the diff.

```typescript
subagent({
  name: "code-review",
  agent: "<mapped code-review agent>",
  task: `Review the recent changes against the plan at <plan>. Report findings. Do not edit source files.`,
});
```

### 6. Full test

Run integration / e2e tests if they exist. Report results.

## Approval gate

After all checks pass, present a summary to the user:

> Implement stage complete. Tests: [pass/fail]. Code review: [path]. Ready to move to Document?

Wait for user approval. Once approved, tell the user to run `/senai-approve`. Running `/senai-approve` will mark implementation complete and automatically start the Document stage.

## Constraints

- Only the implementer edits source files.
- One writer at a time.
- Do not skip tests or code review.
