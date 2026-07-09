---
name: microkernel
domain: desktop, ide, plugin-system, enterprise
team-size: small-to-medium
complexity: medium
best-for-drivers:
  - plugin system
  - extensibility
  - product platform
  - third-party extensions
  - stable core
  - optional features
not-for-drivers:
  - simple web app
  - fast time-to-market
  - low operational overhead
  - homogeneous feature set
source: community
---

# Microkernel Architecture

A pattern with a small core system and a set of plugins or modules that extend its behavior.

## When to use

- The product must support third-party or internal plugins.
- Features need to be loaded and unloaded dynamically.
- The core should remain stable while features evolve rapidly.
- You are building a platform, IDE, browser, or extensible tool.
- Different customers need different subsets of features.

## When not to use

- Simple web applications without plugin requirements.
- Fast MVPs that do not need extensibility.
- Teams without experience designing plugin APIs.
- Systems where all features are always required.

## Core rules

1. Keep the core as small as possible.
2. Expose clear, versioned plugin APIs.
3. Load plugins dynamically or at startup.
4. Isolate plugins so they cannot corrupt the core.
5. Provide lifecycle hooks (init, run, shutdown).
6. Core owns shared resources; plugins request them through APIs.

## Typical folder structure

```
src/
  core/
    kernel.ts
    plugin-api.ts
    lifecycle.ts
  plugins/
    feature-a/
    feature-b/
    third-party/
  shared/
    contracts/
```

## Common pitfalls

- **Bloated core** — too much logic leaks back into the kernel.
- **Unstable plugin API** — frequent breaking changes anger plugin authors.
- **Plugin conflicts** — poorly isolated plugins interfere with each other.
- **Security** — third-party plugins can introduce vulnerabilities.

## Migration path

A monolith can move toward microkernel by:
- Identifying stable core responsibilities.
- Extracting features into plugin modules.
- Defining a plugin API and lifecycle.
