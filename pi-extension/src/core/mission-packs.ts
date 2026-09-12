import type { MissionType, ScanType } from "./state.js";

/** Per-mission-type lifecycle pack: the strict structure, gates, and rules
 *  that apply on top of the shared brainstorm trunk. Lives in Layer 0 so
 *  both core/mission-brief.ts and brainstorm/* can read it (core may not
 *  import from brainstorm). */
export interface MissionPack {
  /** Extra brief sections mandatory for this type (on top of the base 6). */
  readonly extraBriefSections: readonly string[];
  /** Extra coverage-check rows shown at [7] for this type. */
  readonly extraCoverageRows: readonly string[];
  /** Scan types that may be auto-added by pack questions (not defaults). */
  readonly conditionalScans: readonly { scan: ScanType; trigger: string }[];
  /** Hard approve gates for this type (ids evaluated by guard.ts). */
  readonly approveGates: readonly string[];
  /** Implement-stage rule ids enforced for this type. */
  readonly implementRules: readonly string[];
  /** NEVER list shown in skills and implement prompt. */
  readonly neverRules: readonly string[];
}

/** Bugfix pack: the industry-standard bug-fix flow (reproduce -> root cause
 *  -> failing regression test -> smallest fix -> related tests), enforced
 *  with hard gates. STRICT — other types keep the shared trunk behavior. */
export const BUGFIX_PACK: MissionPack = {
  extraBriefSections: [
    "## Reproduction steps",
    "## Expected vs actual",
    "## Root cause",
    "## Regression test plan",
  ],
  extraCoverageRows: ["Reproduction steps", "Regression test plan"],
  conditionalScans: [
    { scan: "community", trigger: "error originates from a library/framework/dependency" },
  ],
  approveGates: [
    "bugfix-repro-steps-filled",
    "bugfix-expected-vs-actual-filled",
    "bugfix-root-cause-filled",
    "bugfix-regression-test-plan-filled",
  ],
  implementRules: ["failing-test-first", "smallest-fix", "run-related-tests"],
  neverRules: [
    "Never delete a failing test to make the suite green",
    "Never weaken assertions to make a test pass",
    "Never swallow or hide an error instead of fixing the root cause",
    "Never fix what you cannot reproduce",
  ],
};

/** No-op pack for mission types that keep the shared trunk behavior. */
export const EMPTY_PACK: MissionPack = {
  extraBriefSections: [],
  extraCoverageRows: [],
  conditionalScans: [],
  approveGates: [],
  implementRules: [],
  neverRules: [],
};

export const MISSION_PACKS: Record<MissionType, MissionPack> = {
  bugfix: BUGFIX_PACK,
  feature: EMPTY_PACK,
  upgrade: EMPTY_PACK,
  explore: EMPTY_PACK,
  docs: EMPTY_PACK,
  test: EMPTY_PACK,
};

/** Pack lookup with a safe fallback: an undefined type (legacy session)
 *  gets the empty pack so nothing changes for non-typed briefs. */
export function getMissionPack(type: MissionType | undefined): MissionPack {
  return (type && MISSION_PACKS[type]) || EMPTY_PACK;
}
