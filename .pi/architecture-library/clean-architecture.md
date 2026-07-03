---
name: clean-architecture
domain: web, desktop, api, enterprise
team-size: small-to-large
complexity: medium
best-for-drivers:
  - testability
  - maintainability
  - domain-driven design
  - separation of concerns
  - long term projects
  - intermediate to advanced teams
not-for-drivers:
  - rapid prototype
  - very small simple project
  - beginner team
  - fast time-to-market over quality
source: community
---

# Clean Architecture

Dependencies point inward toward the domain. Frameworks, UI, and databases are outer layers.

## When to use

- Testability is a top priority.
- The project will live for years.
- Business rules change often.
- The team understands dependency inversion.
- You want to delay framework decisions.

## When not to use

- The project is a quick prototype.
- The team is beginner-level.
- The domain is trivial CRUD.
- Time-to-market is more important than maintainability.

## Core rules

1. Entities contain enterprise-wide business rules.
2. Use cases contain application-specific business rules.
3. Interface adapters convert data for frameworks and devices.
4. Frameworks and drivers are the outer layer.
5. Dependencies point inward only.
6. Use dependency injection to connect layers.

## Typical structure

```
src/
  domain/
    entities/
    value-objects/
  usecases/
    ports/
    services/
  interface-adapters/
    controllers/
    presenters/
    repositories/
  frameworks/
    web/
    db/
    external-services/
```

## Common pitfalls

- **Over-engineering** — too many layers for a simple app.
- **Leaky abstractions** — framework details seep into use cases.
- **Anemic entities** — entities become data bags with no behavior.

## Related patterns

- Hexagonal architecture (ports and adapters)
- Onion architecture
- Domain-Driven Design
