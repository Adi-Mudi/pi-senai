---
name: microservices
domain: web, api, cloud
team-size: large
complexity: high
best-for-drivers:
  - large independent teams
  - independent scaling per domain
  - polyglot technology stacks
  - multiple deployments per day
  - high availability
  - fault isolation
  - mature devops
not-for-drivers:
  - small team
  - fast time-to-market
  - simple deployment
  - strong consistency
  - low operational overhead
  - beginner friendly
  - limited budget
source: community
---

# Microservices

A system of small, independently deployable services that communicate over a network.

## When to use

- Team size is large (15+ developers) organized around domains.
- Different domains need independent scaling.
- Different teams need independent deployment.
- The system requires high availability and fault isolation.
- The organization has strong DevOps, SRE, and observability practices.
- The product is in production and growing fast.

## When not to use

- The team is small.
- The product is an MVP or prototype.
- Deployment simplicity is more important than scaling flexibility.
- The team lacks distributed systems experience.
- Strong cross-service consistency is required.

## Core rules

1. Each service owns one business capability.
2. Each service has its own data store.
3. Services communicate asynchronously where possible (events, messages).
4. Use synchronous calls only for simple request/response paths.
5. Design for failure: retries, circuit breakers, timeouts.
6. Each service is independently deployable and testable.
7. Observability is mandatory: logging, metrics, tracing.

## Typical structure per service

```
services/
  users-service/
    src/
      api/
      application/
      domain/
      infrastructure/
    tests/
    Dockerfile
    package.json
  orders-service/
    ...
```

## Common pitfalls

- **Distributed monolith** — services are separate but tightly coupled.
- **Shared database** — breaks service boundaries.
- **Synchronous chains** — create latency and cascading failures.
- **Too many services** — operational overhead exceeds value.

## Patterns to know

- API Gateway
- Event Sourcing / CQRS
- Saga pattern for distributed transactions
- Circuit breaker
- Service discovery
