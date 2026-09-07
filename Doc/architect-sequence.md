# Architect Sequence — `/senai-generate-architect`

This document describes the design and runtime sequence for the `/senai-generate-architect` command in Pi Senai.

## Goal

Generate a project-specific architecture agent and matching skills by reading the user's requirements documents, extracting architectural drivers, selecting the best architecture, and producing configured agent files.

## Commands

| Command | Purpose |
|---------|---------|
| `/senai-configure-architect-inputs` | Select which documents the architect agent reads. |
| `/senai-generate-architect` | Run the full architect generation flow. |

---

## Preconditions

Before running `/senai-generate-architect`:

1. Architect inputs must be configured:
   - `.pi/senai/architect-inputs.json`
2. Architecture library should exist:
   - `.pi/architecture-library/*.md`

No other configuration is required up front: the command creates or updates
`.pi/senai/agents.json` itself and auto-maps the seven architecture-bound roles.

If architect inputs are missing, the command tells the user to run `/senai-configure-architect-inputs` first. For Pi extension projects, the message suggests `/senai-suggest-architect` instead — the new command picks architecture from the library without requiring authored input documents.

---

## Step 1a — Suggest architecture from library (alternative to step 1)

### Command
```
/senai-suggest-architect
```

### What it does

1. Loads `.pi/architecture-library/` (36 entries bundled in v1.6.0+).
2. Asks 4 project questions via `AskUserQuestion`:
 - **Purpose** — extension / coding-agent / web-app / api / library
 - **Scale** — single-user / small-team / medium-team / large-org
 - **Deployment** — cloud / on-premise / local / edge
 - **Real-time** — yes / no
3. Scores library entries deterministically (`suggestArchitectures` in `library-suggester.ts`).
4. Shows the top 3 matches with rationale (matched drivers, domain alignment).
5. User picks one — or selects "None fit" to see the new-entry template guide.
6. Auto-discovers drivers from `package.json` + `README.md` + `.pi/agents/` + `.pi/skills/` + `.pi/extensions/` (per `createInputsConfigFromCodebase`).
7. Runs the factory with the chosen library entry as `selectedArchitecture`.

### When to use

- The project is brand new and you have no PRD/NFR documents.
- You want the LLM to skip the document-extraction step.
- You're a Pi extension author and want a Pi-aware recommendation.
- You want to see which architecture patterns match your project's shape.

### Auto-trigger

`/senai-generate-architect` suggests this command when no `architect-inputs.json` is configured AND the project is detected as a Pi extension. The doctor also surfaces the suggestion in the Library Completeness section.

### When none fit

The "None fit" option displays a copy-paste template (frontmatter + 5 sections) and the path to add it (`.pi/architecture-library/<your-name>.md`). New entries are picked up on the next run without any code change.

---

## Step 1 — Configure architect inputs

### Command
```
/senai-configure-architect-inputs
```

### What it does
1. Scans the project for candidate documents using the existing `files-discovery.ts` scanner.
2. Shows a categorized list editor (`ui/list-editor.ts`) with document type labels.
3. Allows the user to select, deselect, and add custom paths.
4. Allows free-form text input for additional constraints not in any file.
5. Saves the result to `.pi/senai/architect-inputs.json`.

### Document types detected
- `prd` — Product Requirements Document
- `mrd` — Market Requirements Document
- `brd` — Business Requirements Document
- `rtm` — Requirements Traceability Matrix
- `nfr` — Non-Functional Requirements
- `test-plan` — Test plan or test strategy
- `adr` — Architecture Decision Record
- `readme` — README or project overview
- `code` — Code paths
- `feasibility` — Feasibility study or analysis

### Configuration file
```json
{
  "version": 1,
  "documents": [
    { "type": "prd", "path": "docs/PRD.md" },
    { "type": "nfr", "path": "docs/NFR.md" },
    { "type": "readme", "path": "README.md" }
  ],
  "additionalConstraints": [
    "This is a junior developer learning project. Keep the architecture simple."
  ]
}
```

