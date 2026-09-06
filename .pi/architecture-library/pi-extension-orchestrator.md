---
name: pi-extension-orchestrator
domain: pi-extension
team-size: small-to-medium
complexity: medium
best-for-drivers:
  - stage gated workflow
  - multi phase process
  - user approval gates
  - prompt injection
  - state machine
  - plan implement document deliver
  - workflow orchestration
  - soft approval
not-for-drivers:
  - single shot tool
  - stateless utility
  - pure read only extension
  - no user interaction
source: official-pi-pattern
---

# Pi Extension — Orchestrator

A Pi extension that drives a multi-stage user-facing workflow by injecting stage prompts at lifecycle events, persisting state, and gating transitions on user approval.

## When to use

- The user-facing flow has clearly defined stages (plan → implement → document → deliver).
- Each stage produces artifacts that the next stage consumes.
- User approval is required between stages.
- The extension owns the state schema and lifecycle.
- Subagents do the work, the extension coordinates.

## When not to use

- The work is a single tool call.
- There is no concept of approval or progression.
- State can be inferred from the project filesystem.
- The extension only adds a tool or theme.

## Core rules

1. Define a stage enum and a `STAGE_TRANSITIONS` map; never mutate `currentStage` outside `advanceStage()`.
2. Persist state through `atomicWriteJson`; load with a schema validator.
3. Use one Pi lifecycle event per side effect (session_start, before_agent_start, tool_call).
4. Register every command as a separate file under `commands/`; keep handlers thin.
5. Inject stage prompts via `pi.sendUserMessage(...)` wrapped in `<pi-senai-{stage}>` markers.
6. Gate stage transitions on artifact existence checks; missing artifact → warn-and-ask, never silent advance.
7. Use an advisory run lock to prevent races between commands.
8. Keep all run artifacts under `.IDE_Plans/<ext>/runs/<run-id>/`.
9. Expose a doctor command that audits the full setup.
10. Document the public sequence in `Doc/<ext>-sequence.md`.

## Typical structure

```
src/
├── index.ts              # composition root
├── commands/             # one file per command group
│   ├── approve.ts
│   ├── stage-commands.ts
│   └── status.ts
├── core/                 # pure domain (state schema, paths)
│   ├── state.ts
│   └── paths.ts
├── io/                   # atomic write + lock + migrate
│   ├── atomic-write.ts
│   ├── lock.ts
│   └── migrate.ts
├── hooks/                # one file per lifecycle event
│   ├── session-start.ts
│   ├── before-agent-start.ts
│   └── tool-call.ts
└── doctor/               # diagnostic checks
    ├── index.ts
    └── checks-*.ts
```

## Common pitfalls

- **State without lock** — two commands racing on state.json produce a torn write.
- **Silent advance** — advancing stages without artifact check hides failures.
- **Layer bypass** — commands calling `fs.writeFileSync` directly instead of `io/atomic-write.ts`.
- **Hidden coupling** — one command importing from another command's internals.
- **Missing migrate** — schema changes break old state files.

## Reference implementations

- `pi-senai` — stage-gated orchestration with brainstorm, plan, implement, document, deliver.