import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { guardSpawnCall } from "./spawn-guard.js";
import { recordSpawnArtifacts } from "./completion-guard.js";

/**
 * Block subagent spawns that use a bare role/built-in name while a custom
 * agent is mapped for that role — the built-in is read-only and stalls the
 * run. Only active during a senai run; everything else passes through.
 * Also record the artifact paths each spawn is expected to write, so the
 * completion guard below can verify them.
 */
export function registerToolCallHook(pi: ExtensionAPI): void {
	pi.on("tool_call", (event, ctx) => {
		recordSpawnArtifacts(
			event.toolName,
			event.input as Record<string, unknown> | undefined,
			ctx.cwd,
		);
		return guardSpawnCall(
			event.toolName,
			event.input as Record<string, unknown> | undefined,
			ctx.cwd,
		);
	});
}