---

## Step 2 — Generate architecture

### Command
```
/senai-generate-architect
```

### Sequence

```
Verify inputs configured
        │
        ▼
Run Map-Reduce document ingest
        │
        ▼
Load merged architectural drivers
        │
        ▼
AskUserQuestion for driver gaps
        │
        ▼
Match drivers against architecture library
        │
        ▼
Spawn Doctor Architect subagent
        │
        ▼
Read architect report
        │
        ▼
If missing resources → SearchWeb/FetchURL
        │
        ▼
Feasibility check
        │
        ▼
Generate project agents and skills
        │
        ▼
Run architecture doctor checks
        │
        ▼
Notify user
```

---

## Step 2.1 — Map-Reduce document ingestion

### Why Map-Reduce?

Users may have many large documents. A single agent cannot reliably read them all. The community-standard pattern is **Map-Reduce**:

- **Map:** one subagent per document, running in parallel.
- **Reduce:** one subagent merges all partial driver outputs.

### Concurrency

Maximum **4** ingest subagents run in parallel. This balances speed with token cost and rate limits.

### Map phase

For each selected document, spawn an ingest subagent with:

```markdown
---
name: architect-document-ingest
description: Reads one requirements document and extracts architectural drivers
tools: read, write
---

Read the document at <path>.
Extract architectural drivers and write them to <outputPath>.

Output format:
{
  "document": "<path>",
  "documentType": "<type>",
  "functionalRequirements": [{ "id": "...", "description": "..." }],
  "qualityAttributes": [{ "id": "...", "category": "...", "target": "..." }],
  "constraints": [{ "id": "...", "category": "...", "description": "..." }],
  "technicalConcerns": [{ "id": "...", "description": "..." }],
  "uncertainties": ["..."]
}
```

Each map subagent writes to:
```
.IDE_Plans/architect-map/<doc-id>.json
```

### Reduce phase

After all map subagents complete, spawn a reducer subagent:

```markdown
---
name: architect-driver-reducer
description: Merges per-document architectural drivers into one file
tools: read, write
---

Read all files in .IDE_Plans/architect-map/.
Merge them into one architectural-drivers.json file.
Remove duplicates.
Resolve conflicts by keeping the most specific statement.
List all uncertainties.
```

Output:
```
.pi/architect/architectural-drivers.json
```

> **Implementation note:** The extension provides the `senai_merge_architect_drivers` tool. The agent should call it instead of writing the merged file by hand. This guarantees the correct schema and cleans up stale intermediate files from `.pi/senai/`.

### Output format after reduce

```json
{
  "functionalRequirements": [
    { "id": "FR-1", "description": "...", "source": "docs/PRD.md" }
  ],
  "qualityAttributes": [
    { "id": "QA-1", "category": "scalability", "target": "100k concurrent users", "source": "docs/NFR.md" }
  ],
  "constraints": [
    { "id": "C-1", "category": "budget", "description": "...", "source": "docs/BRD.md" }
  ],
  "technicalConcerns": [
    { "id": "TC-1", "description": "...", "source": "README.md" }
  ],
  "uncertainties": [
    "Expected data volume per user is not stated."
  ]
}
```

---

## Step 2.2 — Gap analysis and user interview

The system loads `architectural-drivers.json` and checks for critical missing drivers.

### Critical drivers

| Category | Examples of critical info |
|----------|---------------------------|
| Team size | solo, small (2-8), medium (9-20), large (21+) |
| Project type | web, mobile, desktop, API, PLC, IoT, AI/ML, game |
| Scale | users, requests per second, data volume |
| Deployment | cloud, on-premise, edge, offline |
| Constraints | budget, timeline, compliance, legacy systems |
| Additional constraints | user-provided extra requirements |

