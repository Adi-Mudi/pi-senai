import * as fs from "node:fs";
import * as path from "node:path";
import { loadState } from "./state.js";

/** Tools that spawn or resume subagents. */
const SPAWN_TOOLS = new Set(["subagent", "subagent_resume"]);

/** Matches pi-interactive-subagents completion/failure steer messages:
 *  `Sub-agent "<name>" completed (<elapsed>).` / `Sub-agent "<name>" failed ...` */
const COMPLETION_RE = /^Sub-agent "([^"]+)" (completed|failed)\b/;

// In-memory map: subagent name -> artifact paths mentioned in its task text.
// Lost on session restart; worst case the guard stays silent (never blocks).
const expectedArtifacts = new Map<string, string[]>();

/** Extract run-dir artifact paths from a task string. */
export function extractArtifactPaths(taskText: string, runId: string): string[] {
  const runDirRel = path
    .join(".IDE_Plans", "senai", "runs", runId)
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
