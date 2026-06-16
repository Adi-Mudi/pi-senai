# Pi Orchestra

Stage-gated agent orchestration extension for Pi — **Plan → Implement → Document → Deliver**.

## What it does

Pi Orchestra splits software work into four explicit stages. Each stage runs a dedicated skill, produces artifacts in `.IDE_Plans/orchestra/runs/<run-id>/`, and requires user approval before the next stage starts.

- **Plan** — Spawn scout agents, interview the user, write an approved `plan.md`.
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

## License

MIT
