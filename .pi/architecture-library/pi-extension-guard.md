---
name: pi-extension-guard
domain: pi-extension
team-size: any
complexity: low
best-for-drivers:
  - tool call interception
  - permission gates
  - safety checks
  - rm rf protection
  - env file protection
  - bash command validation
  - audit log
not-for-drivers:
  - tool provider
  - workflow orchestrator
  - stateful extension
  - ui extension
source: official-pi-pattern
---

# Pi Extension — Guard

A hook-only Pi extension that intercepts `tool_call` events to enforce safety rules, permissions, and audit logging.

## When to use

- Certain commands must require user confirmation (`rm -rf`, `sudo`, force pushes).
- Writes to sensitive files must be blocked (`.env`, `node_modules/`, `.ssh/`).
- Every tool call must be logged for audit.
- The extension adds zero new tools or commands.

## When not to use

- The extension also registers tools or commands (combine patterns instead).
- The guard depends on state the extension must persist.
- The user wants soft warnings instead of hard blocks.

## Core rules

1. Subscribe to `tool_call`; use `isToolCallEventType` for typed inputs.
2. Return `{ block: true, reason: string }` to block; the reason must be human-readable.
4. Never mutate `event.input` for tools you don't recognize.
5. Persist audit log via `pi.appendEntry("guard", {...})`.
6. Keep guard logic read-only — no writes, no tool calls from inside the handler.
7. Document every blocked pattern in `README.md`.
8. Provide a bypass mechanism (`/allow-rm-rf <pattern>`) for trusted operations.

## Typical structure

```
src/
├── index.ts              # registers tool_call handler
├── patterns.ts           # blocked pattern definitions
├── allowlist.ts          # user-bypass list
└── audit.ts              # appendEntry helpers
```

## Common pitfalls

- **Blocking legitimate work** — too greedy a guard frustrates users.
- **No bypass path** — users can't override when needed.
- **Hidden side effects** — guard itself writes files or calls tools.
- **Pattern drift** — blocked patterns diverge from current tooling defaults.
- **No audit** — guards without logs are impossible to debug.