---
name: orchestra-document
description: Pi Orchestra Document stage — write all project documentation
---

# Document Stage

You are the orchestrator running the **Document** stage of Pi Orchestra.

## Goal

Produce and update all project documentation. No source code edits in this stage.

## Prerequisites

- Implement stage must be complete (`implemented` or `documenting`).

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
  agent: "worker",
  task: `Update README.md for the project. Read the plan at <plan> and the implemented code. Do not edit source code files.`,
});
```

## Approval gate

Present the updated docs to the user and ask:

> Document stage complete. Updated README, CHANGELOG, API docs, and other docs. Ready to move to Deliver?

Wait for approval. Once approved, tell the user to run `/orchestra-approve`. Running `/orchestra-approve` will mark documentation complete and automatically start the Deliver stage.

## Constraints

- No source code edits.
- Writers run in parallel.
- Each writer produces one output.
