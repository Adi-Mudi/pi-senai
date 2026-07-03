---
name: orchestra-generate-architect
description: Generate a project-specific architecture agent and skills
---

# Architect Generation

Generate a project-specific architecture agent and matching skills.

## Preconditions

- `.pi/orchestra/architect-inputs.json` exists.
- `.pi/architecture-library/` has architecture reference files.

## Step 1 — Read inputs

Read `.pi/orchestra/architect-inputs.json`.

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
.pi/orchestra/architect-map/<sanitized-path>.json
```

Use `sanitizeDocumentPath` from the extension helpers.

### Concurrency

Run up to **4** ingest subagents in parallel. If there are more than 4 documents, process them in batches.

### Wait and merge

Wait for all map subagents to complete. Then merge their outputs into `.pi/orchestra/architectural-drivers.json`.

The merge must:
- Combine all driver categories.
- Remove duplicate IDs.
- Keep unique uncertainties.

## Step 3 — Gap analysis

Load `.pi/orchestra/architectural-drivers.json`.

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

Create `.pi/orchestra/architect-profile.json`:

```json
{
  "projectName": "<human-readable project name>",
  "projectSlug": "<slug>",
  "selectedArchitecture": "<name>",
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

The subagent writes `.pi/orchestra/architect-report.json`:

```json
{
  "selectedArchitecture": "<name>",
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
  "atomicFunctions": ["..."]
}
```

## Step 7 — Missing resource fallback

Read `.pi/orchestra/architect-report.json`.

If `missingResources` is not empty:
1. Use `SearchWeb` to find official documentation for each missing resource.
2. Use `FetchURL` to download relevant pages.
3. Summarize the findings.
4. Save them as a new `.pi/architecture-library/<topic>.md` file.
5. Re-run the Doctor Architect subagent.

If confidence is `low`, ask the user for more context before generating agents.

## Step 8 — Feasibility check

Read `.pi/orchestra/architect-report.json`.

- If `feasibility` is `not-feasible`: stop and tell the user the architecture is not feasible. Summarize `feasibilityReasoning` and ask whether to reconfigure inputs.
- If `feasibility` is `risky`: show `feasibilityReasoning` and use **AskUserQuestion** to ask if the user wants to continue anyway.
- If `feasibility` is `feasible`: continue.

Only proceed to agent/skill generation after the feasibility check passes.

## Step 9 — Generate agents and skills

Generate project-specific agents in `.pi/agents/`:

```
.pi/agents/<project-slug>-<architecture>-planner.md
.pi/agents/<project-slug>-<architecture>-implementer.md
.pi/agents/<project-slug>-<architecture>-reviewer-correctness.md
.pi/agents/<project-slug>-<architecture>-reviewer-security.md
.pi/agents/<project-slug>-<architecture>-reviewer-tests.md
```

Generate project-specific skills in `skills/`:

```
skills/<project-slug>-<architecture>-plan.md
skills/<project-slug>-<architecture>-implement.md
skills/<project-slug>-<architecture>-document.md
skills/<project-slug>-<architecture>-deliver.md
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

## Step 10 — Notify user

End with a concise summary:

```
Architecture generated: <architecture>
Confidence: <high|medium|low>
Generated agents:
  - <project>-<architecture>-planner
  - <project>-<architecture>-implementer
  ...
Generated skills:
  - <project>-<architecture>-plan
  - <project>-<architecture>-implement
  ...

Next: run /orchestra-doctor to verify, then /orchestra-plan <mission>.
```

## Error handling

- If a map subagent fails, retry once. If it still fails, continue with partial results.
- If no documents are configured, stop and tell the user to run `/orchestra-configure-architect-inputs`.
- If the architecture library is empty, stop and ask the user to add architecture references.
