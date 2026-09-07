---
name: pi-extension-subagent-delegator
domain: pi-extension
team-size: small-to-medium
complexity: medium
best-for-drivers:
  - subagent delegation
  - async work distribution
  - parallel fan out
  - lineage tracking
  - artifact verification
  - context isolation
  - pi interactive subagents
not-for-drivers:
  - synchronous tool
  - single process work
  - shared memory needed
  - no subagent isolation
source: official-pi-pattern
---

# Pi Extension — Subagent Delegator

A Pi extension that delegates work to subagents spawned via the `subagent` tool, tracks lineage, and verifies the artifact each subagent produces.

## When to use

- Work can be split into independent parallel tasks.
- Each task should run in an isolated session.
- The parent should not poll subagent progress.
- Artifacts must be present and non-empty after each subagent finishes.

## When not to use

- The work is small and sequential.
- Subagents would just call the parent back.
- Artifacts cannot be defined up front.

## Core rules

1. Always pass the exact artifact path in the task description; subagents must write to a fixed path.
2. Verify artifact existence + non-empty content after each subagent finishes.
3. Use `SubagentStop` (or equivalent) to gate on artifact verification.
4. Track lineage: parent agent name → child agent name → artifact path.
5. Bound parallelism (e.g. max 4 concurrent subagents) to avoid rate limits.
6. Never block the parent waiting for subagent output — return control immediately.
7. On missing artifact, send a resume instruction to the same subagent instead of spawning a new one.
8. Do not duplicate the subagent engine — use the `subagent` tool provided by `pi-interactive-subagents`.

## Typical structure

```
src/
├── index.ts              # registers subagent-related commands/tools
├── agents/               # subagent role definitions
│   ├── discovery.ts
│   ├── registry.ts
│   └── suggestions.ts
├── artifacts/            # artifact verification helpers
│   ├── verify.ts
│   └── path-resolver.ts
├── cadence/              # adaptive spawn pacing
│   └── cadence.ts
└── commands/
    └── run-task.ts
```

## Common pitfalls

- **Re-running on hook success** — hook says artifact present, agent retries anyway.
- **Lost lineage** — parent does not know which subagent produced which artifact.
- **Unbounded parallelism** — 20 parallel subagents hit provider rate limits.
- **No resume** — subagent fails, parent spawns a fresh one instead of resuming.
- **Path drift** — subagent writes to a different path than the parent expects.