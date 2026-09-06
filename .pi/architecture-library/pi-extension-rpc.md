---
name: pi-extension-rpc
domain: pi-extension
team-size: small-to-medium
complexity: medium
best-for-drivers:
  - rpc mode host
  - programmatic pi
  - sdk embedding
  - external integration
  - non interactive use
  - ci integration
  - scripted agent
not-for-drivers:
  - interactive tui only
  - no external driver
  - human in the loop always
  - single user
source: official-pi-pattern
---

# Pi Extension — RPC Host

A Pi extension designed to be driven via `pi --mode rpc` from an external host (CI, scripts, another agent).

## When to use

- The extension runs headless without a TUI.
- An external orchestrator drives Pi via RPC.
- The extension must report structured results to the host.
- A CI pipeline invokes the extension.

## When not to use

- The extension is purely interactive.
- No external integration is needed.
- The host speaks HTTP/JSON natively (use an HTTP bridge instead).

## Core rules

1. Use `ctx.hasUI` to detect print mode and RPC mode; avoid TUI-only APIs.
2. Return structured `details` from tools so the host can parse them.
3. Register commands that work in both interactive and RPC mode.
4. Document the RPC method surface (`get_commands`, `prompt`, `get_state`).
5. Never block on user confirmation in RPC mode — fall back to defaults.
6. Test the extension under `pi --mode rpc` explicitly.

## Typical structure

```
src/
├── index.ts
├── rpc/
│   ├── commands.ts       # commands safe for RPC mode
│   ├── responses.ts      # response shape definitions
│   └── errors.ts         # error mapping
└── host-bridge/          # optional: convenience client
    └── client.ts
```

## Common pitfalls

- **TUI-only APIs** — using `ctx.ui.custom()` or similar in RPC mode silently fails.
- **No structured errors** — host can't parse error responses.
- **User prompt fallback** — calling `ctx.ui.confirm()` blocks RPC host.
- **Missing --mode rpc test** — extension works in TUI, breaks in RPC.