# Pi Orchestra

Stage-gated agent orchestration extension for Pi — **Plan → Implement → Document → Deliver**.

## What it does

Pi Orchestra splits software work into four explicit stages. Each stage runs a dedicated skill, produces artifacts in `.IDE_Plans/orchestra/runs/<run-id>/`, and requires user approval before the next stage starts.

- **Plan** — Spawn four scout agents, interview the user, write an approved `plan.md`.
- **Implement** — Build and test the feature according to the plan.
- **Document** — Update README, CHANGELOG, API docs, and other project docs.
- **Deliver** — Run a final security audit and package the deliverable.

## Install

The extension is loaded automatically by Pi when the project is opened because it is listed in `package.json` under the `pi.extensions` field.

```bash
npm install
npm test
```

## Usage

Start a new run:

```
/orchestra-plan <mission>
```

The agent will run the Plan stage. When the plan is ready, approve it:

```
/orchestra-approve
```

`/orchestra-approve` marks the current stage complete and automatically starts the next stage. You can also run stages manually when the previous stage is already approved:

```
/orchestra-implement
/orchestra-document
/orchestra-deliver
```

Check status at any time:

```
/orchestra-status
```

Reset the current run:

```
/orchestra-reset
```

## Agent configuration

Before running any stage, Pi Orchestra needs to know which subagent names to use for each role. This is stored in `.pi/orchestra/agents.json`.

Create the configuration interactively:

```
/orchestra-configure-agents
```

This discovers agents from:

1. The current project's `.pi/agents/*.md` files.
2. Your user agents directory (via Pi's `getAgentDir()`).
3. Built-in defaults: `scout`, `planner`, `worker`, `reviewer`, `security-auditor`.

For each Orchestra role you can accept a suggested agent, choose a different one, or fall back to the default.

Check the current mapping and validation status:

```
/orchestra-agents
```

Stage commands (`/orchestra-plan`, `/orchestra-implement`, `/orchestra-document`, `/orchestra-deliver`) will warn and stop if the configuration is missing or maps a custom agent that cannot be found.

## Artifact layout

```
.IDE_Plans/orchestra/
  state.json
  runs/
    YYYY-MM-DD-HH-MM-<mission-slug>/
      plan/
        plan.md
        plan-overview.md
        discussion-notes.md
        scouts/
          scout-angle_1.md
          scout-angle_2.md
          scout-angle_3.md
          scout-angle_4.md
        reviews/
          review-correctness.md
          review-security.md
          review-tests.md
      implement/
      document/
      deliver/
        security-report.md
        deliver-summary.md
```

## Development

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Tests are in `pi-extension/test/` and use Node's built-in test runner.

## See also

- [`Doc/orchestra-sequence.md`](Doc/orchestra-sequence.md) — high-level stage flow.
- [`Doc/senai-full-sequence.md`](Doc/senai-full-sequence.md) — full sequence specification.
- [`Doc/step-by-step-guide.md`](Doc/step-by-step-guide.md) — detailed walkthrough.
- [`AGENTS.md`](AGENTS.md) — contributor / agent notes.

## License

MIT
