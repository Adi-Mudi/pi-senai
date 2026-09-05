import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { cleanupTempFiles } from "../io/atomic-write.js";
import { releaseStaleLockIfHeldByUs, lockInfo, describeHolder } from "../io/lock.js";
import { formatStageStatus, getSenaiDir } from "../core/paths.js";
import { loadState } from "../core/state.js";

/**
 * Per-project defensive recovery on every session_start:
 *   1. Release any lock whose recorded pid is ours (process reuse edge case).
 *   2. Remove orphan `.tmp-*` files left over by a previous session that
 *      crashed between writing the temp file and the atomic rename.
 *   3. Surface the current lock state to the user when a run is active.
 * Runs against `ctx.cwd` so multi-project workspaces get the right cleanup.
 */
export function registerSessionStartHook(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		releaseStaleLockIfHeldByUs(ctx.cwd, process.pid);
		const cleaned = cleanupTempFiles(getSenaiDir(ctx.cwd));
		if (cleaned > 0) {
			console.log(
				`[pi-senai] Cleaned ${cleaned} orphan temp file(s) from a previous session in ${ctx.cwd}.`,
			);
		}
		const state = loadState(ctx.cwd);
		if (state.currentStage === "none") return;
		const lines = [formatStageStatus(state)];
		const holder = lockInfo(ctx.cwd);
		if (holder) {
			lines.push("", `Lock held by ${describeHolder(holder)}.`);
		}
		ctx.ui.notify(lines.join("\n"), "info");
	});
}
