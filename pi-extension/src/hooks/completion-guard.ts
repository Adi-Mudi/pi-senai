import * as fs from "node:fs";
import * as path from "node:path";
import { loadState } from "../core/state.js";
import { getArtifactPaths, type StageArtifactPaths } from "../core/paths.js";
import { loadAgentConfig, resolveAgentName } from "../core/agents-config/config.js";
import type { SenaiRole } from "../core/agents-config/suggestions.js";

/** Tools that spawn or resume subagents. */
const SPAWN_TOOLS = new Set(["subagent", "subagent_resume"]);

/** Plan-stage reviewer roles and the artifact each must write. Deterministic
 *  fallback for the task-text extraction below: when the spawn task omits
 *  the artifact path, the completion guard still verifies the role's
 *  artifact (same auto-resume pattern). */
const ROLE_EXPECTED_ARTIFACTS: Partial<Record<SenaiRole, keyof StageArtifactPaths>> = {
  "reviewer-correctness": "reviewCorrectness",
  "reviewer-security": "reviewSecurity",
  "reviewer-tests": "reviewTests",
  "reviewer-architecture": "reviewArchitecture",
};

/** Matches pi-interactive-subagents completion/failure steer messages:
 *  `Sub-agent "<name>" completed (<elapsed>).` / `Sub-agent "<name>" failed ...` */
const COMPLETION_RE = /^Sub-agent "([^"]+)" (completed|failed)\b/;

// In-memory map: subagent name -> artifact paths mentioned in its task text.
// Lost on session restart; worst case the guard stays silent (never blocks).
const expectedArtifacts = new Map<string, string[]>();

/** Extract run-dir artifact paths from a task string. */
export function extractArtifactPaths(taskText: string, runId: string): string[] {
  const runDirRel = path
    .join(".IDE_Plans", "pi-senai", "runs", runId)
    .replace(/\\/g, "/");
  const escaped = runDirRel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`[\\w./-]*${escaped}[\\w./-]*`, "g");
  // Strip trailing dots — a path at the end of a sentence would otherwise
  // swallow the period (".md."). Real artifact names never end in a dot.
  const matches = (taskText.match(re) ?? []).map((m) => m.replace(/\.+$/, ""));
  return Array.from(new Set(matches));
}

/** Called from the tool_call hook for every subagent/subagent_resume call.
 *  Never throws; steps aside on any problem. */
export function recordSpawnArtifacts(
  toolName: string,
  input: Record<string, unknown> | undefined,
  cwd: string,
): void {
  if (!SPAWN_TOOLS.has(toolName)) return;
  try {
    const state = loadState(cwd);
    if (state.currentStage === "none" || state.currentStage === "delivered" || !state.runId) return;
    const name = String(input?.name ?? "").trim();
    const task = String(input?.task ?? "");
    if (!name || !task) return;
    const paths = extractArtifactPaths(task, state.runId);

    // Deterministic fallback: a plan-stage reviewer spawn is expected to
    // write its role's review artifact even when the task text omits the
    // path (e.g. a shortened resume task).
    if (state.currentStage === "planning") {
      const agentName = String(input?.agent ?? "").trim();
      if (agentName) {
        try {
          const config = loadAgentConfig(cwd);
          for (const [role, key] of Object.entries(ROLE_EXPECTED_ARTIFACTS)) {
            if (resolveAgentName(config, role as SenaiRole) === agentName) {
              const expected = getArtifactPaths(cwd, state.runId)[key];
              if (!paths.includes(expected)) paths.push(expected);
            }
          }
        } catch {
          /* config problems → task-text paths only */
        }
      }
    }

    if (paths.length > 0) expectedArtifacts.set(name, paths);
  } catch {
    /* guard stays silent */
  }
}

/** Called from the input hook. When a subagent completion notice arrives
 *  during an active run and its recorded artifact is missing/empty, returns
 *  the text to append. Returns undefined when everything is fine or unknown. */
export function completionWarning(text: string, cwd: string): string | undefined {
  const m = COMPLETION_RE.exec(text);
  if (!m) return undefined;
  const [, name, outcome] = m;
  if (outcome !== "completed") return undefined; // failures already tell the parent to resume
  try {
    const state = loadState(cwd);
    if (state.currentStage === "none" || state.currentStage === "delivered" || !state.runId) {
      return undefined;
    }
    const relPaths = expectedArtifacts.get(name);
    if (!relPaths || relPaths.length === 0) return undefined;
    const missing = relPaths.filter((rel) => {
      try {
        return fs.statSync(path.resolve(cwd, rel)).size === 0;
      } catch {
        return true;
      }
    });
    if (missing.length === 0) return undefined;
    return (
      `\n\n[pi-senai artifact guard] Sub-agent "${name}" reported completed, but these artifact file(s) are missing or empty:\n` +
      missing.map((p) => `  - ${p}`).join("\n") +
      `\nDo NOT treat this sub-agent as done. Resume it now with subagent_resume using the session path in its result message, ` +
      `and tell it to write the file(s) above. Never wait for the user to confirm completion.`
    );
  } catch {
    return undefined;
  }
}

/** Test helper: clear the in-memory spawn record. */
export function resetCompletionGuard(): void {
  expectedArtifacts.clear();
}
