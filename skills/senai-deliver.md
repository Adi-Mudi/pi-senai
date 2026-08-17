---
name: senai-deliver
description: Pi Senai Deliver stage — security audit and package
---

# Deliver Stage

You are the orchestrator running the **Deliver** stage of Pi Senai.

## Goal

Run a final security check and package the result.

## Prerequisites

- Document stage must be complete (`documented` or `delivering`).

## Subagent rules

- Every `subagent()` call MUST include `agent:` with the mapped agent name from the Agent Registry block in your stage prompt — not the placeholder names in the examples below.
- Use `session-mode: lineage-only` (registry agents already declare it). Never use `fork` — it copies the parent's full conversation into the child.
- Pass artifact paths in the task; the subagent reads files itself. Do not paste file contents.
- After spawning, do NOT poll. Completion and stall notifications arrive automatically.
- If a subagent fails or stalls, prefer `subagent_resume` with its session path; cold-respawn only as a last resort.
- NEVER do a subagent's job yourself. If it cannot finish, fix the spawn and relaunch.
- The subagent tool has no `isolation` parameter; never pass one.

## Sequence

```
security-gate ──▶ archive
```

### 1. Security gate

Spawn a security auditor.

```typescript
subagent({
  name: "security-gate",
  agent: "<mapped security-gate agent>",
  task: `Perform a final security audit of the project. Read the plan at <plan>, the implemented code, and docs. Write the security report to <securityReport>. Focus on secrets, injection, auth, and dependency risks. Do not edit source files.`,
});
```

### 2. Archive / package

If the security gate passes, package the deliverable:

- Create a git tag or release summary.
- Write the deliver summary to `<deliverSummary>`.
- Optionally create an archive artifact (zip/tar).

```typescript
subagent({
  name: "archive",
  agent: "<mapped archive agent>",
  task: `Package the final deliverable. Write a deliver summary to <deliverSummary>. Create any archive artifact if appropriate.`,
});
```

## Approval gate

Present the security report and deliver summary to the user:

> Deliver stage complete. Security gate: PASS.
>
> - Security report: `<securityReport>`
> - Deliver summary: `<deliverSummary>`
>
> The full cycle **Plan → Implement → Document → Deliver** is complete.
>
> Run `/senai-approve` to finalize and mark the run as `delivered`.

Wait for final approval. Do not mark the run delivered until the user explicitly approves.

## Constraints

- If security issues are found, stop and ask the user whether to fix or accept risk.
- Do not ship without explicit user approval.
