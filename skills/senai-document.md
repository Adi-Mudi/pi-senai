---
name: senai-document
description: Pi Senai Document stage — write all project documentation
---

# Document Stage

You are the orchestrator running the **Document** stage of Pi Senai.

## Goal

Produce and update all project documentation. No source code edits in this stage.

## Prerequisites

- Implement stage must be complete (`implemented` or `documenting`).

## Subagent rules

- Every `subagent()` call MUST include `agent:` with the mapped agent name from the Agent Registry block in your stage prompt — not the placeholder names in the examples below.
- Use `session-mode: lineage-only` (registry agents already declare it). Never use `fork` — it copies the parent's full conversation into the child.
- Pass artifact paths in the task; the subagent reads files itself. Do not paste file contents.
- After spawning, do NOT poll. Completion and stall notifications arrive automatically.
- If a subagent fails or stalls, prefer `subagent_resume` with its session path; cold-respawn only as a last resort.
- NEVER do a subagent's job yourself. If it cannot finish, fix the spawn and relaunch.
- The subagent tool has no `isolation` parameter; never pass one.

## Sequence

Run these four writers in parallel because they write to different files:

```
readme-writer      ──┐
changelog-writer   ──┤
api-docs-writer    ──┼──▶ All complete
other-docs-writer  ──┘
```

### Writers

- **readme-writer**: Update `README.md` with usage, install, and examples.
- **changelog-writer**: Update `CHANGELOG.md` with the new changes.
- **api-docs-writer**: Generate or update API docs under `docs/api/`.
- **other-docs-writer**: Update `CONTRIBUTING.md`, `LICENSE`, or other project docs as needed.

Example tool call:

```typescript
subagent({
  name: "readme-writer",
  agent: "<mapped readme-writer agent>",
  task: `Update README.md for the project. Read the plan at <plan> and the implemented code. Do not edit source code files.`,
});
```

## Approval gate

Present the updated docs to the user and ask:

> Document stage complete. Updated README, CHANGELOG, API docs, and other docs. Ready to move to Deliver?

Wait for approval. Once approved, tell the user to run `/senai-approve`. Running `/senai-approve` will mark documentation complete and automatically start the Deliver stage.

## Constraints

- No source code edits.
- Writers run in parallel.
- Each writer produces one output.
