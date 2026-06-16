# AGENTS.md — Pi Orchestra

Agent-focused guidance for working on the `pi-orchestra` Pi extension.

## Project overview

`pi-orchestra` is a local Pi extension that adds stage-gated orchestration slash commands:

```
Plan → Implement → Document → Deliver
```

It does **not** spawn subagents itself. Spawning is delegated to the [`pi-interactive-subagents`](https://github.com/HazAT/pi-interactive-subagents) extension. This extension only manages sequence logic, state, and stage skill prompts.

## Tech stack

- **Language:** TypeScript
- **Runtime:** Node.js (tests use `node --test`)
- **Package manager:** npm
- **Build:** `tsc` (see `tsconfig.json`)
- **Target layout:** ESM under `dist/`
- **Peer dependency:** `@mariozechner/pi-coding-agent`

## Build and test

Always build before testing. The test script builds automatically, but running build first catches TypeScript errors faster.

```bash
npm run build
npm test
```

- `npm run build` — compiles `pi-extension/src/**/*.ts` to `dist/pi-extension/`.
- `npm test` — builds, then runs `node --test dist/pi-extension/test/**/*.test.js`.

## Project structure

```text
.
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── AGENTS.md            # this file
├── .gitignore
├── pi-extension/src/    # extension source
│   ├── index.ts         # entry point: register commands, hooks, guards
│   ├── commands.ts      # slash command handlers
│   ├── state.ts         # read/write .IDE_Plans/orchestra/state.json
│   ├── prompt.ts        # load stage skills and build prompts
│   └── constants.ts     # paths, stage enum, transitions, helpers
├── pi-extension/test/   # unit tests
├── skills/              # stage skill markdown files
│   ├── orchestra-plan.md
│   ├── orchestra-implement.md
│   ├── orchestra-document.md
│   └── orchestra-deliver.md
└── Doc/                 # human-facing design docs
    ├── orchestra-sequence.md
    ├── senai-full-sequence.md
    └── step-by-step-guide.md
```

## Key design principles

1. **No duplicate subagent engine.** Do not add subagent spawning logic here. The extension injects prompts; the LLM calls the `subagent` tool provided by `pi-interactive-subagents`.
2. **Local-only state.** All state and artifacts live under `.IDE_Plans/orchestra/` inside the project directory.
3. **Soft approval gates.** The extension enforces stage order and artifact existence; the user approves advancement.
4. **Approve auto-runs the next stage.** `/orchestra-approve` advances the state and immediately sends the next stage prompt. Manual `/orchestra-XXX` commands remain available as overrides.

## State and artifacts

State file:

```text
.IDE_Plans/orchestra/state.json
```

Run artifacts:

```text
.IDE_Plans/orchestra/runs/<run-id>/
├── plan/
│   ├── plan.md
│   ├── plan-overview.md
│   ├── discussion-notes.md
│   ├── scouts/
│   │   ├── scout-angle_1.md
│   │   ├── scout-angle_2.md
│   │   └── scout-angle_3.md
│   └── reviews/
│       ├── review-correctness.md
│       ├── review-security.md
│       └── review-tests.md
├── implement/
├── document/
└── deliver/
    ├── security-report.md
    └── deliver-summary.md
```

Run ID format:

```text
YYYY-MM-DD-HH-MM-<mission-slug>
```

## Stage workflow

| Stage transition | Command that triggers it |
|---|---|
| `none` → `planning` | `/orchestra-plan <mission>` |
| `planning` → `planned` → `implementing` | `/orchestra-approve` |
| `planned` → `implementing` | `/orchestra-implement` (manual override) |
| `implementing` → `implemented` → `documenting` | `/orchestra-approve` |
| `implemented` → `documenting` | `/orchestra-document` (manual override) |
| `documenting` → `documented` → `delivering` | `/orchestra-approve` |
| `documented` → `delivering` | `/orchestra-deliver` (manual override) |
| `delivering` → `delivered` | `/orchestra-approve` |

Stage transitions are defined in `constants.ts` as `STAGE_TRANSITIONS`.

## Coding conventions

- Use TypeScript strict mode.
- Prefer explicit types; export public interfaces from their modules.
- Use `path.join` for all file-system paths.
- Keep command handlers thin. State logic belongs in `state.ts`; prompt logic belongs in `prompt.ts`.
- Do not mutate loaded state objects in place. Use `advanceStage()` and `saveState()` helpers.
- Notifications should be concise and tell the user the next command to run.

## Testing

- Tests are in `pi-extension/test/` using Node's built-in test runner.
- Each test file focuses on one module.
- Tests use temporary directories created with `fs.mkdtempSync`.
- When testing commands, build the handler map by calling `registerCommands` with a mock `ExtensionAPI`.

## Extension loading

The extension guards against loading inside subagent processes:

```typescript
if (process.env.PI_SUBAGENT_NAME) return;
```

Do not remove this guard.

## Development symlink

For local testing, the extension can be symlinked into Pi:

```bash
ln -sf /mnt/Just_Do_It/02_Devp_Soft/pi-senai/Pi-Orchestra_v4 ~/.pi/agent/extensions/pi-orchestra
```

After code changes, run `npm run build` and restart Pi or run `/reload`.

## Documentation

When changing behavior, update both code-facing docs (`README.md`, `CHANGELOG.md`) and design docs (`Doc/*.md`) plus stage skill files (`skills/*.md`) if the user-facing workflow changes.

### Doc map

- `Doc/orchestra-sequence.md` — high-level stage flow and artifact layout.
- `Doc/senai-full-sequence.md` — full sequence specification with agents and contexts.
- `Doc/step-by-step-guide.md` — hands-on walkthrough for running a full cycle.

## Branches

Active development happens on the `development` branch. Do not run git mutations (commit, push, reset, rebase) unless explicitly asked.