If any critical driver is missing, the main agent uses **AskUserQuestion** to ask the user.

Example questions:
- "How many developers will work on this project?"
- "Is this a web app, mobile app, desktop app, PLC system, or something else?"
- "What is the expected number of concurrent users?"
- "Does this need to work offline?"
- "What are the additional constraints or non-negotiable requirements?"

Answers are merged into the driver file and saved as:
```
.pi/architect/architect-profile.json
```

---

## Step 2.3 — Architecture library matching

The architecture library lives in:
```
.pi/architecture-library/
```

Each architecture file has frontmatter that lists which drivers it supports and which it does not.

Example:
```yaml
---
name: modular-monolith
domain: web, desktop, api
team-size: small-to-medium
complexity: low-to-medium
best-for-drivers:
  - small team
  - fast time-to-market
  - simple deployment
  - strong consistency
  - low operational overhead
not-for-drivers:
  - large independent teams
  - independent scaling per domain
  - polyglot technology stacks
source: community
---
```

### Matching logic

1. Score each architecture by counting matched `best-for-drivers`.
2. Penalize each matched `not-for-drivers`.
3. Filter by `team-size` and `domain`.
4. Pick the highest-scoring architecture.
5. If scores are close, prefer the simpler architecture.

---

## Step 2.4 — Doctor Architect subagent

The Doctor Architect subagent receives:
- The merged architectural drivers.
- The selected architecture.
- The architecture library entry.
- The user's additional constraints.

It writes a report to:
```
.pi/architect/architect-report.json
```

### Report format

```json
{
  "selectedArchitecture": "modular-monolith",
  "confidence": "high",
  "missingResources": [],
  "reasoning": "Small team, fast time-to-market, strong consistency needs.",
  "skillProfile": {
    "recommendedAgents": ["planner", "implementer", "reviewer-correctness"],
    "forbiddenPatterns": ["microservices", "distributed-transactions"]
  },
  "developmentOrder": [
    "Define module boundaries",
    "Set up shared database schema",
    "Implement core domain",
    "Add integration tests"
  ],
  "feasibility": "feasible",
  "feasibilityReasoning": "The selected architecture matches the drivers and available resources.",
  "techStack": ["TypeScript", "Node.js", "PostgreSQL"],
  "atomicFunctions": ["create-order", "process-payment", "send-notification"],
  "systemOverview": "Small-team web inventory system.",
  "components": [
    { "name": "API", "responsibility": "Handle HTTP requests", "dependencies": ["Database"] },
    { "name": "Database", "responsibility": "Persist data", "dependencies": [] }
  ],
  "interfaces": [
    { "name": "REST API", "type": "external", "description": "HTTP JSON API for clients" }
  ],
  "dataFlow": "Client -> API -> Database",
  "dataModel": "Orders, products, customers",
  "deployment": "Single Node.js process with PostgreSQL",
  "qualityAttributeMapping": [
    { "qualityAttribute": "strong consistency", "decision": "Use ACID transactions in a single database" }
  ],
  "adrs": [
    {
      "id": "0001",
      "title": "Use modular monolith",
      "context": "Small team, fast time-to-market.",
      "decision": "Start with a modular monolith.",
      "consequences": "Simpler deployment; may split later."
    }
  ],
  "constraints": ["Small team", "Fast time-to-market"]
}
```

If `missingResources` is not empty, the main agent handles the fallback.

---

## Step 2.5 — Web search fallback

The Doctor subagent is read-only and does not have web access. If it reports missing resources, the **main agent** uses `SearchWeb` and `FetchURL`.

### Flow

1. Main agent reads `architect-report.json`.
2. If `missingResources` contains items:
   - Search the web for official documentation.
   - Fetch relevant pages.
   - Summarize findings.
   - Save them to `.pi/architecture-library/<topic>.md`.
3. Re-run the Doctor Architect subagent with the new resources.

### Feasibility handling

