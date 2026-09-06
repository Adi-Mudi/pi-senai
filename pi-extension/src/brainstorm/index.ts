/**
 * Brainstorm Module — Public API (Phases 2-8)
 *
 * Composition root for the /senai-brainstorm command. Re-exports the four
 * brainstorm layers so callers (tests, doctor, future commands) can
 * import everything from one place.
 *
 * Layered architecture:
 *   Layer 1: registry      — agent eligibility filter + topic → specialist match
 *   Layer 2: dispatcher    — read-only tool enforcement + dispatch caps + timeouts
 *   Layer 3: guard         — input + output guards (seed, brief content, paths, count)
 *   Layer 4: audit         — dispatch log written to brainstorm-dispatch.md
 *
 * Wiring into commands/brainstorm.ts is direct (the command imports the
 * helpers it needs from each layer). This file is the convenience surface
 * for tests + future commands.
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

// Layer 1 — Registry (Phase 3)
export {
	type BrainstormEligibleAgent,
	buildRegistryBlock,
	loadBrainstormRegistry,
	matchSpecialist,
	rankSpecialists,
} from "./registry.js";

// Layer 2 — Dispatcher (Phase 4)
export {
	BRAINSTORM_DISPATCH_TIMEOUT_MS,
	DEFAULT_DISPATCH_TOOLS,
	type DispatchPrepResult,
	type DispatchRequest,
	type PreparedDispatch,
	formatPreparedDispatch,
	prepareDispatch,
	resolveRoleForAgent,
} from "./dispatcher.js";

// Layer 4 — Audit (Phase 5)
export {
	AUDIT_LOG_MARKER,
	type AuditSession,
	type AuditSummary,
	type DecisionKind,
	appendDecision,
	buildSummary,
	countBriefSections,
	createAuditSession,
	readAuditLog,
	renderAuditLog,
	renderDecision,
	summarizeDecisions,
	writeAuditLog,
} from "./audit.js";

// Cross-layer helper from core/mission-brief.ts (used by guard + audit).
// Re-exported here so callers only import from one place.
export { validateBriefContent } from "../core/mission-brief.js";
