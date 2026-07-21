---
name: senai-generate-architect
description: Generate a project-specific architecture agent and skills
---

# Architect Generation

Generate a project-specific architecture agent and matching skills.

## Preconditions

- `.pi/senai/architect-inputs.json` exists.
- `.pi/architecture-library/` has architecture reference files.

## Step 1 — Read inputs

Read `.pi/senai/architect-inputs.json`.

Note:
- `documents` — files the user selected.
- `additionalConstraints` — user-provided requirements not in files.

## Step 2 — Map-Reduce document ingestion

For each document in `architect-inputs.json`, spawn an **architect-document-ingest** subagent.

### Subagent instructions

```
Read the document at <path>.
Extract architectural drivers and write them to <outputPath>.

Output JSON format:
{
  "document": "<path>",
  "documentType": "<type>",
  "functionalRequirements": [{ "id": "FR-1", "description": "...", "source": "<path>" }],
  "qualityAttributes": [{ "id": "QA-1", "category": "scalability", "target": "...", "description": "...", "source": "<path>" }],
  "constraints": [{ "id": "C-1", "category": "budget", "description": "...", "source": "<path>" }],
  "technicalConcerns": [{ "id": "TC-1", "description": "...", "source": "<path>" }],
  "uncertainties": ["..."]
}
```

### Map output paths

Write each map output to:
```
.IDE_Plans/architect-map/<sanitized-path>.json
```

Use `sanitizeDocumentPath` from the extension helpers.

### Concurrency

Run up to **4** ingest subagents in parallel. If there are more than 4 documents, process them in batches.

### Wait and merge

Wait for all map subagents to complete. Then call the `senai_merge_architect_drivers` tool to merge the map outputs into `.pi/architect/architectural-drivers.json`.

Do not write the merged file by hand. The tool:
- Combines all driver categories.
- Removes duplicate IDs.
- Keeps unique uncertainties.
- Merges only map outputs for the currently configured documents.
- Deletes stale map files left by removed or renamed documents.
- Cleans up stale intermediate files from `.pi/senai/`.

## Step 3 — Gap analysis

Load `.pi/architect/architectural-drivers.json`.

Check for missing critical drivers:
- Functional requirements
- Scale / performance targets
- Deployment target (cloud, on-premise, offline, edge)
- Project type (web, mobile, desktop, PLC, IoT)

For each missing critical driver, use **AskUserQuestion** to ask the user.

Example questions:
- "How many developers will work on this project?"
- "Is this a web app, mobile app, desktop app, PLC system, IoT device, or something else?"
- "What is the expected number of concurrent users or requests per second?"
- "Will this run in the cloud, on-premise, offline, or on edge devices?"

After receiving answers, append them to the drivers file and save.

## Step 4 — Save profile

Create `.pi/architect/architect-profile.json`:

```json
{
  "projectName": "<human-readable project name>",
  "projectSlug": "<slug>",
  "selectedArchitecture": "<architecture-id>",
  "drivers": { ... },
  "additionalConstraints": [ ... ]
}
```

Use the project name from the closest `package.json`, folder name, or ask the user if unclear.

## Step 5 — Select architecture

Read all files in `.pi/architecture-library/`.

Score each architecture by matching its `best-for-drivers` against the driver text.
Penalize architectures whose `not-for-drivers` match.

Prefer simpler architectures when several choices score similarly.

Pick the highest-scoring architecture.

If no architecture scores well, default to `layered-architecture` and warn the user.

## Step 6 — Doctor Architect subagent

Spawn a **doctor-architect** subagent with:
- The merged drivers.
- The selected architecture.
- The architecture library entry.
- The additional constraints from the user.

The subagent writes `.pi/architect/architect-report.json`:

