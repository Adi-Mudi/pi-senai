---
name: pi-agent-format-spec
domain: pi-extension-spec
team-size: any
complexity: low
best-for-drivers:
  - agent format
  - agent frontmatter
  - agent discovery
  - subagent definition
  - agent file
  - agent md
  - pi agent
not-for-drivers:
  - pure code extension
  - no agent role
  - skill only
source: official-pi-spec
---

# Pi Agent — Format Spec

An agent is a `.md` file with YAML frontmatter that defines a role the LLM can be delegated to. Pi discovers agents from `.pi/agents/` (project) and `~/.pi/agent/agents/` (user).

## Required frontmatter

```markdown
---
name: <agent-name>
description: <one-line description of when to use>
---
```

## Optional frontmatter fields

| Field | Type | Purpose |
|---|---|---|
| `tools` | comma-separated | Tool whitelist (e.g. `read, write, bash`) |
| `skills` | comma-separated | Skills loaded when agent runs |
| `model` | string | Force a specific model for this agent |
| `thinking` | string | Force a specific thinking level |
| `session-mode` | string | `"lineage-only"` for subagent isolation |
| `auto-exit` | boolean | Exit session when agent finishes (subagent pattern) |
| `spawning` | boolean | Whether this agent can spawn subagents |

## Discovery order

1. **Project agents** — `.pi/agents/*.md` walking up from cwd
2. **User agents** — `~/.pi/agent/agents/*.md`
3. **Built-in defaults** — `scout`, `planner`, `worker`, `reviewer`, `security-auditor`

Project overrides user. User overrides built-in.

## Built-in defaults

| Name | Role |
|---|---|
| `scout` | Codebase exploration |
| `planner` | Planning and breakdown |
| `worker` | Generic implementation |
| `reviewer` | Code review |
| `security-auditor` | Security audit |

## Tool whitelist semantics

- Omitting `tools` means the agent has access to all active tools.
- `tools: read, bash` restricts to those two.
- For subagent-only agents: `tools: read, write, edit, bash` for full work; `tools: read, write` for reviewers; `tools: read, write, bash` for security auditors.

## Body conventions

1. Start with a one-line role statement.
2. Section listing allowed/forbidden patterns.
3. Section listing completion contract (artifact path + final message format).
4. Reference to any skills the agent uses.
5. End with a no-pasted-content rule (return summary, not output).

## Session mode semantics

- `session-mode: lineage-only` — subagent only; cannot be invoked interactively.
- `auto-exit: true` — session ends when agent completes (subagent pattern).
- `spawning: false` — agent cannot spawn subagents (prevents recursion).

## Common pitfalls

- **Name mismatch** — `name: foo` in frontmatter, filename `bar.md` → discovery may pick the wrong one.
- **No description** — agent skipped.
- **Tools typo** — `tools: read, writ` (typo) silently drops the tool.
- **Recursive spawning** — agent without `spawning: false` spawns another subagent of itself.
- **Pasted content** — agent returns 500 lines instead of a 5-line summary.