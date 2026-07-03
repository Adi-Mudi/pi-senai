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
  - beginner friendly
  - limited budget
not-for-drivers:
  - large independent teams
  - independent scaling per domain
  - polyglot technology stacks
  - multiple release trains per day
source: community
---

# Modular Monolith

A single deployable application split into well-defined internal modules.

## When to use

- Team size is small to medium (1–15 developers).
- The product is an MVP or early-stage startup.
- Strong consistency across domains is required.
- Deployment must stay simple.
- Budget or operational expertise is limited.
- The team is beginner to intermediate.

## When not to use

- Multiple teams need independent deployment.
- Different domains need different technology stacks.
- One domain needs to scale far beyond others.
- The organization has mature DevOps/SRE practices and needs microservices.

## Core rules

1. Keep the app as a single deployable unit.
2. Divide the codebase into modules by business domain.
3. Each module owns its own data and business logic.
4. Modules communicate through well-defined internal APIs, not direct database access.
5. Use ACID transactions within the monolith.
6. Plan extraction paths so a module can become a service later if needed.

## Typical folder structure

```
src/
  modules/
    users/
      domain/
      application/
      infrastructure/
      interface/
    orders/
      ...
    inventory/
      ...
  shared/
    kernel/
    infrastructure/
```

## Common pitfalls

- **Big ball of mud** — modules share databases and become coupled.
- **Premature extraction** — splitting into microservices before the team is ready.
- **Hidden shared state** — using global helpers that bypass module boundaries.

## Migration path

A mature modular monolith can evolve into microservices by extracting one module at a time when:
- The team grows beyond 10–15 developers.
- One module needs independent scaling.
- Deployment coordination becomes painful.