```json
{
  "selectedArchitecture": "<architecture-id>",
  "confidence": "high|medium|low",
  "missingResources": [],
  "reasoning": "...",
  "skillProfile": {
    "recommendedAgents": ["planner", "implementer", "reviewer-correctness"],
    "forbiddenPatterns": ["..."]
  },
  "developmentOrder": ["..."],
  "feasibility": "feasible|risky|not-feasible",
  "feasibilityReasoning": "...",
  "techStack": ["..."],
  "atomicFunctions": ["..."],
  "systemOverview": "...",
  "components": [
    { "name": "...", "responsibility": "...", "dependencies": ["..."] }
  ],
  "interfaces": [
    { "name": "...", "type": "internal|external", "description": "..." }
  ],
  "dataFlow": "...",
  "dataModel": "...",
  "deployment": "...",
  "qualityAttributeMapping": [
    { "qualityAttribute": "...", "decision": "..." }
  ],
  "adrs": [
    { "id": "0001", "title": "...", "context": "...", "decision": "...", "consequences": "..." }
  ],
  "constraints": ["..."]
}
```

## Step 7 — Missing resource fallback

Read `.pi/architect/architect-report.json`.

If `missingResources` is not empty:
1. Use `SearchWeb` to find official documentation for each missing resource.
2. Use `FetchURL` to download relevant pages.
3. Summarize the findings.
4. Save them as a new `.pi/architecture-library/<topic>.md` file.
5. Re-run the Doctor Architect subagent.

If confidence is `low`, ask the user for more context before generating agents.

## Step 8 — Feasibility check

Read `.pi/architect/architect-report.json`.

- If `feasibility` is `not-feasible`: stop and tell the user the architecture is not feasible. Summarize `feasibilityReasoning` and ask whether to reconfigure inputs.
- If `feasibility` is `risky`: show `feasibilityReasoning` and use **AskUserQuestion** to ask if the user wants to continue anyway.
- If `feasibility` is `feasible`: continue.

Only proceed to agent/skill generation after the feasibility check passes.

## Step 9 — Generate architecture documents

Read `.pi/architect/architect-report.json`.

Generate the living architecture documents:

```
.pi/architect/architecture.md
.pi/architect/adrs/0001-<decision-title>.md
```

`architecture.md` must include:
- System overview
- Components and responsibilities
- Interfaces and communication patterns
- Data flow
- Data model
- Deployment
- Technology stack
- Development order
- Atomic functions
- Quality attribute mapping
- Constraints
- Links to ADRs

## Step 10 — Generate agents and skills

Call the `senai_finalize_architecture` tool. It reads the profile and report, selects the architecture from the library by id, removes agents and skills left over from previous architecture runs, and generates the exact files below. The ADR set is regenerated to match the current report.

Generate project-specific agents in `.pi/agents/`:

```
.pi/agents/<project-slug>-<architecture-id>-planner.md
.pi/agents/<project-slug>-<architecture-id>-implementer.md
.pi/agents/<project-slug>-<architecture-id>-reviewer-correctness.md
.pi/agents/<project-slug>-<architecture-id>-reviewer-security.md
.pi/agents/<project-slug>-<architecture-id>-reviewer-tests.md
```

Generate project-specific skills in `.pi/skills/`:

```
.pi/skills/<project-slug>-<architecture-id>-plan/SKILL.md
.pi/skills/<project-slug>-<architecture-id>-implement/SKILL.md
.pi/skills/<project-slug>-<architecture-id>-document/SKILL.md
.pi/skills/<project-slug>-<architecture-id>-deliver/SKILL.md
```

Agent frontmatter must include:
- `name`
- `description`
- `tools`
- `skills`

Agent body must include:
- Architecture name.
- Key architecture rules from the library.
- Project context from drivers.
- Forbidden patterns.
- A reference to read `.pi/architect/architecture.md` and relevant ADRs before acting.

## Step 11 — Notify user

End with a concise summary:

```
Architecture generated: <architecture>
Confidence: <high|medium|low>
Generated agents:
  - <project>-<architecture-id>-planner
  - <project>-<architecture-id>-implementer
  ...
Generated skills:
  - <project>-<architecture-id>-plan
  - <project>-<architecture-id>-implement
  ...

Next: run /senai-generate-sub-agents to generate the remaining roles. Then make sure files.json and agents_files.json exist (/senai-configure-files, /senai-configure-agents-files), run /senai-doctor to verify, then /senai-plan <mission>.
```

## Error handling

- If a map subagent fails, retry once. If it still fails, continue with partial results.
- If no documents are configured, stop and tell the user to run `/senai-configure-architect-inputs`.
- If the architecture library is empty, stop and ask the user to add architecture references.
