---
name: cqrs
domain: web, api, enterprise, distributed
team-size: medium-to-large
complexity: high
best-for-drivers:
  - high read scalability
  - complex business logic
  - event sourcing
  - different read and write models
  - performance optimization
  - eventual consistency acceptable
not-for-drivers:
  - simple crud
  - small team
  - strong consistency everywhere
  - beginner friendly
  - low operational overhead
source: community
---

# CQRS (Command Query Responsibility Segregation)

A pattern that separates the models and data stores used for commands (writes) from those used for queries (reads).

## When to use

- Read and write workloads have very different scaling needs.
- Complex domain logic benefits from a dedicated write model.
- Read models need to be optimized for specific views.
- Event sourcing is already planned or in use.
- Eventual consistency is acceptable for reads.

## When not to use

- Simple CRUD applications.
- Small teams without distributed systems experience.
- Systems where strong consistency is required for every operation.
- When operational simplicity is more important than read performance.

## Core rules

1. Separate command handlers from query handlers.
2. Use distinct models for writes and reads.
3. Propagate changes from the write side to the read side via events or messaging.
4. Accept eventual consistency between write and read stores.
5. Optimize read models for specific query patterns.
6. Keep commands synchronous and idempotent where possible.

## Typical folder structure

```
src/
  commands/
    handlers/
    models/
  queries/
    handlers/
    models/
  events/
    publishers/
    consumers/
  projections/
```

## Common pitfalls

- **Eventual consistency bugs** — users expect immediate read-after-write.
- **Data synchronization failures** — missed events create stale reads.
- **Over-engineering** — applied to simple systems that do not need it.
- **Duplicate models** — increases maintenance burden.

## Migration path

Start with a single model, then introduce CQRS when:
- Read performance becomes a bottleneck.
- Different teams own read and write optimization.
- Event sourcing is adopted.
