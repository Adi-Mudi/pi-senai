// ============================================================================
// Pi-Senai layered architecture
// (mirrors Pi's own core → modes → cli pattern from docs/development.md)
// ============================================================================
//
// This file documents the dependency order between folders in src/.
// It is NOT a re-export barrel: each layer keeps its own index.ts (or
// per-file imports). The composition root is src/index.ts (45 lines,
// wiring only) and src/commands/index.ts (~90 lines, register* calls).
//
// ------------------------------------------------------------------------
// Layer 0 — Domain primitives (no other layer depends on this one)
// ------------------------------------------------------------------------
//   core/        state, paths, mission-brief, compaction-summary
//   io/          atomic-write, project lock, legacy migration
//
// ------------------------------------------------------------------------
// Layer 1 — Stage logic (depends only on Layer 0)
// ------------------------------------------------------------------------
//   architect/   architecture factory + library + detector + library-suggester
//   doctor/      diagnostic checks (runstate, config, agents, architecture, env, docs)
//   docs-factory/  doc templates, selection, ingestion
//   implement/   implement-stage signals + discipline scanner
//   scouts/      community + web research scouts
//   brainstorm/  registry, dispatcher, guard, audit
//
// ------------------------------------------------------------------------
// Layer 2 — Presentation (depends on Layer 0 + 1)
// ------------------------------------------------------------------------
//   agents/      sub-agent discovery, registry, generator, files discovery
//   ui/          list-editor, role-picker, simple-picker
//   hooks/       Pi lifecycle event handlers (one file per event)
//
// ------------------------------------------------------------------------
// Layer 3 — Composition root (depends on everything below)
// ------------------------------------------------------------------------
//   commands/    18 slash commands + shared helpers
//
// ============================================================================
// Dependency rule: a file in layer N may import from any layer < N.
// Files in the same layer may import each other freely.
// The composition root (src/index.ts) is wiring only — no business logic.
// ============================================================================
