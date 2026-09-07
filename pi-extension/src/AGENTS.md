# src/ — Layer contract for the Pi-Senai extension

This file is for AI agents and human contributors working inside `pi-extension/src/`. The root `AGENTS.md` covers the whole repo; this one is scoped to the extension source.

## Layer contract

The extension source is organised in 4 layers, mirroring Pi's own `core → modes → cli → main` pattern from `node_modules/@mariozechner/pi-coding-agent/docs/development.md`.

| Layer | Folder | Purpose | May import from |
|---|---|---|---|
| 0 — Domain | `core/`, `io/` | Stage state, paths, mission-brief, atomic-write, lock, migration | nothing else in `src/` |
| 1 — Stage logic | `architect/`, `doctor/`, `docs-factory/`, `implement/`, `scouts/`, `brainstorm/` | Architecture factory, diagnostic, doc selection, implement signals, scouts, brainstorm | Layer 0 |
| 2 — Presentation | `agents/`, `ui/`, `hooks/` | Sub-agent discovery, UI widgets, Pi lifecycle hooks | Layer 0, 1 |
| 3 — Composition | `commands/` | 18 slash commands + shared helpers | Layer 0, 1, 2 |

**Rule:** a file in layer N may import from any layer &lt; N. Files in the same layer may import each other freely. **Never import upward.**

The full map is also in [`layers.ts`](./layers.ts).

## Composition roots

There are exactly **two composition roots** in this extension. Both are wiring only — they contain no business logic.

### `src/index.ts` (45 lines, verified in Phase 2.3)

The Pi extension entry point. Default-exports `piSenaiExtension(pi)` and calls `register*` on each subsystem. See Pi's [`docs/extensions.md`](../../node_modules/@mariozechner/pi-coding-agent/docs/extensions.md) for the official `index.ts` pattern.

### `src/commands/index.ts` (~90 lines)

The command composition root. Imports each per-command file and re-exports `register*` functions plus shared helpers. One file per command (`configure-*.ts`, `generate-*.ts`, `stage-commands.ts`, etc.).

## File conventions

- One concern per file. Pi's docs (`extensions.md` lines 222-236) and the community reference ([rytswd/pi-agent-extensions](https://github.com/rytswd/pi-agent-extensions)) both prescribe this.
- Re-export public APIs through each layer's `index.ts` (where one exists). Imports between layers go through the lower layer's `index.ts` to keep the dependency graph stable.
- Use atomic writes (`io/atomic-write.ts`) for every file the extension owns. Never `fs.writeFileSync` directly.
- Use `path.join` for all paths. Never concatenate path strings.

## Adding new code

1. **A new domain concept** (state, I/O helper, path) → `core/` or `io/`.
2. **A new stage or factory** (architecture, doc, brainstorm, scout) → match the relevant layer-1 folder, or add a new one and document it here.
3. **A new sub-agent, UI widget, or Pi hook** → layer-2 folder.
4. **A new slash command** → add `commands/<name>.ts`, register it in `commands/index.ts`, and add it to the `STAGE_COMMANDS` or `NEXT_COMMAND` list if it's a stage transition.
5. **Update [`layers.ts`](./layers.ts)** if you added a new folder.

## Tests

Tests mirror this structure under `pi-extension/test/`. Run with `npm test` (per [Pi's official testing guidance](../../node_modules/@mariozechner/pi-coding-agent/docs/development.md)). E2E tests live under `test/e2e/` and require `RUN_E2E=1` plus `pi` on PATH.
