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

Run these commands in order. The generate commands create your sub-agent team and the `agents.json` mapping for you — you do not need to create any config file by hand first.

### 1. Configure project files

```text
/senai-configure-files
```

This selects:

- Code paths.
- Input documents.
- Test paths. (Senai scans these — see [How testing works](#how-testing-works).)
- Excluded paths.

### 2. Select architect inputs

```text
/senai-configure-architect-inputs
```

This picks the documents the architect agent reads.

### 3. Generate the architecture

```text
/senai-generate-architect
```

This creates the architecture documents, five architecture agents, and four architecture skills. It also creates `.pi/senai/agents.json` and maps the seven architecture-bound roles automatically.

### 4. Generate the sub-agent team

```text
/senai-generate-sub-agents
```

This generates agents for the remaining fourteen roles and maps them in `agents.json`. If you already have custom agents, they are skipped and never touched.

### 5. Configure agent document assignments

```text
/senai-configure-agents-files
```

This assigns truth documents and comparison documents to each role. The picker shows only the roles that read project documents (scouts, discussion, planner, reviewers, code review, security gate) — the other roles work from stage outputs and are hidden. Assignments are optional, but recommended: if you skip them, `/senai-doctor` will warn and suggest the right document for each role.

### 6. Verify everything

```text
/senai-doctor
```

This checks all config files, mapped agents, file scopes, and runtime setup. The report opens with a **Setup progress** section that shows which steps are done and names the one next command — so you can run `/senai-doctor` after every step and follow the arrow. It saves a full report to `.IDE_Plans/pi-senai/doctor-report.md`.

### Optional: manual agent mapping

```text
/senai-configure-agents
```

You only need this if you want to hand-pick your own agents instead of the generated ones. It discovers agents from your project's `.pi/agents/*.md` files, your user agent directory, and the built-in defaults (`scout`, `planner`, `worker`, `reviewer`, `security-auditor`).

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

## How testing works

Senai writes tests for you during the **Implement** stage. You do not need to do anything extra. But it helps to know what is happening.

### Tests are written first

The Implement stage runs in this order:

```text
test skeleton → write code → lint → run tests → review → full test
```

The test files are created **before** the real code. They start empty. Then the code is written to make them pass.

This way "done" is decided before the work starts.

### What a good test looks like

Every test has three parts. Set up, run, check.

```js
const age = 17;                 // set up
const result = isAdult(age);    // run
expect(result).toBe(false);     // check
```

That is the whole shape. Nothing else belongs in a test.

### Which values get tested

Senai does not test every number. It tests the edge.

If the rule is "18 and over is an adult", it writes three tests:

| Input | Expected |
| --- | --- |
| 17 | false |
| 18 | true |
| 19 | true |

The edge is where bugs live. Testing 1, 2, 3, 4, 5 proves nothing extra.

### Senai checks your tests

When you run `/senai-approve` at the end of the Implement stage, Senai scans the test files for weak tests. It looks for eight problems. Two of them are marked **blocking**:

| Problem | Why it is bad |
| --- | --- |
| A test with no check | It runs, it always passes, it proves nothing. |
| More than three fake objects in one test | The test is checking the fakes, not your code. |

The other six are warnings — mirror-logic, flaky timing, hidden setup data, testing private methods, one test doing many things, and missing set-up/run/check structure.

You always see the full list in the approval summary.

### How much is enough

- 80% of changed code should have tests.
- 100% for login, payment, and password code.

The coverage number is shown in the approval summary too.

### Making the checks strict

By default the findings are advisory. You see them and you decide.

Turn on strict mode to be asked for a confirmation before advancing when a blocking finding is present:

```bash
export SENAI_TEST_DISCIPLINE_STRICT=1
```

Change the 80% target:

```bash
export SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR=90
```

### Full rules

The complete rule list lives in [`skills/senai-implement.md`](../skills/senai-implement.md) under **Testing discipline**.

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
| `/senai-generate-sub-agents` | Generate sub-agents for the remaining 14 roles and map them in `agents.json`. |
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
.IDE_Plans/pi-senai/runs/<run-id>/
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

Run state is stored in `.IDE_Plans/pi-senai/state.json`.
