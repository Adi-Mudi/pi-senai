import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { migrateLegacyArchitectState } from "@adi-mudi/pi-chirpi";
import { cleanupTempFiles } from "../io/atomic-write.js";
import { migrateLegacyOrchestraDirs } from "../io/migrate.js";
import { releaseStaleLockIfHeldByUs, lockInfo, describeHolder } from "../io/lock.js";
import { formatStageStatus, getSenaiDir } from "../core/paths.js";
import { loadState } from "../core/state.js";

/**
 * Per-project defensive recovery on every session_start:
 *   0. Run one-time legacy migrations (kept out of the extension factory,
 *      which must stay side-effect free per pi extension guidance).
 *   1. Release any lock whose recorded pid is ours (process reuse edge case).
 *   2. Remove orphan `.tmp-*` files left over by a previous session that
 *      crashed between writing the temp file and the atomic rename.
 *   3. Surface the current lock state to the user when a run is active.
 * Runs against `ctx.cwd` so multi-project workspaces get the right cleanup.
 */
export function registerSessionStartHook(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		const notes: string[] = [];

		const movedArch = migrateLegacyArchitectState(ctx.cwd);
		if (movedArch.length > 0) {
			notes.push(`Migrated ${movedArch.length} architecture file(s) to .pi/architect/.`);
		}
		const migratedDirs = migrateLegacyOrchestraDirs(ctx.cwd);
		if (migratedDirs.length > 0) {
			notes.push(`Migrated legacy directories: ${migratedDirs.join(", ")}`);
		}

		releaseStaleLockIfHeldByUs(ctx.cwd, process.pid);
		const cleaned = cleanupTempFiles(getSenaiDir(ctx.cwd));
		if (cleaned > 0) {
			notes.push(`Cleaned ${cleaned} orphan temp file(s) from a previous session.`);
		}

		if (ctx.hasUI !== false && notes.length > 0) {
			ctx.ui.notify(notes.join("\n"), "info");
		}

		const state = loadState(ctx.cwd);
		// Surface an in-flight brainstorm even when no run stage is active —
		// brainstorms usually run pre-run (stage "none"), so the early return
		// below would otherwise hide them from a resumed session.
		if (state.brainstormRunId && ctx.hasUI !== false) {
			const open = (state.brainstormQuestions ?? []).filter(
				(q) => q.state === "draft" || q.state === "discussing",
			).length;
			ctx.ui.notify(
				`Brainstorm in flight: ${state.brainstormRunId}` +
					(state.missionType ? `\nMission type: ${state.missionType}` : "") +
					(state.missionType === "explore" && state.exploreDecision
						? `\nDecide door: ${state.exploreDecision}`
						: "") +
					`\nUnderstanding confirmed: ${state.understandingConfirmed === true ? "yes" : "no"}` +
					(open > 0 ? `\nOpen questions: ${open}` : "") +
					`\nContinue with /senai-brainstorm or finalize with /senai-brainstorm-approve.`,
				"info",
			);
		}
		if (state.currentStage === "none") return;
		if (ctx.hasUI === false) return;
		const lines = [formatStageStatus(state)];
		const holder = lockInfo(ctx.cwd);
		if (holder) {
			lines.push("", `Lock held by ${describeHolder(holder)}.`);
		}
		ctx.ui.notify(lines.join("\n"), "info");
	});
}
