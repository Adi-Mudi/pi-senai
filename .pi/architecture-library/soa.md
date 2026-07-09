---
name: soa
domain: enterprise, api, distributed
team-size: medium-to-large
complexity: medium-to-high
best-for-drivers:
  - enterprise integration
  - legacy system integration
  - reusable services
  - shared business capabilities
  - service bus
  - interoperability
  - governance
not-for-drivers:
  - small team
  - fast time-to-market
  - low operational overhead
  - simple deployment
  - beginner friendly
source: community
---

# Service-Oriented Architecture (SOA)

A design approach where the system is composed of reusable services that communicate through well-defined interfaces, often using an Enterprise Service Bus (ESB).

## When to use

- Large enterprise with many systems to integrate.
- Legacy systems must be exposed as reusable services.
- Strong governance and standardized contracts are required.
- Business capabilities are shared across multiple applications.
- The organization can invest in an integration platform.

## When not to use

- Small teams or startups.
- Fast MVP delivery is the priority.
- The organization lacks integration/platform expertise.
- Simple HTTP/REST APIs are sufficient.

## Core rules

1. Define services around reusable business capabilities.
2. Expose services through well-defined contracts (WSDL, OpenAPI, etc.).
3. Use an Enterprise Service Bus or API gateway for mediation, routing, and transformation.
4. Share schemas and governance policies across services.
5. Prefer coarse-grained services over fine-grained ones.
6. Treat services as products owned by teams.

## Typical folder structure

```
services/
  billing-service/
  inventory-service/
  customer-service/
  integration/
    esb/
    transformers/
  shared/
    contracts/
```

## Common pitfalls

- **ESB as a bottleneck** — central bus becomes a single point of failure.
- **Coarse-grained services** — hard to change and deploy.
- **Shared data models** — create tight coupling between services.
- **Heavy governance** — slows down delivery.

## Migration path

SOA can evolve into microservices by:
- Decomposing coarse services into smaller, independently deployable services.
- Replacing the ESB with lightweight gateways or event buses.
- Moving from shared databases to database-per-service.
