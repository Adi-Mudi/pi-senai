---
name: pi-architecture
domain: agent-toolkit, extension, cli, tui
team-size: small-to-medium
complexity: medium
best-for-drivers:
  - ai agent toolkit
  - terminal-first workflow
  - extension system
  - skill system
  - session branching
  - context compaction
  - layered monorepo
  - provider agnostic
not-for-drivers:
  - sealed product
  - ide-first workflow
  - no extension needs
  - heavy system prompt
source: official
---

# Pi Architecture

Pi is a modular AI agent toolkit built as a layered TypeScript monorepo. Higher-level packages build on foundational abstractions so the core stays minimal and extensible.

## When to use

- You are building or extending a terminal-first AI coding agent.
- The system must support custom extensions and skills.
- Sessions need persistence, branching, and compaction.
- You want provider-agnostic LLM support.
- The tool should remain minimal and self-extending.

## When not to use

- You need a sealed end-user product with fixed workflows.
- An IDE-first experience is required.
- The team does not want to manage extensions or skills.
- A heavy, feature-rich system prompt is preferred.

## Core rules

1. Organize the codebase into layered packages: `ai` → `agent` → `coding-agent` → `tui`.
2. Keep the `ai` package provider-agnostic and reusable.
3. Keep the `agent` package focused on the pure agent loop.
4. Put tools, sessions, extensions, and UI in the `coding-agent` package.
5. Persist sessions as append-only JSONL trees with id/parentId fields.
6. Support session branching and compaction without losing history.
7. Load configuration from CLI flags, then env, then settings, then defaults.
8. Expose extension hooks for commands, tools, flags, and lifecycle events.
9. Use skills to inject specialized knowledge without bloating the system prompt.
10. Prefer small, composable tools over a large fixed tool set.

## Typical package structure

```
packages/
  ai/              # LLM provider abstraction
  agent/           # Core agent loop and types
  coding-agent/    # Runtime with tools, sessions, extensions
  tui/             # Terminal UI components
```

## Common pitfalls

- **Tight coupling to one provider** — defeats the `ai` package purpose.
- **Bloated system prompt** — Pi stays minimal by using skills and extensions.
- **Ignoring context limits** — compaction and branching must be designed in early.
- **Extension security** — extensions can register tools and intercept tool calls; trust boundaries matter.

## Migration path

A custom agent can adopt Pi's architecture by:
- Splitting LLM provider code from agent loop code.
- Adding append-only session persistence.
- Introducing an extension/skills mechanism.
- Keeping the system prompt small and delegating behavior to skills.
