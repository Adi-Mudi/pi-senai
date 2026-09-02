# Pi Senai — Step-by-Step Guide

This guide walks you through running a full **Plan → Implement → Document → Deliver** cycle with the `pi-senai` extension.

---

## Before you start

1. Make sure you are inside the project directory:

   ```bash
   cd /mnt/Just_Do_It/02_Devp_Soft/pi-senai/Pi-Senai_v4
   ```

2. The extension must be installed. For development, a symlink is enough:

   ```bash
   ln -sf /mnt/Just_Do_It/02_Devp_Soft/pi-senai/Pi-Senai_v4 ~/.pi/agent/extensions/pi-senai
   ```

3. Restart Pi or run `/reload` so Pi discovers the extension.

4. Confirm the commands are available:

   ```text
   /senai-status
   ```

   If there is no active run, Pi replies:

   ```text
   No active senai run. Use /senai-plan <mission> to start.
   ```

---

## Configure the senai

Before you run any stage, three configuration files must exist (`agents.json`, `files.json`, `agents_files.json`). The generate commands create `agents.json` for you. Run these commands in order:

1. **Configure project files** — select code paths, input documents, and test paths:

   ```text
   /senai-configure-files
   ```

2. **Select architect inputs** — pick the documents the architect agent reads:

   ```text
   /senai-configure-architect-inputs
   ```

3. **Generate the architecture** — creates the architecture docs, agents, and skills, and maps the seven architecture-bound roles in `agents.json`:

   ```text
   /senai-generate-architect
   ```

4. **Generate the sub-agent team** — generates agents for the remaining fourteen roles and maps them in `agents.json`. Existing custom agents are skipped:

   ```text
   /senai-generate-sub-agents
   ```

5. **Configure agent document assignments** — assign truth and comparison documents per role:

   ```text
   /senai-configure-agents-files
   ```

6. **Verify the setup** — run a full diagnostic and check the report:

   ```text
   /senai-doctor
   ```

`/senai-configure-agents` is optional: use it only to hand-pick your own agents instead of the generated ones.

Check the current settings anytime with `/senai-agents`, `/senai-files`, and `/senai-agents-files`.

---

## Stage 1 — Plan

### Start the plan

```text
/senai-plan "add a /hello CLI command that prints Hello, World!"
```

What happens:

1. The extension creates `.IDE_Plans/senai/state.json` with the mission and a run ID.
2. It sets the current stage to `planning`.
3. It sends the Plan stage skill prompt to the main agent.
4. The main agent spawns four scouts in parallel:
   - `scout-1` — Architecture / big-picture
   - `scout-2` — Coder Search
   - `scout-3` — Code Risk / dependency audit
   - `scout-4` — PRD / documentation audit
5. After the scouts finish, a discussion agent reads their reports and drafts clarifying questions.
6. The main agent asks you those questions live using the **AskUserQuestion** tool.
7. You answer the questions.
8. The main agent writes your answers into `discussion-notes.md`.
9. The planner writes `plan.md` under `.IDE_Plans/senai/runs/<run-id>/plan/`.
10. The planner also writes `plan-overview.md` under `.IDE_Plans/senai/runs/<run-id>/plan/` for user-friendly reading.
11. Scout reports are saved under `.IDE_Plans/senai/runs/<run-id>/plan/scouts/`.
12. Review reports are saved under `.IDE_Plans/senai/runs/<run-id>/plan/reviews/`.

### Approve the plan

When the main agent shows you the plan and reviews, read them and decide.

If you approve, run:

```text
/senai-approve
```

The stage advances from `planning` to `planned`, then the extension automatically starts the Implement stage (`implementing`).

---

## Stage 2 — Implement

### How it starts

The Implement stage starts automatically after you approve the plan.

If you ever need to start it manually, run:

```text
/senai-implement
```

What happens:

