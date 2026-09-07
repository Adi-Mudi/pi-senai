---
name: pi-extension-theme
domain: pi-extension
team-size: any
complexity: low
best-for-drivers:
  - color scheme
  - tui styling
  - prompt template
  - visual identity
  - theme distribution
  - prompts only
  - zero logic extension
not-for-drivers:
  - tool provider
  - workflow extension
  - stateful extension
  - logic heavy
source: official-pi-pattern
---

# Pi Extension — Theme

A Pi extension that ships only themes (`.json`) and prompt templates (`.md`). No TypeScript business logic.

## When to use

- The contribution is purely visual (colors, spacing, prompts).
- No tools, commands, or lifecycle hooks are needed.
- The package can be a static bundle of JSON + Markdown.

## When not to use

- The extension registers a tools or commands.
- The extension must react to lifecycle events.

## Core rules

1. Use the conventional directory layout: `themes/*.json`, `prompts/*.md`.
2. Themes must declare all required Pi theme fields.
3. Prompt templates use the same frontmatter convention as skills.
4. No `src/` directory required if the package is data-only.
5. Document color tokens and contrast in `README.md`.
6. Test themes render in both light and dark terminal modes.

## Typical structure

```
themes/
  my-theme.json
prompts/
  greet.md
  farewell.md
README.md
package.json             # pi.manifest → themes + prompts only
```

## Common pitfalls

- **Incomplete theme** — missing required fields cause silent fallbacks.
- **Low accessibility** — poor contrast in light or dark mode.
- **Hard-coded hex** — no theme tokens, can't be re-skinned.
- **Hidden TypeScript** — adding `src/index.ts` accidentally turns it into a logic extension.