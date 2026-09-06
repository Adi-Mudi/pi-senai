---
name: pi-rpc-host
domain: pi-extension-project
team-size: small-to-medium
complexity: medium
best-for-drivers:
  - sdk embedding
  - create agent session
  - programmatic pi
  - rpc mode host
  - external driver
  - non tui embedding
  - library use
not-for-drivers:
  - interactive tui only
  - single user cli
  - no external driver
  - no programmatic api
source: official-pi-project
---

# Pi RPC Host — Project Architecture

A project that embeds Pi programmatically via the SDK (`createAgentSession`) or drives it via `pi --mode rpc`. The host controls the agent; the agent is one component among many.

## When to use

- You need an LLM agent as part of a larger application.
- You want a programmatic API instead of a CLI/TUI.
- You drive Pi from another process (CI, web service, IDE plugin).
- You want fine-grained control over sessions, models, tools.

## When not to use

- The user interacts directly with Pi (use `pi-coding-agent` instead).
- You want a single-turn API without session persistence.
- You don't need any agent capabilities (use a direct LLM SDK).

## Core rules

1. Use `createAgentSession({ cwd, model, customTools, systemPrompt })` for SDK embedding.
2. Use `pi --mode rpc` for CLI embedding; never spawn a TUI.
3. Detect RPC mode via `ctx.hasUI` (false in RPC and print mode).
4. Avoid TUI-only APIs: `ctx.ui.custom()`, `ctx.ui.setWidget()`.
5. Return structured `details` from custom tools for host parsing.
6. Persist session files to a path the host controls.
7. Test the host under `--mode rpc` in CI.
8. Document the host → agent contract as a typed interface.

## Typical SDK structure

```typescript
import { createAgentSession, defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const myTool = defineTool({
  name: "my_tool",
  parameters: Type.Object({ input: Type.String() }),
  execute: async (_id, params) => ({
    content: [{ type: "text", text: `Result: ${params.input}` }],
  }),
});

const session = await createAgentSession({
  cwd: process.cwd(),
  model: myModel,
  customTools: [myTool],
  systemPrompt: "You are a code review assistant.",
});

await session.prompt("Review the diff at /tmp/changes.diff");
const result = await session.getEntries();
```

## Typical RPC structure

```typescript
// Host spawns: pi --mode rpc
const pi = spawn("pi", ["--mode", "rpc"], { stdio: ["pipe", "pipe", "pipe"] });

// Send prompt
pi.stdin.write(JSON.stringify({ method: "prompt", params: { text: "Hello" } }) + "\n");

// Parse responses from stdout
pi.stdout.on("data", (chunk) => {
  const messages = parseLines(chunk);
  for (const msg of messages) {
    if (msg.method === "agent_end") {
      // Host handles final state
    }
  }
});
```

## RPC method surface

| Method | Purpose |
|---|---|
| `get_commands` | List available commands |
| `prompt` | Send a user prompt |
| `get_state` | Current session state |
| `set_model` | Change active model |
| `compact` | Trigger compaction |
| `new_session` | Start a new session |

## Common pitfalls

- **TUI APIs in RPC mode** — silent no-op, host thinks extension is broken.
- **Untyped RPC responses** — host can't parse result.
- **Missing `await`** — RPC methods are async; missing await loses responses.
- **No CLI flag for RPC** — `pi --mode rpc` is the only supported mode.
- **Stdio pipe leak** — RPC host doesn't drain stdout, agent blocks.