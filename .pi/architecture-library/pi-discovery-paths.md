---
name: pi-discovery-paths
domain: pi-extension-spec
team-size: any
complexity: low
best-for-drivers:
  - discovery path
  - extension path
  - skill path
  - theme path
  - prompt path
  - agent path
  - install path
not-for-drivers:
  - pure data extension
  - non distributable
  - no resources
source: official-pi-spec
---

# Pi Discovery — Paths Spec

Pi searches a fixed set of paths for extensions, skills, prompts, themes, and agents. The order and resolution rules are the source of truth.

## Extension paths

| Location | Scope |
|---|---|
| `~/.pi/agent/extensions/*.ts` | Global |
| `~/.pi/agent/extensions/*/index.ts` | Global (subdirectory) |
| `.pi/extensions/*.ts` | Project-local |
| `.pi/extensions/*/index.ts` | Project-local (subdirectory) |

Additional paths via `settings.json`:

```json
{
  "extensions": ["/path/to/local/extension.ts", "/path/to/local/extension/dir"]
}
```

## Skill paths

| Location | Scope |
|---|---|
| `~/.pi/agent/skills/**/SKILL.md` | Global |
| `~/.pi/agent/skills/*.md` | Global (top-level) |
| `.pi/skills/**/SKILL.md` | Project-local |
| `.pi/skills/*.md` | Project-local (top-level) |

## Prompt paths

| Location | Scope |
|---|---|
| `~/.pi/agent/prompts/*.md` | Global |
| `.pi/prompts/*.md` | Project-local |

## Theme paths

| Location | Scope |
|---|---|
| `~/.pi/agent/themes/*.json` | Global |
| `.pi/themes/*.json` | Project-local |

## Agent paths

| Location | Scope | Priority |
|---|---|---|
| `.pi/agents/*.md` (project) | Project-local | Highest |
| `~/.pi/agent/agents/*.md` (user) | User | Middle |
| Built-in defaults (`scout`, `planner`, `worker`, `reviewer`, `security-auditor`) | Always available | Lowest |

## Package install paths

| Source | Global path | Project path |
|---|---|---|
| npm package | `~/.pi/agent/npm/<scope>/<name>/` | `.pi/npm/<scope>/<name>/` |
| git clone | `~/.pi/agent/git/<host>/<path>/` | `.pi/git/<host>/<path>/` |
| local path | (no copy; path stored) | (no copy; path stored) |

## Settings files

| File | Scope |
|---|---|
| `~/.pi/agent/settings.json` | Global |
| `.pi/settings.json` | Project-local |

Project-local entries win over global. The `-l` flag writes to project-local.

## Scope resolution

- Project > User > Built-in (for agents).
- Project > User (for skills, themes, prompts).
- Both lists are merged for extensions; load order is the discovery order.

## Hot reload

`/reload` re-scans all discovery paths and re-runs the extension factory. The new runtime emits `session_start` with `reason: "reload"` and `resources_discover` with `reason: "reload"`.

## Common pitfalls

- **Wrong extension path** — extension in `.pi/extensions/my.ts` but Pi searches `.pi/extensions/` only.
- **Project shadows global silently** — same-named skill in project hides global one.
- **Symlink not traversed** — discovery doesn't follow symlinks by default.
- **npm package not installed** — `npm install` not run after `pi install`.
- **Settings.json typo** — invalid JSON breaks all extension loading.