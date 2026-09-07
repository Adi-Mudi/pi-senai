---
name: pi-extension-compactor
domain: pi-extension
team-size: any
complexity: medium
best-for-drivers:
  - custom compaction
  - session summary
  - context pruning
  - memory checkpoint
  - branch summarization
  - long sessions
  - token budget control
not-for-drivers:
  - short sessions
  - default compaction sufficient
  - no custom summary needed
  - stateless extension
source: official-pi-pattern
---

# Pi Extension — Compactor

A Pi extension that customizes the compaction flow by handling `session_before_compact` and `session_compact` events with deterministic run-state payloads.

## When to use

- The extension owns state that must survive compaction.
- Default compaction summaries lose critical context.
- The extension wants zero-cost compaction (no LLM call).
- Per-branch summaries need custom instructions.

## When not to use

- Default compaction already preserves enough context.
- The extension has no state worth summarizing.
- The summary would itself require an expensive LLM call.

## Core rules

1. Subscribe to `session_before_compact`; return `{ compaction: {...} }` to provide a custom summary.
2. Make summaries deterministic — compute from current state, not from LLM re-reading messages.
3. Include the run id, stage, artifact paths, and lock state in the summary.
4. Never read the full session history inside the handler; use `ctx.sessionManager` carefully.
5. Return `{ cancel: true }` only when the user explicitly opts out.
6. Document the summary schema so `session_compact` handlers can rehydrate.

## Typical structure

```
src/
├── index.ts              # registers session_before_compact + session_compact
├── summary.ts            # build deterministic summary from run state
├── rehydrate.ts          # restore state from summary on session_compact
└── schemas.ts            # summary payload type
```

## Common pitfalls

- **LLM call in handler** — turns cheap compaction into an expensive one.
- **State loss** — summary omits critical fields.
- **No rehydrate** — `session_compact` handler missing, state lost on next compaction.
- **Schema drift** — old summaries can't be parsed by new handlers.
- **Race with locks** — compaction runs while a command holds the run lock.