After the missing-resources loop completes, the main agent checks the report's `feasibility` field before generating agents:

- **feasible:** continue with agent and skill generation.
- **risky:** show `feasibilityReasoning` and ask the user whether to continue.
- **not-feasible:** stop and tell the user the architecture cannot be implemented as described. Ask whether to reconfigure inputs or select a different architecture.

### Confidence handling

- **High:** use the recommendation directly.
- **Medium:** show the user the reasoning and ask for confirmation.
- **Low:** ask the user to provide more context before generating agents.

---

## Step 3 — Generate architecture documents

After the report is accepted, the main agent generates the living architecture documents:

```
.pi/architect/architecture.md
.pi/architect/adrs/0001-<decision-title>.md
```

`architecture.md` contains the full software architecture description: system overview, components, interfaces, data flow, data model, deployment, technology stack, development order, atomic functions, quality attribute mapping, constraints, and links to ADRs.

## Step 4 — Generate project agents and skills

> **Implementation note:** The extension provides the `senai_finalize_architecture` tool. The agent should call it after the report is accepted. The tool reads the profile and report, selects the architecture from the library by id, and generates the docs, agents, and skills with the exact names below.

### Naming convention

```
<project-slug>-<architecture-short>-<role>
```

Examples:
- `inventory-modular-monolith-planner`
- `inventory-modular-monolith-implementer`
- `inventory-modular-monolith-reviewer-correctness`

The generated agents and skills instruct subagents to read `.pi/architect/architecture.md` and the relevant ADRs before acting.

### Generated files

Agents:
```
.pi/agents/<project>-<architecture-id>-planner.md
.pi/agents/<project>-<architecture-id>-implementer.md
.pi/agents/<project>-<architecture-id>-reviewer-correctness.md
.pi/agents/<project>-<architecture-id>-reviewer-security.md
.pi/agents/<project>-<architecture-id>-reviewer-tests.md
```

Skills:
```
.pi/skills/<project>-<architecture-id>-plan/SKILL.md
.pi/skills/<project>-<architecture-id>-implement/SKILL.md
.pi/skills/<project>-<architecture-id>-document/SKILL.md
.pi/skills/<project>-<architecture-id>-deliver/SKILL.md
```

### Agent frontmatter

```markdown
---
name: inventory-modular-monolith-planner
description: Planner for modular monolith inventory web app
tools: read, write
skills: inventory-modular-monolith-plan
---

# inventory-modular-monolith-planner

You are a planner for the inventory modular monolith project.
Follow these architecture rules:
- Use modular monolith with clear domain boundaries.
- Keep deployment as a single unit.
- Use ACID transactions within modules.
- Avoid microservices unless explicitly requested.
```

---

## Step 5 — Validation

After generation, the system runs architecture-specific doctor checks.

Checks include:
- Architecture library has entries.
- Architect inputs config exists and selected files exist.
- Architectural drivers file is valid JSON.
- Architect profile and report are valid JSON.
- `architecture.md` exists in `.pi/architect/`.
- ADRs in `.pi/architect/adrs/` match the report.
- Generated agent files exist with valid frontmatter.
- Generated skill files exist.
- The seven architecture-bound roles map to the generated agents (mapping check; code-review shares the reviewer-correctness agent).
- Each generated agent body references `architecture.md`, the ADRs, and the forbidden patterns, and its skill link resolves (content check).
- No generated file was modified after the report was written (drift check).

These checks are added to the existing `/senai-doctor` command.

---

## Step 6 — User notification

The command ends with a summary:

```
Architecture generated: modular-monolith
Generated agents:
  - inventory-modular-monolith-planner
  - inventory-modular-monolith-implementer
  - inventory-modular-monolith-reviewer-correctness
Generated skills:
  - inventory-modular-monolith-plan
  - inventory-modular-monolith-implement

Next: run /senai-generate-sub-agents to generate the remaining roles. Then make sure files.json and agents_files.json exist (/senai-configure-files, /senai-configure-agents-files), run /senai-doctor to verify, then /senai-plan <mission>.
```

