---
name: layered-architecture
domain: web, desktop, api, enterprise
team-size: any
complexity: low
best-for-drivers:
  - simple crud applications
  - clear separation of concerns
  - beginner friendly
  - fast development
  - small to medium projects
  - familiar enterprise pattern
not-for-drivers:
  - complex domain logic
  - frequent domain changes
  - high testability requirements
  - domain-driven design
source: community
---

# Layered Architecture

Code is organized into horizontal layers: presentation, business logic, data access.

## When to use

- The application is a straightforward CRUD system.
- The team is beginner to intermediate.
- Separation of concerns is more important than domain modeling.
- Fast development is needed.
- The project is small to medium.

## When not to use

- The domain is complex and changes often.
- You need domain-driven design.
- Business logic is spread across many rules and flows.
- Testability of domain rules is critical.

## Core rules

1. Presentation layer depends on business layer.
2. Business layer depends on data layer.
3. Dependencies point inward only.
4. Do not bypass layers.
5. Keep business logic out of the presentation layer.

## Typical structure

```
src/
  presentation/
    controllers/
    views/
  business/
    services/
    dto/
  data/
    repositories/
    models/
```

## Common pitfalls

- **Anemic domain model** — business logic leaks into services.
- **Layer bypassing** — controllers talking directly to repositories.
- **God classes** — layers become giant files over time.

## Variants

- Three-tier architecture
- N-tier architecture
- Onion architecture (more advanced)
