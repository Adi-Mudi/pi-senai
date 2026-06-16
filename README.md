# Pi Orchestra

A local Pi extension for stage-gated agent orchestration:

```
Plan → Implement → Document → Deliver
```

Pi Orchestra adds slash commands that guide a Pi session through the Senai-style workflow. It reuses the existing [`pi-interactive-subagents`](https://github.com/HazAT/pi-interactive-subagents) extension for spawning subagents, and only adds sequence logic, state management, and stage prompts on top.

## Install

This extension is scoped to the current project directory only.

```bash
# Inside the project directory
pi install path:.
```

Or symlink for development:

```bash
ln -sf /mnt/Just_Do_It/02_Devp_Soft/pi-senai/Pi-Orchestra_v4 ~/.pi/agent/extensions/pi-orchestra
```

Then restart Pi or run `/reload`.

## Requirements

- Pi CLI >= 0.78.0
- [`pi-interactive-subagents`](https://github.com/HazAT/pi-interactive-subagents) extension installed

## Commands

| Command | Purpose |
|---|---|
| `/orchestra-plan <mission>` | Start the Plan stage |
| `/orchestra-approve` | Approve the current stage and automatically run the next stage |
| `/orchestra-implement` | Start the Implement stage manually (requires approved plan) |
| `/orchestra-document` | Start the Document stage manually (requires implemented code) |
| `/orchestra-deliver` | Start the Deliver stage manually (requires docs) |
| `/orchestra-status` | Show current stage, next command, and artifact paths |
| `/orchestra-reset` | Clear the current run state |

## Workflow

1. **Plan** — scouts explore the codebase, a discussion agent drafts questions, the planner writes `plan.md`, and reviewers verify it. Run `/orchestra-approve` to approve the plan and automatically start the Implement stage.
2. **Implement** — test skeleton, implementer, linter, tests, code review, full tests. Run `/orchestra-approve` to approve implementation and automatically start the Document stage.
3. **Document** — README, CHANGELOG, API docs, and other docs updated in parallel. Run `/orchestra-approve` to approve docs and automatically start the Deliver stage.
4. **Deliver** — security audit and final packaging. Run `/orchestra-approve` to finish the run.

You can also run `/orchestra-implement`, `/orchestra-document`, or `/orchestra-deliver` directly if you prefer to start a stage manually. Each stage command will tell you when to run `/orchestra-approve` next.

See [`Doc/step-by-step-guide.md`](Doc/step-by-step-guide.md) for a detailed walkthrough.

## State & artifacts

State is persisted locally under `.IDE_Plans/orchestra/state.json`. Each run produces artifacts under `.IDE_Plans/orchestra/runs/<run-id>/`:

```text
.IDE_Plans/orchestra/
├── state.json
└── runs/<run-id>/
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

## Development

```bash
# Install dev dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test
```

## Design

- **No duplicate subagent engine** — spawning is delegated to `pi-interactive-subagents`.
- **Local-only** — all code and state live inside this project directory.
- **Soft approval gates** — the extension enforces artifact existence; the user approves advancement between stages.
- **Approve auto-runs the next stage** — `/orchestra-approve` advances the state and immediately sends the next stage prompt, while manual stage commands remain available.

## Project structure

```text
.
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── .gitignore
├── pi-extension/src/
│   ├── index.ts          # extension entry: commands, hooks
│   ├── commands.ts       # slash command handlers
│   ├── state.ts          # read/write .IDE_Plans/orchestra/state.json
│   ├── prompt.ts         # build stage prompts / skill loads
│   └── constants.ts      # paths, stage names, artifact layout
├── pi-extension/test/    # unit tests
├── skills/
│   ├── orchestra-plan.md
│   ├── orchestra-implement.md
│   ├── orchestra-document.md
│   └── orchestra-deliver.md
└── Doc/
    ├── orchestra-sequence.md
    ├── senai-full-sequence.md
    └── step-by-step-guide.md
```

## See also

- [`Doc/orchestra-sequence.md`](Doc/orchestra-sequence.md) — high-level stage flow.
- [`Doc/senai-full-sequence.md`](Doc/senai-full-sequence.md) — full sequence specification.
- [`Doc/step-by-step-guide.md`](Doc/step-by-step-guide.md) — detailed walkthrough.
- [`AGENTS.md`](AGENTS.md) — contributor / agent notes.

## License

MIT
