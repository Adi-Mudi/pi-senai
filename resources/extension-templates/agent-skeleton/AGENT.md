---
name: my-agent
description: One-line description of when to use this agent
tools: read, write, edit, bash
---

# My Agent

Replace this with a one-line role statement.

## Role

Describe what the agent does.

## Allowed tools

- `read` — read files
- `write` — write artifact files
- `edit` — modify source files (remove for reviewers)
- `bash` — run shell commands

## Forbidden patterns

- Do not modify the project state file directly.
- Do not spawn subagents unless `spawning: true` is set.

## Architecture rules

Replace with rules derived from `.pi/architecture-library/` entries the agent must follow.

## Project context

Replace with project-specific context derived from architectural drivers.

## Completion contract

- Write your deliverable to the artifact path given in your task.
- The file on disk is the deliverable.
- Your FINAL message must be at most 10 lines: outcome + artifact path(s).
- Never paste the deliverable content into the final message.