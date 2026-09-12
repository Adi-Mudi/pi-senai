import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { guardSpawnCall } from "./spawn-guard.js";
import { recordSpawnArtifacts } from "./completion-guard.js";
import { guardBrainstormMutation } from "../brainstorm/guard.js";

/**
 * Block subagent spawns that use a bare role/built-in name while a custom
 * agent is mapped for that role — the built-in is read-only and stalls the
 * run. Only active during a senai run; everything else passes through.
 * Also record the artifact paths each spawn is expected to write, so the
 * completion guard below can verify them.
 */
export function registerToolCallHook(pi: ExtensionAPI): void {
	pi.on("tool_call", (event, ctx) => {
		// The runner does not catch handler errors for tool_call — a throw
		// propagates and blocks the tool entirely. Fail safe deliberately:
		// artifact recording is best-effort, and a guard bug must not wedge
		// every tool call in the session.
		try {
			recordSpawnArtifacts(
				event.toolName,
				event.input as Record<string, unknown> | undefined,
				ctx.cwd,
			);
		} catch {
			// Best-effort recording only.
		}
		try {
			// Hard gate: an open new-flow brainstorm makes the project read-only
			// outside its folder. Returns { block, reason } or undefined.
			const mutationBlock = guardBrainstormMutation(
				event.toolName,
				event.input as Record<string, unknown> | undefined,
				ctx.cwd,
			);
			if (mutationBlock) return mutationBlock;
		} catch {
			// Fail open — never wedge edits on a guard bug.
		}
		try {
			return guardSpawnCall(
				event.toolName,
				event.input as Record<string, unknown> | undefined,
				ctx.cwd,
			);
		} catch (err) {
			if (ctx.hasUI) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Spawn guard error (allowing call): ${message}`, "warning");
			}
			return undefined;
		}
	});
}
