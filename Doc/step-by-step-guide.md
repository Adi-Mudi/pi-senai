# Pi Orchestra — Step-by-Step Guide

This guide walks you through running a full **Plan → Implement → Document → Deliver** cycle with the `pi-orchestra` extension.

---

## Before you start

1. Make sure you are inside the project directory:

   ```bash
   cd /mnt/Just_Do_It/02_Devp_Soft/pi-senai/Pi-Orchestra_v4
   ```

2. The extension must be installed. For development, a symlink is enough:

   ```bash
   ln -sf /mnt/Just_Do_It/02_Devp_Soft/pi-senai/Pi-Orchestra_v4 ~/.pi/agent/extensions/pi-orchestra
   ```

3. Restart Pi or run `/reload` so Pi discovers the extension.

4. Confirm the commands are available:

   ```text
   /orchestra-status
   ```

   If there is no active run, Pi replies:

   ```text
   No active orchestra run. Use /orchestra-plan <mission> to start.
   ```

---

## Stage 1 — Plan

### Start the plan

```text
/orchestra-plan "add a /hello CLI command that prints Hello, World!"
```

What happens:

1. The extension creates `.IDE_Plans/orchestra/state.json` with the mission and a run ID.
2. It sets the current stage to `planning`.
3. It sends the Plan stage skill prompt to the main agent.
4. The main agent spawns three scouts in parallel:
   - `scout-1` — architecture / big-picture
   - `scout-2` — target-area deep dive
   - `scout-3` — risk / dependency audit
5. After the scouts finish, a discussion agent reads their reports and drafts clarifying questions.
6. The main agent asks you those questions live using the **AskUserQuestion** tool.
7. You answer the questions.
8. The main agent writes your answers into `discussion-notes.md`.
9. The planner writes `plan.md` under `.IDE_Plans/orchestra/runs/<run-id>/plan/`.
10. The planner also writes `plan-overview.md` under `.IDE_Plans/orchestra/runs/<run-id>/plan/` for user-friendly reading.
11. Scout reports are saved under `.IDE_Plans/orchestra/runs/<run-id>/plan/scouts/`.
12. Review reports are saved under `.IDE_Plans/orchestra/runs/<run-id>/plan/reviews/`.

### Approve the plan

When the main agent shows you the plan and reviews, read them and decide.

If you approve, run:

```text
/orchestra-approve
```

The stage advances from `planning` to `planned`, then the extension automatically starts the Implement stage (`implementing`).

---

## Stage 2 — Implement

### How it starts

The Implement stage starts automatically after you approve the plan.

If you ever need to start it manually, run:

```text
/orchestra-implement
```

What happens:

1. The extension checks that `plan.md` exists.
2. It accepts stages `planned` or `implementing`.
3. It sets the stage to `implementing`.
4. It sends the Implement stage skill prompt.
5. The main agent runs:
   - test-skeleton agent
   - implementer agent
   - linter
   - unit tests
   - code-review agent
   - full tests

### Approve implementation

When the main agent reports that tests and review pass, run:

```text
/orchestra-approve
```

Stage advances from `implementing` to `implemented`, then the extension automatically starts the Document stage (`documenting`).

---

## Stage 3 — Document

### How it starts

The Document stage starts automatically after you approve implementation.

If you ever need to start it manually, run:

```text
/orchestra-document
```

What happens:

1. The extension checks that the current stage is `implemented` or `documenting`.
2. It sets the stage to `documenting`.
3. It sends the Document stage skill prompt.
4. The main agent runs four writers in parallel:
   - `readme-writer`
   - `changelog-writer`
   - `api-docs-writer`
   - `other-docs-writer`

### Approve documentation

When the docs are ready, run:

```text
/orchestra-approve
```

Stage advances from `documenting` to `documented`, then the extension automatically starts the Deliver stage (`delivering`).

---

## Stage 4 — Deliver

### How it starts

The Deliver stage starts automatically after you approve documentation.

If you ever need to start it manually, run:

```text
/orchestra-deliver
```

What happens:

1. The extension checks that the current stage is `documented` or `delivering`.
2. It sets the stage to `delivering`.
3. It sends the Deliver stage skill prompt.
4. The main agent runs:
   - `security-gate` agent
   - `archive` agent

### Final approval

When the security report and deliver summary are ready, run:

```text
/orchestra-approve
```

Stage advances from `delivering` to `delivered`. The run is complete.

---

## Check status anytime

```text
/orchestra-status
```

Shows:

- current stage
- mission
- run ID
- artifact paths
- next command to run

---

## Reset a run

If you want to start over:

```text
/orchestra-reset
```

This deletes `.IDE_Plans/orchestra/state.json`. Artifacts under `.IDE_Plans/orchestra/runs/<run-id>/` are preserved.

---

## Typical full session

With auto-advance, the full session is just five commands:

```text
/orchestra-plan "add a /hello CLI command"
# ... wait for plan and reviews ...
/orchestra-approve           # auto-starts Implement
# ... wait for implementation and tests ...
/orchestra-approve           # auto-starts Document
# ... wait for docs ...
/orchestra-approve           # auto-starts Deliver
# ... wait for security and archive ...
/orchestra-approve           # run delivered
```

If you prefer to control each stage manually, you can still run `/orchestra-implement`, `/orchestra-document`, and `/orchestra-deliver` directly.

---

## Tips

- **Use `/orchestra-approve` to move forward.** It approves the current stage and automatically runs the next one.
- **Manual stage commands still work.** `/orchestra-implement`, `/orchestra-document`, and `/orchestra-deliver` are available as overrides.
- **Each stage is user-driven.** The main agent pauses at each approval gate and waits for you.
- **Artifacts are local.** Everything lives inside `.IDE_Plans/orchestra/` in this project directory.
- **Subagents need a multiplexer.** Make sure you run Pi inside tmux, zellij, or another supported terminal multiplexer so `pi-interactive-subagents` can spawn subagents.
