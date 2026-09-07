---
name: pi-extension-memory
domain: pi-extension
team-size: any
complexity: medium
best-for-drivers:
  - persistent memory
  - cross session recall
  - knowledge vault
  - obsidian style notes
  - append only journal
  - context restoration
  - long running project
not-for-drivers:
  - ephemeral session
  - stateless tool
  - no cross session need
  - performance critical path
source: official-pi-pattern
---

# Pi Extension — Memory

A Pi extension that persists memory across sessions using append-only Markdown, JSONL, or a vault directory.

## When to use

- Users want to recall facts from earlier sessions.
- Notes follow a typed schema (ADR, daily log, encyclopedia page).
- The extension must not require a database or external service.
- Memory is human-readable as well as machine-readable.

## When not to use

- Memory lives only inside a single session.
- High-frequency writes (memory per tool call).
- Sensitive data that requires encryption at rest.

## Core rules

1. Use append-only storage; never rewrite past entries.
2. Each entry carries a timestamp + id; entries form a tree or flat list.
3. Validate frontmatter on read; skip malformed entries with a warning.
4. Never write memory outside a configured vault directory.
5. Cap memory size; rotate or summarize when limit exceeded.
6. Expose a `/search` command or skill so the LLM can recall.
7. Index memory on session start so recall is cheap.
8. Provide a migration path when the schema changes.

## Typical structure

```
src/
├── index.ts
├── vault/                # vault directory abstraction
│   ├── paths.ts
│   ├── reader.ts
│   └── writer.ts
├── schema/               # typed page schemas
│   ├── daily-log.ts
│   ├── adr.ts
│   └── index.ts
├── search/               # recall helpers
│   └── search.ts
└── commands/
    ├── vault-init.ts
    └── vault-recall.ts
```

## Common pitfalls

- **Silent overwrite** — rewriting entries loses history.
- **Schema drift** — old pages fail new readers.
- **Unbounded growth** — vault explodes over months.
- **No index** — every recall reads every file.
- **Secret leakage** — memory pages contain credentials or tokens.

## Reference implementations

- `pi-echoes-vault` — Markdown/Obsidian vault for Pi.
- `context-mode` — context restoration across sessions.