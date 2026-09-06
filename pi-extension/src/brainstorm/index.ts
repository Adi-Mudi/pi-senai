/**
 * Brainstorm Module — Public API (Phase 2-8)
 *
 * Layered architecture for the /senai-brainstorm command:
 *
 *   Layer 1: registry      — agent eligibility filter + topic → specialist match
 *   Layer 2: dispatcher    — read-only tool enforcement + dispatch caps + timeouts
 *   Layer 3: guard         — input + output guards (seed, brief content, paths, count)
 *   Layer 4: audit         — dispatch log written to brainstorm-dispatch.md
 *
 * Each layer is a standalone module; this file is the composition root that
 * re-exports them so callers can import from one place.
 *
 * Phase 2 wires guard.ts. Phases 3-7 add registry, dispatcher, audit, and
 * the doctor integration. Phase 8 wires everything into commands/brainstorm.ts.
 */

// Layer 3 — Guard (Phase 2)
export {
	BRAINSTORM_DISPATCH_CAP,
	type GuardResult,
	guardArtifactPath,
	guardBriefContent,
	guardDispatchCount,
	guardSeedInput,
} from "./guard.js";

// Future re-exports land here as each phase lands:
// Phase 3: export * from "./registry.js";
// Phase 4: export * from "./dispatcher.js";
// Phase 5: export * from "./audit.js";
