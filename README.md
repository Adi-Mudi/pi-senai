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
| `/orchestra-approve` | Approve the current stage and advance to the next gate |
| `/orchestra-implement` | Start the Implement stage (requires approved plan) |
| `/orchestra-document` | Start the Document stage (requires implemented code) |
| `/orchestra-deliver` | Start the Deliver stage (requires docs) |
| `/orchestra-status` | Show current stage and artifact paths |
| `/orchestra-reset` | Clear the current run state |

## Workflow

1. **Plan** — scouts explore the codebase, a discussion agent drafts questions, the planner writes `plan.md`, and reviewers verify it. Run `/orchestra-approve` to advance to `planned`.
2. **Implement** — test skeleton, implementer, linter, tests, code review, full tests. Run `/orchestra-approve` to advance to `implemented`.
3. **Document** — README, CHANGELOG, API docs, and other docs updated in parallel. Run `/orchestra-approve` to advance to `documented`.
4. **Deliver** — security audit and final packaging. Run `/orchestra-approve` to advance to `delivered`.

See [`Doc/step-by-step-guide.md`](Doc/step-by-step-guide.md) for a detailed walkthrough.

## State & artifacts

State is persisted locally under `.pi/orchestra/state.json`. Each run produces artifacts under `.pi/orchestra/runs/<run-id>/`:

```text
.pi/orchestra/
├── state.json
└── runs/<run-id>/
    ├── plan.md
    ├── discussion-notes.md
    ├── scout-angle_1.md
    ├── scout-angle_2.md
    ├── scout-angle_3.md
    ├── review-correctness.md
    ├── review-security.md
    ├── review-tests.md
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
│   ├── state.ts          # read/write .pi/orchestra/state.json
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

## License

MIT
