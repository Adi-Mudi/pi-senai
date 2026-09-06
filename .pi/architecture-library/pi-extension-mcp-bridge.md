---
name: pi-extension-mcp-bridge
domain: pi-extension
team-size: small-to-medium
complexity: medium
best-for-drivers:
  - mcp server integration
  - external tool ecosystem
  - stdio bridge
  - sse transport
  - tool discovery
  - schema conversion
  - cross platform tools
not-for-drivers:
  - built in tools sufficient
  - no external tools
  - pure orchestrator
  - no schema mapping
source: official-pi-pattern
---

# Pi Extension — MCP Bridge

A Pi extension that bridges Model Context Protocol (MCP) servers into Pi's tool surface. Each MCP tool becomes a Pi tool.

## When to use

- An MCP server provides capabilities Pi doesn't ship.
- The team already maintains MCP servers.
- Tools need to be discovered dynamically from MCP.

## When not to use

- The tools can be implemented natively in the extension.
- No MCP infrastructure exists.

## Core rules

1. Spawn MCP servers as child processes (stdio) or connect via SSE.
2. Convert MCP tool schemas to TypeBox `Type.Object({...})` for Pi.
3. Forward `ctx.signal` to MCP requests for cancellation parity.
4. Map MCP errors to `{ isError: true, content: [...] }`.
5. Refresh the tool list when MCP sends a `notifications/tools/list_changed`.
6. Document the MCP server's lifecycle (start, restart, shutdown).
7. Handle MCP server crashes gracefully — keep Pi usable, log the error.

## Typical structure

```
src/
├── index.ts              # starts bridge, registers tools dynamically
├── mcp/
│   ├── client.ts         # MCP client wrapper
│   ├── stdio.ts          # stdio transport
│   ├── sse.ts            # SSE transport
│   └── schema.ts         # MCP schema → TypeBox converter
├── tools/
│   └── wrapper.ts        # MCP tool → Pi tool wrapper
└── lifecycle.ts          # server start/stop handlers
```

## Common pitfalls

- **No restart logic** — MCP server crashes, tools disappear forever.
- **Schema drift** — MCP schema change not reflected in Pi tool.
- **Missing abort** — long MCP request can't be cancelled from Pi.
- **No tool refresh** — new MCP tools invisible until restart.
- **Process leak** — stdio MCP servers not killed on extension unload.