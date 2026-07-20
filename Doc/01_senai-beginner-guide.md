# Pi Senai — Beginner Guide

This guide is for first-time users of the `pi-senai` extension. It answers two questions:

1. What commands do I run first after installing it?
2. Which commands will I use regularly, and how?

For a deeper walkthrough of each stage, see [`Doc/step-by-step-guide.md`](./step-by-step-guide.md).

---

## Before your first run

Pi Senai is loaded automatically by Pi because it is listed in `package.json`. You do not need to install anything extra. Just make sure dependencies are present:

```bash
npm install
```

Then restart Pi or run `/reload` so the extension is discovered.

---

## First-time setup

Before you can run any stage, you must create three configuration files. Senai will block stage commands until these exist and are valid.

Run these commands in order:

### 1. Configure agents

```text
/senai-configure-agents
```

This maps each Senai role to a subagent. It discovers agents from:

- Your project's `.pi/agents/*.md` files.
- Your user agent directory.
- Built-in defaults: `scout`, `planner`, `worker`, `reviewer`, `security-auditor`.

### 2. Configure project files

```text
/senai-configure-files
```

This selects:

- Code paths.
- Input documents.
- Test paths.
- Excluded paths.

### 3. Configure agent document assignments

```text
/senai-configure-agents-files
```

This assigns truth documents and comparison documents to each role.

### 4. Verify everything

```text
/senai-doctor
```

This checks all config files, mapped agents, file scopes, and runtime setup. It saves a full report to `.IDE_Plans/senai/doctor-report.md`.

### Optional: generate architecture

If you want a project-specific architecture agent and skills, run:

```text
/senai-configure-architect-inputs
/senai-generate-architect
```

This is a one-time setup step.

---

## Regular workflow

Once setup is complete, the normal workflow is simple.

### 1. Start a new run

```text
/senai-plan <mission>
```

Example:

```text
/senai-plan add a hello-world CLI command
```

This creates a run ID, sets the stage to `planning`, and starts the Plan stage.

### 2. Approve and advance

After the agent shows you the plan, approve it:

```text
/senai-approve
```

`/senai-approve` marks the current stage complete and automatically starts the next stage. You will use it many times during a single run:

- planning → planned → implementing
- implementing → implemented → documenting
- documenting → documented → delivering
- delivering → delivered

### 3. Manual stage overrides

You can also start a stage manually when the previous stage is approved:

```text
/senai-implement
/senai-document
/senai-deliver
```

### 4. Check status

```text
/senai-status
```

Shows the current stage, mission, run ID, and artifact paths.

### 5. Start over

```text
/senai-reset
```

Clears the current run state so you can begin a new mission.

---

## Command quick reference

| Command | Purpose |
| --- | --- |
| `/senai-configure-agents` | Map Senai roles to subagents. |
| `/senai-configure-files` | Select code, document, and test paths. |
| `/senai-configure-agents-files` | Assign truth and comparison documents per role. |
| `/senai-doctor` | Run a full diagnostic check. |
| `/senai-configure-architect-inputs` | Select documents for the architect. |
| `/senai-generate-architect` | Generate a project-specific architecture agent and skills. |
| `/senai-plan <mission>` | Start the Plan stage. |
| `/senai-approve` | Approve the current stage and start the next one. |
| `/senai-implement` | Start the Implement stage manually. |
| `/senai-document` | Start the Document stage manually. |
| `/senai-deliver` | Start the Deliver stage manually. |
| `/senai-status` | Show current stage and artifact paths. |
| `/senai-reset` | Clear the current run state. |

---

## Where artifacts are saved

Each run creates a folder under:

```text
.IDE_Plans/senai/runs/<run-id>/
```

Inside you will find:

```text
plan/
  plan.md
  plan-overview.md
  discussion-notes.md
  scouts/
  reviews/
implement/
document/
deliver/
  security-report.md
  deliver-summary.md
```

Run state is stored in `.IDE_Plans/senai/state.json`.
