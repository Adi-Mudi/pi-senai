import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadState } from "../core/state.js";
import { getArtifactPaths } from "../core/paths.js";
import { NEXT_COMMAND } from "./_commands-constants.js";

export function registerStatusCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-status", {
		description: "Show current senai stage and artifact paths",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			if (state.currentStage === "none") {
				ctx.ui.notify("No active senai run. Use /senai-plan <mission> to start.", "info");
				return;
			}

			const artifacts = state.runId
				? getArtifactPaths(ctx.cwd, state.runId)
				: null;

			const nextCommand = NEXT_COMMAND[state.currentStage];

			const lines = [
				`Stage: ${state.currentStage}`,
				`Mission: ${state.mission}`,
				`Run ID: ${state.runId}`,
				`Started: ${state.startedAt}`,
				`Updated: ${state.updatedAt}`,
			];
			if (artifacts) {
				lines.push(
					``,
					`Artifacts:`,
					`  plan.md: ${artifacts.plan}`,
					`  discussion-notes.md: ${artifacts.discussionNotes}`,
					`  scout-angle_*.md: ${artifacts.scoutAngle1}`,
					`  review-*.md: ${artifacts.reviewCorrectness}`,
					`  security-report.md: ${artifacts.securityReport}`,
					`  deliver-summary.md: ${artifacts.deliverSummary}`,
				);
			}
			if (nextCommand) {
				lines.push(
					``,
					`Next step: run ${nextCommand}`,
				);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