1. The extension checks that `plan.md` exists.
2. It requires the current stage to be exactly `planned`.
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
/senai-approve
```

Stage advances from `implementing` to `implemented`, then the extension automatically starts the Document stage (`documenting`).

---

## Stage 3 — Document

### How it starts

The Document stage starts automatically after you approve implementation.

If you ever need to start it manually, run:

```text
/senai-document
```

What happens:

1. The extension checks that the `implement/` directory contains artifacts.
2. It requires the current stage to be exactly `implemented`.
3. It sets the stage to `documenting`.
4. It sends the Document stage skill prompt.
5. The main agent runs four writers in parallel:
   - `readme-writer`
   - `changelog-writer`
   - `api-docs-writer`
   - `other-docs-writer`

### Approve documentation

When the docs are ready, run:

```text
/senai-approve
```

Stage advances from `documenting` to `documented`, then the extension automatically starts the Deliver stage (`delivering`).

---

## Stage 4 — Deliver

### How it starts

The Deliver stage starts automatically after you approve documentation.

If you ever need to start it manually, run:

```text
/senai-deliver
```

What happens:

1. The extension checks that the `document/` directory contains artifacts.
2. It requires the current stage to be exactly `documented`.
3. It sets the stage to `delivering`.
4. It sends the Deliver stage skill prompt.
5. The main agent runs:
   - `security-gate` agent
   - `archive` agent

### Final approval

When the security report and deliver summary are ready, run:

```text
/senai-approve
```

Stage advances from `delivering` to `delivered`. The run is complete.

---

## Check status anytime

```text
/senai-status
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
/senai-reset
```

This deletes `.IDE_Plans/senai/state.json`. Artifacts under `.IDE_Plans/senai/runs/<run-id>/` are preserved.

---

## Typical full session

With auto-advance, the full session is just five commands:

```text
/senai-plan "add a /hello CLI command"
# ... wait for plan and reviews ...
/senai-approve           # auto-starts Implement
# ... wait for implementation and tests ...
/senai-approve           # auto-starts Document
# ... wait for docs ...
/senai-approve           # auto-starts Deliver
# ... wait for security and archive ...
/senai-approve           # run delivered
```

If you prefer to control each stage manually, you can still run `/senai-implement`, `/senai-document`, and `/senai-deliver` directly.

---

## Tips

- **Use `/senai-approve` to move forward.** It approves the current stage and automatically runs the next one.
- **Manual stage commands still work.** `/senai-implement`, `/senai-document`, and `/senai-deliver` are available as overrides.
- **Each stage is user-driven.** The main agent pauses at each approval gate and waits for you.
- **Artifacts are local.** Everything lives inside `.IDE_Plans/senai/` in this project directory.
- **Subagents need a multiplexer.** Make sure you run Pi inside tmux, zellij, or another supported terminal multiplexer so `pi-interactive-subagents` can spawn subagents.

## Run lock and atomic writes

`/senai-approve` and `/senai-discussion-approve` are guarded by a project-wide advisory lock at `.IDE_Plans/senai/.lock/meta.json`. Two Pi sessions in the same project — or a double-click in one session — surface as a clear "Lock busy" error with the holder pid, host, command, and heartbeat age; the second caller waits up to `SENAI_LOCK_TIMEOUT_MS` (default 5000) before failing. A holder whose pid is dead, or whose heartbeat is older than `SENAI_LOCK_STALE_MS` (default 60000), is auto-stolen on the next acquire. Every config and state file the extension writes goes through an atomic helper (temp file + `fsync` + atomic `rename`), so a crash mid-write never leaves a half-written file. `/senai-discussion-approve` is also idempotent: a second call on the same already-finalized brief short-circuits with "already finalized" instead of bumping the `discussions` counter.

`/senai-doctor` shows a "Lock state" section that reports the current holder and warns when the heartbeat is older than the stale threshold. Run it any time you suspect a stuck lock.

---

## Running E2E tests

`pi-extension/test/e2e/` contains a Tier-1 end-to-end suite that spawns a real
`pi --mode rpc` subprocess, drives the slash commands, and asserts the result.
The suite catches integration regressions that the in-process unit tests miss:
registration drift, prompt-injection drift, hook wiring, and the full
Plan → Implement → Document → Deliver state machine.

### Prerequisites

1. `pi` must be on your `PATH`. The RPC harness calls `command -v pi` to
   confirm. The default symlink at `~/.pi/agent/extensions/pi-orchestra`
   (kept for backward compatibility) points at this checkout.
2. `RUN_E2E=1` must be exported. Without it the suite skips every test with
   the message `"E2E tests require pi binary on PATH and RUN_E2E=1"`.

### Running

```bash
# unit tests only (fast; default; no prereqs)
npm test

# end-to-end tests
RUN_E2E=1 npm run test:e2e

# refresh golden prompts (writes __golden_prompts__/planning.b64)
RUN_E2E=1 npm run test:e2e:update-snapshots
```

The suite creates a temporary HOME per test so it never touches your real
`~/.pi/agent/extensions/` directory. Temp directories are removed on teardown
even when assertions fail.

### What the suite covers

- `01-registration` — every slash command registered by `pi-senai` shows up
  in the RPC `get_commands` response (20 commands; names listed in the test).
- `02-full-lifecycle` — drives the state machine from `planning` to
  `delivered` and asserts every artifact lands on disk.
- `03-state-machine` — covers every forward transition in
  `STAGE_TRANSITIONS` plus the warn-and-ask path when artifacts are missing.
- `04-prompt-injection` — captures the plan-stage prompt from `get_messages`
  and matches it against a base64-encoded golden; refresh with
  `test:e2e:update-snapshots` when the prompt legitimately changes.
- `05-compaction` — exercises `session_before_compact` and asserts the
  deterministic summary.
- `06-spawn-guard` — blocks an untyped `subagent` call and accepts one with
  `agent: scout-1`.
- `07-completion-guard` — drives a completion notice through the input
  hook with a missing artifact and asserts the resume warning is appended.
- `08-architect-tools` — covers `/senai-configure-architect-inputs` and the
  warn-and-ask guard in `/senai-generate-architect`.
- `09-discussion` — pins the pre-run `mission-brief.md` shape consumed by
  `/senai-plan`.

### Snapshot workflow

The plan-stage golden lives at
`pi-extension/test/e2e/__golden_prompts__/planning.b64`. It is base64-encoded
so secrets never leak into git history. To refresh it:

```bash
RUN_E2E=1 npm run test:e2e:update-snapshots
git add pi-extension/test/e2e/__golden_prompts__/planning.b64
```

Diff the change carefully — drift is usually a real prompt regression, not
a flake.
