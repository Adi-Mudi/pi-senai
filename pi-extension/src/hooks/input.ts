import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { completionWarning } from "../completion-guard.js";
import { isRateLimitError, record429 } from "../spawn-cadence.js";

/**
 * Artifact-based completion guard: pi-interactive-subagents reports a
 * subagent "completed" on process exit even when its artifact was never
 * written. Completion notices arrive as extension steer messages, which
 * pass through the input hook. When the recorded artifact is missing or
 * empty, append a resume instruction so the parent never stalls waiting.
 * Also detect rate-limit-style errors in the same steer stream so the
 * adaptive spawn cadence can demote for the rest of this run.
 */
export function registerInputHook(pi: ExtensionAPI): void {
	pi.on("input", (event, ctx) => {
		if (event.source !== "extension") return;
		if (isRateLimitError(event.text)) {
			try {
				record429(ctx.cwd);
			} catch {
				// Best-effort: a cadence write failure must not break the steer.
			}
		}
		const warning = completionWarning(event.text, ctx.cwd);
		if (!warning) return;
		return { action: "transform" as const, text: `${event.text}${warning}` };
	});
}
