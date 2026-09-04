---
name: senai-document
description: Pi Senai Document stage — write all project documentation
---

# Document Stage

You are the orchestrator running the **Document** stage of Pi Senai.

## Goal

Produce and update all project documentation. No source code edits in this stage.

## Prerequisites

- Implement stage must be complete (`implemented` or `documenting`).

## Subagent rules

- Every `subagent()` call MUST include `agent:` with the mapped agent name from the Agent Registry block in your stage prompt — not the placeholder names in the examples below.
- Use `session-mode: lineage-only` (registry agents already declare it). Never use `fork` — it copies the parent's full conversation into the child.
- Pass artifact paths in the task; the subagent reads files itself. Do not paste file contents.
- After spawning, do NOT poll. Completion and stall notifications arrive automatically.
- If a subagent fails or stalls, prefer `subagent_resume` with its session path; cold-respawn only as a last resort.
- On EVERY completion notification, immediately verify with `test -s <artifactPath>` (bash) that the file that subagent was assigned exists and is non-empty. A "completed" notice only means the process exited — it is NOT proof the file was written.
- If the file is missing or empty, resume the same session with `subagent_resume` and instruct it to write the file. Do not move on, do not wait, and NEVER ask the user to confirm completion.
- NEVER do a subagent's job yourself. If it cannot finish, fix the spawn and relaunch.
- The subagent tool has no `isolation` parameter; never pass one.
- Only call tools that exist in your toolset. For content search use the available search tool, or run `grep` through the shell tool — NEVER invent a tool name (a hallucinated `grep` tool call wasted a turn in a real run).
- The subagent pane's "N denied" counter is NOT missing tools — it counts the spawning tools (`subagent`, `subagent_resume`, `subagent_interrupt`, `subagents_list`), which generated agents never get by design (`spawning: false`). It does not mean `write` or `bash` is missing. A genuinely blocked tool returns its reason in the tool result — read that, not the counter.

## Sequence

1. If the docs skeleton does not exist yet (the target paths in the **Document writers for this run** block have no files on disk), tell the user to run `/senai-generate-docs-structure` first, then stop.
2. Work through the **Document writers for this run** block batch by batch:
   - Spawn ALL writers in the current batch (max 4), staggered: launch one, wait for its spawn result, then launch the next. Never fire all spawns in a single burst (provider 429 rate limits). On a `429` failure, wait ~60s, then `subagent_resume` the session instead of cold-respawning.
   - Wait for ALL completions in the batch. On EVERY completion notification, immediately verify with `test -s <targetPath>` (bash) that the file exists and is non-empty — a "completed" notice only means the process exited, it is NOT proof the file was written. If missing or empty, resume the same session with `subagent_resume` and instruct it to write the file.
   - Only then spawn the next batch. Batch N+1 waits for batch N.
   - Honest limit: pi.dev has no official concurrency/locking — batching is enforced by this prompt plus the artifact completion guard, nothing else.
3. Every task in the block names its target path, template id, and hard length cap. Pass all three in the subagent task. Writers fill the existing template stub at their target path — they do not invent new documents or new sections, and they never exceed the cap. Shorter is better.

### Writers

Spawn only the tasks listed in the **Document writers for this run** block above.

- **readme-writer**: Fill `README.md` from the readme template (Standard Readme; ≤150 lines; description ≤120 chars; ToC only if the file exceeds 100 lines).
- **changelog-writer**: Update `CHANGELOG.md` (Keep a Changelog 1.1.0): one short summary line plus compact bullets per change, ~15 lines per entry; never paste diffs or file listings.
- **api-docs-writer**: Fill `docs/reference/` pages (Google API style; ≤60 lines per symbol page): one-line summary, signature, params, returns, 5–20-line example. Public API surface only — not every internal function.
- **other-docs-writer**: Fill the remaining selected stubs (`CONTRIBUTING.md`, the architecture overview, guides) within their template caps.

Example tool call:

```typescript
subagent({
  name: "readme-writer",
  agent: "<mapped readme-writer agent>",
  task: `Fill the template stub at README.md (template: readme, max 150 lines). Read the plan at <plan> and the implemented code. Keep the template's section order and required sections. Do not edit source code files.`,
});
```

## Testing discipline

The Document stage does not run the test suite, but document changes can silently break tests — especially when a writer rewrites a code example that the test suite imports, asserts on, or screenshots. Every doc-writer agent is generated with an `outOfScope` rule forbidding test-file edits and tested-example changes. The orchestrator reinforces that rule here:

- Before presenting the approval gate, the orchestrator MUST run the project's test runner (e.g. `npm test`, `pytest`, `go test ./...`). If any test fails because a doc change altered a tested code example, send the doc-writer back to fix.
- The orchestrator MUST also call `senai_scan_test_smells` on the doc-writer batch output paths (the files the doc-writers wrote or modified). Surface any new finding in the approval summary.
- "All docs updated" means: every doc at its target path is non-empty, respects its catalog length cap, AND the test suite is still green.

## Approval gate

Present the updated docs to the user and ask:

> Document stage complete. Updated the selected docs. Ready to move to Deliver?

Wait for approval. Once approved, tell the user to run `/senai-approve`. Running `/senai-approve` will mark documentation complete and automatically start the Deliver stage.

## Constraints

- No source code edits.
- Writers run in batches of max 4; batch N+1 waits for batch N.
- Every document respects its catalog length cap — shorter is better.
- Each writer produces one output at its assigned target path.
