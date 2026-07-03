---
name: serverless
domain: web, api, cloud, event-processing
team-size: small-to-medium
complexity: medium
best-for-drivers:
  - variable traffic
  - pay per use
  - no server management
  - event triggers
  - rapid scaling
  - small focused functions
not-for-drivers:
  - long running processes
  - predictable high load
  - vendor lock-in concerns
  - strict latency requirements
  - heavy local development
source: community
---

# Serverless / Function-as-a-Service

Code runs in short-lived functions managed by a cloud provider, triggered by HTTP, events, or schedules.

## When to use

- Traffic is variable or spiky.
- You want to pay only for usage.
- You want no server management.
- Workloads are event-driven and short-lived.
- The team is small and wants fast deployment.

## When not to use

- Long-running processes are needed.
- Latency must be very low and predictable.
- Vendor lock-in is a concern.
- Local development and debugging are critical.
- Cost at scale becomes higher than managed servers.

## Core rules

1. Keep functions small and focused on one task.
2. Minimize cold start impact.
3. Use managed services for storage, queues, and databases.
4. Store configuration in environment variables.
5. Design stateless functions.
6. Add retries and idempotency for event triggers.

## Typical structure

```
functions/
  create-order/
  process-payment/
  send-notification/
  generate-report/
shared/
  lib/
  models/
```

## Common pitfalls

- **Cold starts** — slow first response.
- **Vendor lock-in** — hard to migrate later.
- **Distributed complexity** — many small functions are hard to trace.
- **Cost surprises** — high invocation counts.

## Common platforms

- AWS Lambda
- Azure Functions
- Google Cloud Functions
- Cloudflare Workers
