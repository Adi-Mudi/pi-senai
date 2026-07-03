# Architect Sequence — `/orchestra-generate-architect`

This document describes the design and runtime sequence for the `/orchestra-generate-architect` command in Pi Orchestra.

## Goal

Generate a project-specific architecture agent and matching skills by reading the user's requirements documents, extracting architectural drivers, selecting the best architecture, and producing configured agent files.

## Commands

| Command | Purpose |
|---------|---------|
| `/orchestra-configure-architect-inputs` | Select which documents the architect agent reads. |
| `/orchestra-generate-architect` | Run the full architect generation flow. |

---

## Preconditions

Before running `/orchestra-generate-architect`:

1. Pi Orchestra must be configured:
   - `.pi/orchestra/agents.json`
   - `.pi/orchestra/files.json`
   - `.pi/orchestra/agents_files.json`
2. Architect inputs must be configured:
   - `.pi/orchestra/architect-inputs.json`
3. Architecture library should exist:
   - `.pi/architecture-library/*.md`

If architect inputs are missing, the command tells the user to run `/orchestra-configure-architect-inputs` first.

---

## Step 1 — Configure architect inputs

### Command
```
/orchestra-configure-architect-inputs
```

### What it does
1. Scans the project for candidate documents using the existing `files-discovery.ts` scanner.
2. Shows a categorized list editor (`ui/list-editor.ts`) with document type labels.
3. Allows the user to select, deselect, and add custom paths.
4. Allows free-form text input for additional constraints not in any file.
5. Saves the result to `.pi/orchestra/architect-inputs.json`.

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
/orchestra-generate-architect
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
.pi/orchestra/architect-map/<doc-id>.json
```

### Reduce phase

After all map subagents complete, spawn a reducer subagent:

```markdown
---
name: architect-driver-reducer
description: Merges per-document architectural drivers into one file
tools: read, write
---

Read all files in .pi/orchestra/architect-map/.
Merge them into one architectural-drivers.json file.
Remove duplicates.
Resolve conflicts by keeping the most specific statement.
List all uncertainties.
```

Output:
```
.pi/orchestra/architectural-drivers.json
```

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
.pi/orchestra/architect-profile.json
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
.pi/orchestra/architect-report.json
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
  "atomicFunctions": ["create-order", "process-payment", "send-notification"]
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

## Step 3 — Generate project agents and skills

### Naming convention

```
<project-slug>-<architecture-short>-<role>
```

Examples:
- `inventory-modular-monolith-planner`
- `factory-plc-scada-worker`
- `ecommerce-microservices-reviewer`

### Generated files

Agents:
```
.pi/agents/<project>-<architecture>-planner.md
.pi/agents/<project>-<architecture>-implementer.md
.pi/agents/<project>-<architecture>-reviewer-correctness.md
.pi/agents/<project>-<architecture>-reviewer-security.md
.pi/agents/<project>-<architecture>-reviewer-tests.md
```

Skills:
```
skills/<project>-<architecture>-plan.md
skills/<project>-<architecture>-implement.md
skills/<project>-<architecture>-document.md
skills/<project>-<architecture>-deliver.md
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

## Step 4 — Validation

After generation, the system runs architecture-specific doctor checks.

Checks include:
- Architecture library has entries.
- Architect inputs config exists and selected files exist.
- Architectural drivers file is valid JSON.
- Architect report is valid JSON.
- Generated agent files have valid frontmatter.
- Generated skill files exist.

These checks are added to the existing `/orchestra-doctor` command.

---

## Step 5 — User notification

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

Next: run /orchestra-doctor to verify, then /orchestra-plan <mission>.
```

---

## Artifacts

```
.pi/orchestra/
  architect-inputs.json          # user-selected input documents
  architectural-drivers.json     # merged drivers from all inputs
  architect-profile.json         # user answers to gap questions
  architect-report.json          # Doctor Architect recommendation
  architect-map/                 # per-document driver outputs
    <doc-id>.json

.pi/agents/
  <project>-<architecture>-planner.md
  <project>-<architecture>-implementer.md
  ...

skills/
  <project>-<architecture>-plan.md
  <project>-<architecture>-implement.md
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
| Architect inputs not configured | Tell user to run `/orchestra-configure-architect-inputs`. |
| Selected document missing | Skip with warning, continue with remaining documents. |
| Map subagent fails | Retry once; if still failing, continue with partial results. |
| No architecture matches | Fall back to layered architecture and warn user. |
| Missing resources reported | Main agent searches web, adds to library, re-runs Doctor. |
| Feasibility is risky or not-feasible | Ask the user before continuing. |
| Generated agent validation fails | Report errors and stop before using generated agents. |

---

## Design principles

1. **User controls inputs.** The agent never guesses which documents matter.
2. **Architecture is driven by requirements.** Documents are read before any architecture choice is made.
3. **Parallelize document reading.** Map-Reduce handles large document sets.
4. **Subagents are read-only.** Only the main agent has web access and file-write control.
5. **Generated agents are project-specific.** Names and rules come from the actual project context.
6. **Doctor validates everything.** Reuse `/orchestra-doctor` for architecture setup checks.
