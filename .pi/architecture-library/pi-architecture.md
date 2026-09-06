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
11. Keep all session-related files written through atomic helpers (temp + fsync + rename).
12. Document the full lifecycle event catalog in extension docs.
13. Pin external direct dependencies to exact versions; use `save-exact=true` in `.npmrc`.
14. Generate `npm-shrinkwrap.json` for the published CLI package.
15. Test extensions under both interactive and `--mode rpc` flows.

## Typical package structure

```
packages/
  ai/              # LLM provider abstraction
  agent/           # Core agent loop and types
  coding-agent/    # Runtime with tools, sessions, extensions
  tui/             # Terminal UI components
```

## Mandatory imports for extensions

Extensions that target Pi must import from the right packages and list them in `peerDependencies`:

| Package | Used for | peerDependency |
|---|---|---|
| `@mariozechner/pi-coding-agent` | `ExtensionAPI`, `ExtensionContext`, events | required |
| `@sinclair/typebox` | Tool parameter schemas (`Type.Object`) | required |
| `@mariozechner/pi-ai` | `StringEnum` for Google-compatible enums | optional |
| `@mariozechner/pi-tui` | TUI components for custom rendering | optional |

## Peer dependencies rule

When importing any Pi package, list it in `peerDependencies` with a `"*"` range. Pi bundles these packages and does not let them be duplicated. Example:

```json
{
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  }
}
```

Other Pi packages must be bundled: add to `dependencies` + `bundledDependencies`, then reference through `node_modules/` paths.

## Lifecycle event catalog

Pi emits a stream of events throughout each session. The full catalog is in `pi-extension-lifecycle-events`. The most important for extension authors:

| Event | Purpose | Can block / cancel |
|---|---|---|
| `session_start` | Session loaded or reloaded | no |
| `session_before_compact` | Before compaction | yes (return custom summary) |
| `before_agent_start` | Before agent loop, can inject prompt | yes (systemPrompt) |
| `tool_call` | Before tool executes | yes (block with reason) |
| `tool_result` | After tool finishes, before message | partial (mutate result) |
| `input` | Before skill/template expansion | yes (handle / transform / continue) |

## ExtensionAPI surface

The full method catalog is in `pi-extension-api-surface`. Key methods every extension uses:

| Method | Purpose |
|---|---|
| `pi.on(event, handler)` | Subscribe to lifecycle events |
| `pi.registerTool(definition)` | Register a custom tool the LLM can call |
| `pi.registerCommand(name, opts)` | Register a slash command |
| `pi.sendUserMessage(text, opts)` | Send a message that appears from the user |
| `pi.appendEntry(type, data)` | Persist extension state (not in LLM context) |
| `pi.exec(cmd, args, opts)` | Run a shell command |
| `pi.reload()` | Re-scan and reload all extensions |

## Package manifest schema

The `pi` key in `package.json` declares resources. See `pi-extension-package-manifest` for full details. Minimum for an extension package:

```json
{
  "pi": {
    "extensions": ["./dist/index.js"]
  }
}
```

Add `keywords: ["pi-package"]` for gallery discoverability.

## Discovery paths

Pi searches fixed paths for each resource type. Project scope shadows global scope. See `pi-discovery-paths` for the full table.

| Resource | Global | Project |
|---|---|---|
| Extensions | `~/.pi/agent/extensions/*.ts` | `.pi/extensions/*.ts` |
| Skills | `~/.pi/agent/skills/**/SKILL.md` | `.pi/skills/**/SKILL.md` |
| Prompts | `~/.pi/agent/prompts/*.md` | `.pi/prompts/*.md` |
| Themes | `~/.pi/agent/themes/*.json` | `.pi/themes/*.json` |
| Agents | `~/.pi/agent/agents/*.md` | `.pi/agents/*.md` |

## Skill format

Each skill is a folder containing `SKILL.md` with required frontmatter. The `name` field MUST match the folder name. See `pi-skill-format-spec` for full details.

```markdown
---
name: my-skill
description: One-line description of when to load this skill
---

# My Skill

Numbered steps for the LLM to follow.
```

## Agent format

Each agent is a `.md` file with required frontmatter. See `pi-agent-format-spec` for full details.

```markdown
---
name: my-agent
description: One-line description of when to use this agent
tools: read, write, edit, bash
---

# My Agent

Role description, completion contract.
```

## Common pitfalls

- **Tight coupling to one provider** — defeats the `ai` package purpose.
- **Bloated system prompt** — Pi stays minimal by using skills and extensions.
- **Ignoring context limits** — compaction and branching must be designed in early.
- **Extension security** — extensions can register tools and intercept tool calls; trust boundaries matter.
- **Layer bypass** — `commands/` calling `fs.writeFileSync` directly instead of going through `io/atomic-write.ts`.
- **State without lock** — two commands racing on the same JSON file produce a torn write.
- **Missing peerDependencies** — `"^1.0.0"` range breaks at runtime; use `"*"` for Pi packages.
- **No `cwd`-based paths** — using `process.cwd()` instead of `ctx.cwd` breaks when cwd is not the project root.
- **Skipping `ctx.signal`** — long-running handlers ignore cancellation and can't be aborted.
- **Direct subagent spawning** — duplicating the subagent engine instead of using the `subagent` tool.
- **Unpinned direct deps** — same-day releases break the build; use exact versions in `.npmrc`.

## Migration path

A custom agent can adopt Pi's architecture by:
- Splitting LLM provider code from agent loop code.
- Adding append-only session persistence with id/parentId fields.
- Introducing an extension/skills mechanism.
- Keeping the system prompt small and delegating behavior to skills.
- Layering the codebase into `ai` → `agent` → `coding-agent` → `tui`.
- Adding a thin `ExtensionAPI` that exposes commands, tools, and lifecycle events.