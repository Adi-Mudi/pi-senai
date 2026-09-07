---
name: pi-skill-package
domain: pi-extension-project
team-size: any
complexity: low
best-for-drivers:
  - skills only
  - no typescript logic
  - knowledge package
  - prompt library
  - workflow cookbook
  - team standards
  - domain expertise
not-for-drivers:
  - tools needed
  - commands needed
  - stateful extension
  - logic heavy
source: official-pi-project
---

# Pi Skill Package — Project Architecture

A project that ships as a bundle of Pi skills. Minimal TypeScript, focus on `SKILL.md` quality.

## When to use

- The contribution is knowledge, prompts, and workflows — not code.
- Each skill is a self-contained capability.
- The package installs via `pi install npm:<package>`.
- Users will load skills on demand via `/skill:<name>`.

## When not to use

- The skills need custom tools.
- The skills need state or lifecycle hooks.
- The skills must react to user input.

## Core rules

1. One folder per skill under `skills/`.
2. Each `SKILL.md` has required frontmatter (`name`, `description`).
3. `name` MUST match the folder name.
4. No `src/` directory if the package is data-only.
5. Use `pi.skills` manifest in `package.json` to declare `skills/` path.
6. Document each skill's trigger conditions in the package README.
7. Validate all SKILL.md files have matching name + folder at CI time.
8. Keep skill bodies focused; use a completion contract per skill.

## Typical package structure

```
skills/
  my-skill/
    SKILL.md
  another-skill/
    SKILL.md
README.md
package.json             # pi.skills: ["./skills"]
```

## Package manifest

```json
{
  "name": "@scope/my-skill-pack",
  "version": "1.0.0",
  "keywords": ["pi-package", "skills"],
  "pi": {
    "skills": ["./skills"]
  }
}
```

## Common pitfalls

- **Name mismatch** — folder `my-skill/` with `name: something-else` → skill skipped.
- **Missing description** — skill not discoverable by LLM.
- **Bloated SKILL.md** — skill body too long; bloats context.
- **No completion contract** — LLM doesn't know when skill work is done.
- **Hidden TypeScript** — adding `src/index.ts` turns it into a logic extension.

## Validation script

A CI script can validate every skill has matching folder name + frontmatter name:

```bash
for skill_dir in skills/*/; do
  name=$(basename "$skill_dir")
  frontmatter=$(head -3 "$skill_dir/SKILL.md" | grep "^name:")
  if [[ "$frontmatter" != *"name: $name"* ]]; then
    echo "ERROR: $skill_dir/SKILL.md name does not match folder"
    exit 1
  fi
done
```