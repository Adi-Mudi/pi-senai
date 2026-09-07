---
name: pi-coding-agent
domain: pi-extension-project
team-size: small-to-large
complexity: high
best-for-drivers:
  - ai coding agent
  - coding agent cli
  - tui application
  - terminal first agent
  - coding assistant
  - developer tool
  - monorepo fork
not-for-drivers:
  - desktop app
  - web application
  - mobile application
  - non developer audience
source: official-pi-project
---

# Pi Coding Agent — Project Architecture

A project that IS (or forks/extends) a Pi coding agent. The repo is a monorepo with separate packages for the AI layer, agent runtime, CLI/TUI, and shared utilities.

## When to use

- You are building a new AI coding agent CLI inspired by Pi.
- You are forking or extending the Pi codebase.
- You want to ship a TUI-first developer tool with extension support.

## When not to use

- You are building a Pi extension (use `pi-extension-*` instead).
- You are building a generic CLI tool without LLM integration.
- The tool is IDE-based, not terminal-based.

## Core rules

1. Mirror Pi's 4-package layout: `packages/ai`, `packages/agent`, `packages/coding-agent`, `packages/tui`.
2. Keep `ai` provider-agnostic; never import from `coding-agent` in `ai`.
3. Use workspace dependencies (`"*"` ranges) for internal packages.
4. Pin external direct dependencies to exact versions; `.npmrc` `save-exact=true`.
5. Generate `npm-shrinkwrap.json` for the published CLI package.
6. Run `npm run check` (lint + format + type check) before every commit.
7. Use `npm ci --ignore-scripts` in CI.
8. Build standalone binaries via `./scripts/build-binaries.sh --offline-model-data`.
9. Document supply-chain hardening in `CONTRIBUTING.md`.
10. Ship model data offline (no network refresh during release).

## Typical package structure

```
packages/
  ai/                # provider-agnostic LLM API
  agent/             # core agent loop and types
  agent-core/        # agent runtime with tool calling
  coding-agent/      # interactive CLI + extensions
  tui/               # terminal UI library
scripts/
  build-binaries.sh
  release-local.sh
test.sh
pi-test.sh
AGENTS.md            # project-specific rules
CONTRIBUTING.md
```

## Mandatory dependencies

```json
{
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  }
}
```

## Build pipeline

- `npm install --ignore-scripts` to skip lifecycle scripts.
- `npm run build` to refresh model data + build all packages.
- `npm run check` to lint + format + type check.
- `./test.sh` to run tests, skipping LLM-dependent ones without keys.

## Common pitfalls

- **Tight provider coupling** — defeats the `ai` package purpose.
- **Workspace version drift** — internal packages with version ranges.
- **Unpinned direct deps** — same-day releases break the build.
- **Lifecycle scripts in CI** — `npm ci` should always pass `--ignore-scripts`.
- **Online release builds** — release binaries must use offline model data.