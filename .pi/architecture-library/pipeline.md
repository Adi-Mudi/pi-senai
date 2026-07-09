---
name: pipeline
domain: data-processing, batch, etl, enterprise
team-size: small-to-medium
complexity: low-to-medium
best-for-drivers:
  - data processing
  - batch processing
  - etl
  - stream processing
  - predictable workflow
  - sequential stages
  - data transformation
not-for-drivers:
  - interactive user interface
  - low latency request-response
  - complex branching logic
  - real-time collaboration
source: community
---

# Pipeline Architecture

A pattern where data flows through a sequence of processing stages, each performing a specific transformation or action.

## When to use

- The workload is data transformation or processing.
- Steps can be clearly separated into stages.
- Output of one stage naturally feeds into the next.
- Batch, ETL, or stream processing is the main concern.
- Teams want to add, remove, or reorder stages independently.

## When not to use

- Interactive applications with low-latency user requests.
- Workflows with complex conditional branching.
- Systems where stages need bidirectional communication.
- Real-time collaboration features.

## Core rules

1. Decompose processing into discrete stages.
2. Each stage has a single responsibility.
3. Pass data between stages through well-defined interfaces.
4. Stages should be stateless or store state externally.
5. Allow stages to be added, removed, or reordered without rewriting the whole pipeline.
6. Monitor throughput and errors per stage.

## Typical folder structure

```
src/
  stages/
    ingest/
    validate/
    transform/
    enrich/
    output/
  pipeline/
    runner.ts
  shared/
    models/
```

## Common pitfalls

- **Tight coupling between stages** — hard to change order or add stages.
- **Shared mutable state** — makes debugging difficult.
- **Ignoring backpressure** — downstream stages overwhelmed by upstream throughput.
- **Synchronous only** — missing opportunities for parallel stage execution.

## Migration path

A monolithic data processor can become a pipeline by:
- Identifying natural transformation boundaries.
- Extracting each transformation into a stage.
- Introducing a runner that manages stage ordering and data flow.
