---
name: pi-extension-tool-provider
domain: pi-extension
team-size: any
complexity: low
best-for-drivers:
  - custom tool only
  - no commands needed
  - no lifecycle hooks
  - simple extension
  - linter integration
  - formatter wrapper
  - single concern tool
not-for-drivers:
  - multi tool workflow
  - stateful extension
  - user interaction needed
  - lifecycle integration
source: official-pi-pattern
---

# Pi Extension — Tool Provider

A minimal Pi extension that only registers one or more custom tools via `pi.registerTool()`. No commands, no lifecycle hooks.

## When to use

- The extension exposes a single capability to the LLM.
- No user interaction is required beyond tool calls.
- No persistent state belongs to the extension.
- Lifecycle hooks would add noise without value.

## When not to use

- The extension needs to react to session events.
- The extension needs to expose a slash command.
- The tool requires persistent state across sessions.
- Multiple tools with cross-cutting behavior are needed.

## Core rules

1. Export a default factory function that receives `ExtensionAPI`.
2. Register tools with `Type.Object({...})` parameters; never use raw objects.
3. Tools return `{ content: [{ type: "text", text }], details }`.
4. Implement abort awareness via `ctx.signal` for any nested async work.
5. Use `promptSnippet` and `promptGuidelines` to opt the tool into the system prompt.
6. Keep tool logic single-purpose; one tool = one concern.
7. Return structured `details` for programmatic downstream use.

## Typical structure

```
extension.ts             # single file, default factory function
package.json             # peerDeps only
README.md
```

## Common pitfalls

- **Bloated tools** — one tool doing five things instead of five single-purpose tools.
- **Raw object params** — bypassing TypeBox loses runtime validation.
- **Missing signal** — long-running tool ignores `ctx.signal` and can't be cancelled.
- **No promptSnippet** — tool is invisible in the LLM's system prompt.
- **Hard-coded paths** — tool uses `process.cwd()` instead of `ctx.cwd`.