---

## Artifacts

```
.pi/senai/
  architect-inputs.json          # user-selected input documents

.pi/architect/
  architectural-drivers.json     # merged drivers from all inputs
  architect-profile.json         # project profile and selected architecture id
  architect-report.json          # Doctor Architect recommendation
  architecture.md                # full software architecture description
  adrs/                          # architecture decision records
    0001-<decision-title>.md

.IDE_Plans/architect-map/        # per-document driver outputs (temporary)
  <sanitized-path>.json

.pi/agents/
  <project>-<architecture-id>-planner.md
  <project>-<architecture-id>-implementer.md
  ...

.pi/skills/
  <project>-<architecture-id>-plan/SKILL.md
  <project>-<architecture-id>-implement/SKILL.md
  ...

.pi/architecture-library/
  modular-monolith.md
  microservices.md
  event-driven.md
  serverless.md
  layered-architecture.md
  plc-scada.md
  embedded-iot.md
  clean-architecture.md
```

---

## Error handling

| Problem | Action |
|---------|--------|
| Architect inputs not configured | Tell user to run `/senai-configure-architect-inputs`. |
| Selected document missing | Skip with warning, continue with remaining documents. |
| Map subagent fails | Retry once; if still failing, continue with partial results. |
| No architecture matches | Fall back to layered architecture and warn user. |
| Missing resources reported | Main agent searches web, adds to library, re-runs Doctor. |
| Feasibility is risky or not-feasible | Ask the user before continuing. |
| Input documents, document list, or constraints changed since last run | Ask the user whether to re-run the full architecture factory. Re-runs discard stale map files, remove agents/skills from previous architectures, and regenerate the ADR set. |
| Generated agent validation fails | Report errors and stop before using generated agents. |

---

## Pi Extension Mode

When `/senai-generate-architect` runs on a project whose `package.json` imports from `@mariozechner/pi-*` or has a `pi-package` keyword, the factory enters **Pi Extension Mode**:

1. **Detection** — `pi-extension-detector.ts` scores signals from drivers, inputsConfig, package.json dependencies/peerDependencies/keywords/`pi` key, and `.pi/agents/` directory. Confidence >= 0.5 triggers the mode.
2. **Architecture bias** — `selectArchitectureWithContext` adds a +10 × confidence bonus to `pi-architecture` so it wins over general-purpose patterns (layered, monolith, etc.).
3. **Output enrichment** — the generated `architecture.md` includes a "Pi Extension Mandatory Rules" section with 12 rules. Generated agent files include a "Pi Extension Tool Constraints" block listing allowed tools and forbidden patterns. Generated skill files include a "Pi Extension Compliance" section pointing to official Pi docs.
4. **Doctor integration** — `checkPiExtensionConformance` validates that the resulting project follows Pi conventions (peerDependencies coverage, agent/skill frontmatter, presence of `pi-architecture` in the library). `checkLibraryCompleteness` validates the library has at least one entry per required Pi extension domain.

The architecture library itself ships 36 entries (17 application architectures + 10 Pi extension sub-patterns + 6 Pi official specs + 3 Pi-aware project architectures). New entries can be added by dropping a `.md` file with the standard frontmatter into `.pi/architecture-library/` (project overrides the bundled library without forking).

---

## Design principles

1. **User controls inputs.** The agent never guesses which documents matter.
2. **Architecture is driven by requirements.** Documents are read before any architecture choice is made.
3. **Parallelize document reading.** Map-Reduce handles large document sets.
4. **Subagents are read-only.** Only the main agent has web access and file-write control.
5. **Generated agents are project-specific.** Names and rules come from the actual project context.
6. **Doctor validates everything.** Reuse `/senai-doctor` for architecture setup checks.
