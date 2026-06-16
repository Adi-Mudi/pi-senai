# Agent Notes for Pi Orchestra

## Project layout

- `pi-extension/src/` — TypeScript extension source.
  - `index.ts` — Entry point, registers commands and injects status into the system prompt.
  - `commands.ts` — Slash command handlers and artifact validation.
  - `state.ts` — State read/write, run initialization, stage transitions.
  - `constants.ts` — Stage enum, transitions, artifact paths, helpers.
  - `prompt.ts` — Skill loading and stage prompt construction.
- `skills/` — Markdown skill files consumed by the extension.
  - `orchestra-plan.md`
  - `orchestra-implement.md`
  - `orchestra-document.md`
  - `orchestra-deliver.md`
- `pi-extension/test/` — Unit tests using `node:test`.
- `Doc/` — Human-facing sequence documentation.

## Build and test

```bash
npm run build   # compiles TypeScript to dist/
npm test        # build + run all tests
```

Always run `npm test` after changing source or tests.

## Conventions

- Use `node:fs`, `node:path`, and `node:test` — no extra test framework.
- Prefer immutable state objects (`advanceStage` returns a new object).
- Keep skills concise; the agent has a limited turn budget.
- Every stage skill ends with an approval gate that tells the user to run `/orchestra-approve`.
- Do not edit source files inside Plan or Document stages.

## Key design decisions

- Run IDs include the date and minute to avoid collisions: `YYYY-MM-DD-HH-MM-<slug>`.
- State is stored in `.IDE_Plans/orchestra/state.json`; artifacts are under `.IDE_Plans/orchestra/runs/<run-id>/`.
- The extension skips loading inside subagent processes via `PI_SUBAGENT_NAME`.
- `/orchestra-approve` auto-advances through the completed stage into the next working stage.
