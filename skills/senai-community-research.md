---
name: senai-community-research
description: Optional side-channel inside /senai-discussion that gathers web/official/community/similar references for the current mission-brief. Standalone scout, parent-driven, opt-in only.
---

# Community Research Side-Channel

This is an **optional side-channel** inside `/senai-discussion`. It is NOT a new stage. It does NOT fire from `/senai-plan`, `/senai-implement`, `/senai-document`, or `/senai-deliver`. It only runs when the parent LLM decides the discussion needs external references the parent cannot supply from its own knowledge.

## Goal

Bring back 5 trusted, working references that the user can read inside `mission-brief.md` under `## External references`. Stop after that. Do not extend the discussion.

## Three trigger paths (any one fires the scout)

1. **User says a trigger keyword** in the mission string or in any discussion answer:
   - `check community`, `check-in community`, `search community`
   - `check web`, `search web`, `look up online`
   - `official documentation`, `official docs`, `fetch docs`
   - `fetch`, `look up`, `find references`, `research`

2. **Parent decides more info is needed** — the parent is unsure about a topic and cannot answer the user's question from its own knowledge.

3. **User toggles the explicit opt-in** during the AskUserQuestion round.

In all three cases, the parent MUST ask the user which source to use (see Source Picker below). The parent NEVER fires the scout without user source pick.

## Source Picker (AskUserQuestion, exactly 4 options)

> Question: `I am not sure about <topic>. Where should I look for more info?`
>
> Options (each MUST end with `?`):
> - `Web search (general)?`
> - `Official documentation?`
> - `Community (forums / Stack Overflow / GitHub)?`
> - `Similar projects?`

The user picks ONE source. The scout runs once with that source.

## Hard rules

- **Never auto-fire** without user source pick.
- **Never fire on every discussion** — only when a trigger path matches.
- **Never retry more than once** on empty result.
- **Never write outside `.IDE_Plans/pi-senai/`**.
- **Never include license as a filter** — quality (working + trusted) wins.
- **Never write to `mission-brief.md` directly** — go through the scout, which appends `## External references` once.

## Cache short-circuit (hidden from user)

Before firing the scout, check the cache:
- Cache lives at `.IDE_Plans/pi-senai/.cache/community-research/<hash>.json`
- Key = sha256 of `(topic + projectKeywords + source + UTC day)` truncated to 32 chars
- TTL = 24h
- Hit → notify "Cache hit — reusing research from <time>", return cached output, skip the source picker

The cache is transparent to the user. It is an internal performance feature.

## Output schema

The scout returns a `CommunityResearchOutput` object with:
- `source` — one of the 4 constants
- `community` — up to 5 entries (Stack Overflow, GitHub issues, forums)
- `official` — up to 5 entries (official docs)
- `similar` — up to 5 entries (similar projects, no license filter)
- `confidence` — `high` | `medium` | `low` | `cached`
- `queries` — the queries the scout used (audit trail)
- `attempts` — every fetch attempt with timestamp and result count
- `cached` — whether this came from cache
- `ttlExpiresAt` — when this cache entry expires

Each entry has:
- `title`, `url`, `summary` (1 sentence)
- `tier` (1 = most trusted, 8 = least)
- `lastVerified` (ISO timestamp)
- `status` (HTTP status)
- `working` (passed working-result check)

## Quality ranking (for caller display)

| Tier | Source |
|---|---|
| 1 | Official docs from the tool/library author, .gov, .edu |
| 2 | Official RFCs, W3C, IEEE, ISO |
| 3 | GitHub repo of the tool itself |
| 4 | Stack Overflow accepted answers (≥10 votes) |
| 5 | Well-known community blogs |
| 6 | Forum posts, Reddit threads |
| 7 | Wikipedia, comparison sites |
| 8 | Random blog posts |

Display entries sorted by tier (1 first). Random blog posts (tier 8) are kept only when no better source exists.

## Working-result check

The scout marks an entry `working: true` ONLY when:
- HTTP status is 2xx
- Body has ≥1 sentence matching the topic
- For version-sensitive topics (frameworks, libraries), page is ≤2 years old

Failed entries are dropped from user-facing output but logged in the transcript.

## Retry policy

- First attempt: topic-derived query
- If empty: retry once with new keywords (max 3 variations)
- If still empty: return `confidence: "low"` with empty arrays
- Never retry a third time

## Where output lands

1. **Transcript**: `<discussions-dir>/discussion-NN-community-research.md`
   - Run-scoped: `<runDir>/discussions/discussion-NN-community-research.md`
   - Pre-run: `.IDE_Plans/pi-senai/discussions/pre-run/discussion-NN-community-research.md`
2. **Brief section**: appended to `mission-brief.md` as `## External references`
   - Idempotent: if section already exists, skip the append
3. **Cache**: `.IDE_Plans/pi-senai/.cache/community-research/<hash>.json`

## Token + wall-clock caps

- Max 5 entries per category
- Max 1500 tokens output
- Max 30s wall-clock per scout invocation
- Max 50 cache files (FIFO eviction)

## Commands the user may run

- `/senai-discussion "<topic>"` — opens discussion (this skill is loaded when the parent decides to fire the scout)
- `/senai-purge-community-cache` — clears all community-research cache (manual)

## Plan supersede

If the scout's findings reveal the plan needs replacement, follow the same Plan supersede (ADR) pattern as `/senai-discussion`:
1. Write new plan as `plan-vN.md`
2. Add banner to `plan.md` pointing to it
3. Re-run `/senai-approve` as normal

## What is OUT of scope (deferred)

- Wiring into `/senai-plan`, `/senai-implement`, `/senai-document`, `/senai-deliver`
- Multi-source combination in one call
- User-tunable cache TTL
- Auto-retry with source switch
- License filtering on `similar`
- Cross-project cache sharing
