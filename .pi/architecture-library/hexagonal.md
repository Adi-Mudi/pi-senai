---
name: hexagonal
domain: web, desktop, api, enterprise
team-size: small-to-medium
complexity: medium
best-for-drivers:
  - testability
  - portability
  - clean boundaries
  - domain-driven design
  - adapter interchangeability
  - maintainability
  - decoupled dependencies
not-for-drivers:
  - fast prototype
  - simple crud
  - small team without ddd experience
  - low operational overhead
source: community
---

# Hexagonal Architecture (Ports and Adapters)

A pattern that isolates the application core from external concerns by defining explicit ports (interfaces) and adapters (implementations).

## When to use

- Testability is a primary concern.
- The application must adapt to multiple external systems (databases, UIs, APIs).
- The team practices Domain-Driven Design.
- Business logic should survive changes in frameworks and infrastructure.
- You need clear boundaries between domain and delivery mechanisms.

## When not to use

- Very small or throwaway prototypes.
- Simple CRUD applications with stable frameworks.
- Teams unfamiliar with ports/adapters concepts.
- When delivery speed matters more than long-term maintainability.

## Core rules

1. The domain/application core must not depend on frameworks, databases, or UI.
2. Define inbound ports for use cases driven by primary actors.
3. Define outbound ports for secondary actors such as databases and external APIs.
4. Implement adapters outside the core for each external concern.
5. Dependency direction always points inward toward the core.
6. Test the core with in-memory adapters.

## Typical folder structure

```
src/
  domain/
    entities/
    services/
    ports/
  application/
    use-cases/
  adapters/
    inbound/
      web/
      cli/
    outbound/
      database/
      external-api/
```

## Common pitfalls

- **Over-abstraction** — too many ports for simple problems.
- **Leaky infrastructure** — adapters depend on domain details.
- **Package confusion** — unclear placement of ports and adapters.

## Migration path

A layered or modular monolith can be refactored toward hexagonal by:
- Extracting domain logic into a central core.
- Wrapping framework code in adapter implementations.
- Replacing direct dependencies with port interfaces.
