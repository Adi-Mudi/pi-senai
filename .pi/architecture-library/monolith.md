---
name: monolith
domain: web, desktop, api, enterprise
team-size: small
complexity: low
best-for-drivers:
  - small team
  - fast time-to-market
  - simple deployment
  - strong consistency
  - low operational overhead
  - beginner friendly
  - limited budget
  - mvp
  - prototype
not-for-drivers:
  - large independent teams
  - independent scaling per domain
  - polyglot technology stacks
  - multiple release trains per day
  - high availability per component
source: community
---

# Monolith

A single, unified application where all functionality is built, deployed, and scaled as one unit.

## When to use

- Team size is very small (1–5 developers).
- The product is an MVP, prototype, or early-stage startup.
- Strong consistency and simple transactions are required.
- Deployment must stay trivial.
- Budget or operational expertise is limited.
- The team is beginner to intermediate.

## When not to use

- Multiple teams need to deploy independently.
- Different domains need different technology stacks.
- One part of the system needs to scale far beyond the rest.
- The organization needs microservices-level isolation.

## Core rules

1. Build the entire system as a single deployable unit.
2. Share one database unless there is a strong reason to split it.
3. Keep the codebase organized by feature or layer.
4. Prefer function calls over network calls for internal communication.
5. Deploy the whole application together.
6. Monitor the monolith as one service.

## Typical folder structure

```
src/
  features/
    users/
    orders/
    inventory/
  shared/
    infrastructure/
    utils/
  app.ts
```

## Common pitfalls

- **Big ball of mud** — no clear module boundaries.
- **Premature distribution** — splitting into services before the team is ready.
- **Shared global state** — makes reasoning and testing hard.

## Migration path

A monolith can evolve into a modular monolith, and later into microservices, by extracting well-bounded domains when:
- The team grows beyond 5–10 developers.
- One domain needs independent scaling or deployment.
- Deployment coordination becomes painful.
