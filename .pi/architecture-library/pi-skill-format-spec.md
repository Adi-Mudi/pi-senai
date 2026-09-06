---
name: pi-skill-format-spec
domain: pi-extension-spec
team-size: any
complexity: low
best-for-drivers:
  - skill format
  - skill md
  - skill frontmatter
  - skill discovery
  - skill trigger
  - skill authoring
  - pi skill
not-for-drivers:
  - non skill content
  - pure code extension
  - no markdown
source: official-pi-spec
---

# Pi Skill — Format Spec

A skill is a self-contained capability package that Pi loads on-demand. The format is a folder containing a `SKILL.md` file with required YAML frontmatter.

## Required structure

```
my-skill/
└── SKILL.md
```

OR for top-level skills (when `pi.skills` declares the folder):

```
skills/
├── skill-one/
│   └── SKILL.md
└── skill-two.md        # top-level .md is also a skill
```

## Required frontmatter

```markdown
---
name: <folder-name>
description: <one-line description>
---
```

The `name` field MUST match the parent directory name.

## Optional frontmatter fields

| Field | Purpose |
|---|---|
| `model` | Force a specific model when skill is loaded |
| `thinking` | Force a specific thinking level when skill is loaded |

## Discovery rules

1. Recursive scan for `SKILL.md` folders.
2. Top-level `.md` files in declared `skills/` paths are also skills.
3. Project scope (`.pi/skills/`) shadows global scope (`~/.pi/agent/skills/`).
4. Missing `name` or `description` produces a startup warning, skill is skipped.

## Loading rules

- User invokes via `/skill:<name>` or `/<name>` (if no command conflict).
- `description` is used by the LLM to decide when to load the skill on demand.
- The full skill body is injected into the LLM context when loaded.

## Body conventions

1. Start with a one-line summary.
2. Numbered steps for any sequence the LLM must follow.
3. Sections for inputs, outputs, error handling.
4. Concrete examples for non-obvious cases.
5. End with a completion contract (what counts as done).

## Triggering via AGENTS.md

Pi has no hook-based skill enforcement. To force skill loading for specific file types:

```markdown
## Skill Usage Rules

When working with Python files (.py), read the python-dev-guidelines skill:
~/.pi/agent/skills/pi-skills/python-dev-guidelines/SKILL.md
```

## Common pitfalls

- **Name mismatch** — folder `my-skill/`, frontmatter `name: my-skill-2` → skill skipped.
- **Missing description** — skill skipped at startup.
- **No completion contract** — LLM finishes without knowing what counts as done.
- **Bloated skill** — skill body too long; bloats context.
- **Hidden side effects** — skill instructs the LLM to run scripts not in the skill folder.