---
name: pi-extension-package-manifest
domain: pi-extension-spec
team-size: any
complexity: low
best-for-drivers:
  - package.json pi key
  - distribution manifest
  - pi install
  - pi package
  - npm publish
  - git tag
  - resource discovery
not-for-drivers:
  - non distributable
  - internal only
  - local testing
  - no pi import
source: official-pi-spec
---

# Pi Extension — Package Manifest Spec

The `pi` key in `package.json` declares which resources the package contributes to Pi. Pi auto-discovers from these paths when no manifest is present.

## When to use

- You want to distribute the extension via npm or git.
- You want to declare specific resource paths (not rely on convention).
- You want to scope the package as `pi-package` for the gallery.

## Required frontmatter

```json
{
  "name": "@scope/my-pi-extension",
  "version": "1.0.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./dist/index.js"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

## Optional gallery metadata

```json
{
  "pi": {
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

## Convention directories (no manifest required)

- `extensions/` — `.ts` and `.js` files
- `skills/` — recursive `SKILL.md` folders + top-level `.md` files
- `prompts/` — `.md` files
- `themes/` — `.json` files

## Manifest glob semantics

- Paths are relative to the package root.
- Arrays support glob patterns and `!exclusions`.
- Positive manifest globs discover visible paths in lexical order.
- List dot-prefixed paths directly.
- Symlinks must be listed as their resource root.

## Filtering (in user settings.json)

```json
{
  "packages": [
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

- Omit a key to load all of that type.
- Use `[]` to load none of that type.
- `!pattern` excludes matches.
- `+path` force-includes an exact path.
- `-path` force-excludes an exact path.

## Peer dependencies rule

If you import from `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-tui`, or `@sinclair/typebox`, list them in `peerDependencies` with a `"*"` range. Pi bundles these packages and does not let them be duplicated.

```json
{
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  }
}
```

Other pi packages must be bundled in your tarball: add to `dependencies` + `bundledDependencies`, then reference through `node_modules/` paths.

## Common pitfalls

- **Missing keywords** — package invisible in `pi install` gallery.
- **Wrong peer range** — `"^1.0.0"` instead of `"*"` breaks at runtime.
- **Glob without explicit dotfiles** — `.config/` paths skipped.
- **No bundledDependencies** — sibling pi package not found inside tarball.
- **Symlink blindness** — symlinked resource root not traversed by glob.