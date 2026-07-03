---
name: space-based
domain: distributed, cloud, high-scale, real-time
team-size: large
complexity: high
best-for-drivers:
  - extremely high scale
  - variable load
  - high availability
  - low latency
  - elastic scaling
  - distributed data grid
  - shared nothing
not-for-drivers:
  - small team
  - simple deployment
  - low operational overhead
  - beginner friendly
  - limited budget
source: community
---

# Space-Based Architecture

A distributed architecture that treats memory and processing as a shared elastic grid, avoiding database bottlenecks by co-locating data and processing.

## When to use

- Extremely high and unpredictable scale.
- Low-latency requirements with variable load.
- High availability and elasticity are critical.
- The system can benefit from an in-memory data grid.
- The team has distributed systems and cloud expertise.

## When not to use

- Small teams or startups.
- Simple applications with modest scale.
- Limited budget for infrastructure.
- Teams without distributed systems experience.
- When a traditional database is sufficient.

## Core rules

1. Distribute processing units across nodes.
2. Use an in-memory data grid for shared state.
3. Replicate data across processing units for availability.
4. Scale processing units horizontally based on load.
5. Avoid centralized databases; use partitioning and replication.
6. Handle node failures transparently.

## Typical folder structure

```
src/
  processing-units/
    pu-a/
    pu-b/
  data-grid/
    space/
    replication/
  virtualized-middleware/
    messaging/
    load-balancer/
  gateway/
```

## Common pitfalls

- **Data consistency complexity** — distributed transactions are hard.
- **Operational expertise required** — needs strong DevOps/SRE.
- **Cost** — in-memory grids and elastic cloud resources are expensive.
- **Overkill** — used before scale actually demands it.

## Migration path

Space-based architecture is usually reached after microservices or event-driven systems when:
- Database contention becomes the bottleneck.
- Elastic scaling is required beyond what traditional storage offers.
