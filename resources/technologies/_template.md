---
id: _template
name: Technology Resource Template
keywords: []
---

# Technology Resource Template

Copy this file to `<technology>.md` (example: `rust.md`) and fill every section.

## Sourcing rule (mandatory)

1. Every section must be based on the **official documentation** of the technology.
2. Cite the official doc URL inside the section, like `(source: https://...)`.
3. No blog posts, no guesses, no invented limits. If it is not in the official docs, it does not go in.
4. Craft only: patterns, limits, testing, common mistakes. No generic advice like "write clean code".
5. Date the file so stale resources can be refreshed.

## Frontmatter fields

- `id` — the technology id, same as the filename without `.md` (example: `rust`).
- `name` — human-readable name (example: `Rust`).
- `keywords` — lowercase words used to match a project's tech stack (example: `rust, cargo`). More keywords = better matching.

## Required sections

- `## Core rules` — numbered, non-negotiable rules for working in this technology.
- `## Testing patterns` — how tests are written and run here, with the official test tooling.
- `## Tooling and limits` — build/deploy tools and hard limits (quotas, timeouts, sizes).
- `## Common mistakes` — the traps developers hit in this technology.

_Last updated: YYYY-MM-DD_
