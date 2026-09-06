import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildSenaiCompactionSummary } from "../core/compaction-summary.js";

/**
 * Supply a deterministic compaction summary while a senai run is active,
 * so compaction costs no extra LLM call and run/artifact paths survive.
 */
export function registerSessionBeforeCompactHook(pi: ExtensionAPI): void {
	pi.on("session_before_compact", async (event, ctx) => {
		const summary = buildSenaiCompactionSummary(ctx.cwd);
		if (!summary) return;
		return {
			compaction: {
				summary,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			},
		};
	});
}
