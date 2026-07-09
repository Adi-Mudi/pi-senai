---
name: event-driven
domain: web, api, iot, distributed
team-size: medium-to-large
complexity: medium-to-high
best-for-drivers:
  - asynchronous workflows
  - loose coupling
  - real-time updates
  - high throughput
  - eventual consistency acceptable
  - multiple consumers per event
not-for-drivers:
  - strong consistency required
  - simple request response
  - small team without messaging experience
  - debugging simplicity
source: community
---

# Event-Driven Architecture

Components communicate by producing and consuming events through a message broker or event bus.

## When to use

- Workflows are naturally asynchronous.
- Multiple services or components must react to the same change.
- Real-time notifications or streaming are required.
- Loose coupling between producers and consumers is important.
- High throughput is needed.
- Eventual consistency is acceptable.

## When not to use

- Strong immediate consistency is required.
- The workflow is simple request/response.
- The team has no experience with message brokers.
- Debugging distributed event flows is a concern.

## Core rules

1. Events represent facts, not commands.
2. Producers do not know who consumes their events.
3. Consumers are independent and idempotent.
4. Use a reliable message broker (Kafka, RabbitMQ, SNS/SQS, NATS).
5. Track event schemas and versioning.
6. Handle failures with retries, dead-letter queues, and observability.

## Typical structure

```
src/
  events/
    producers/
    consumers/
    schemas/
  services/
    order-service/
    notification-service/
    analytics-service/
```

## Common pitfalls

- **Event overload** — emitting too many fine-grained events.
- **Hidden coupling** — consumers depending on event order.
- **No dead-letter handling** — lost events during failures.
- **Schema drift** — consumers break when event shape changes.

## Often combined with

- Microservices
- CQRS
- Event sourcing
