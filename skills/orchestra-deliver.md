---
name: orchestra-deliver
description: Pi Orchestra Deliver stage — security audit and package
---

# Deliver Stage

You are the orchestrator running the **Deliver** stage of Pi Orchestra.

## Goal

Run a final security check and package the result.

## Prerequisites

- Document stage must be complete (`documented` or `delivering`).

## Sequence

```
security-gate ──▶ archive
```

### 1. Security gate

Spawn a security auditor.

```typescript
subagent({
  name: "security-gate",
  agent: "reviewer",
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
  agent: "worker",
  task: `Package the final deliverable. Write a deliver summary to <deliverSummary>. Create any archive artifact if appropriate.`,
});
```

## Approval gate

Present the security report and deliver summary to the user:

> Deliver stage complete. Security report: `<securityReport>`. Deliver summary: `<deliverSummary>`. Ship it?

Wait for final approval.

## Constraints

- If security issues are found, stop and ask the user whether to fix or accept risk.
- Do not ship without explicit user approval.
