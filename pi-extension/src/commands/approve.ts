import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { advanceStage, loadState } from "../core/state.js";
import { STAGE_TRANSITIONS } from "../core/paths.js";
import { buildStagePrompt } from "../prompt.js";
import { recordCleanRun } from "../implement/cadence.js";
import { withRunLock, describeHolder } from "../io/lock.js";
import { collectImplementSignals, formatImplementSignals, signalsBlockAdvance } from "../implement/signals.js";
import {
	COMPLETED_STAGE_ARTIFACT,
	listMissingStageArtifacts,
} from "./_helpers.js";
import {
	NEXT_COMMAND,
	STAGE_COMMANDS,
	STAGE_SKILL,
} from "./_commands-constants.js";
import { runSimpleConfirm } from "../ui/simple-picker.js";

export function registerApproveCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-approve", {
		description: "Approve the current stage and run the next stage automatically",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			if (state.currentStage === "none") {
				ctx.ui.notify("No active senai run. Start with /senai-plan <mission>", "warning");
				return;
			}
			if (state.currentStage === "delivered") {
				ctx.ui.notify("Run is already delivered.", "info");
				return;
			}

			const nextStage = STAGE_TRANSITIONS[state.currentStage][0];
			if (!nextStage) {
				ctx.ui.notify(`No next stage from '${state.currentStage}'.`, "info");
				return;
			}

			const confirmed = await runSimpleConfirm(
				ctx,
				"Approve stage",
				`Approve '${state.currentStage}' and run the next stage?`,
			);
			if (!confirmed) return;

			// Acquire the project-wide run lock for the duration of the mutation.
			let pendingSignalSummary: string | null = null;
			const lockResult = await withRunLock(
				{ cwd: ctx.cwd, mode: "approve", command: "/senai-approve", runId: state.runId },
				async () => {
					const fresh = loadState(ctx.cwd);
					const current = fresh.currentStage;
					if (current === "none" || current === "delivered") {
						return { kind: "noop" as const, message: `Run is '${current}'.` };
					}
					const expectedNext = STAGE_TRANSITIONS[current][0];
					if (!expectedNext) {
						return { kind: "noop" as const, message: `No next stage from '${current}'.` };
					}

					// Verify the completed stage actually produced its artifacts before
					// advancing. Missing artifacts warn and ask instead of blocking.
					const artifactStage = COMPLETED_STAGE_ARTIFACT[current];
					const missingArtifacts =
						artifactStage && fresh.runId
							? listMissingStageArtifacts(ctx.cwd, fresh.runId, artifactStage)
							: [];
					if (missingArtifacts.length > 0) {
						const proceed = await runSimpleConfirm(
							ctx,
							"Artifacts missing",
							`Stage '${current}' is missing artifact(s):\n${missingArtifacts.join("\n")}\n\nAdvance anyway?`,
						);
						if (!proceed) {
							return { kind: "noop" as const, message: "Cancelled by user at artifact check." };
						}
					}

					// Phase 2 discipline signals — collected when leaving the implement
					// stage.
					if (current === "implementing" && fresh.runId) {
						const signals = await collectImplementSignals(ctx.cwd, fresh);
						const summary = formatImplementSignals(signals);
						const block = signalsBlockAdvance(signals);
						if (block.blocked) {
							const proceed = await runSimpleConfirm(
								ctx,
								"Discipline findings",
								`${summary}\n\nBlocking reasons:\n${block.reasons.slice(0, 10).join("\n")}\n\nAdvance anyway?`,
							);
							if (!proceed) {
								return { kind: "noop" as const, message: `Cancelled by user at discipline check.\n${summary}` };
							}
						}
						pendingSignalSummary = summary;
					}

					const firstAdvance = advanceStage(
						ctx.cwd,
						fresh,
						expectedNext,
						`approved ${new Date().toISOString()}; artifacts: ${
							missingArtifacts.length === 0
								? "verified"
								: `missing ${missingArtifacts.length} (user confirmed)`
						}`,
					);
					if (!firstAdvance.ok) {
						return { kind: "error" as const, message: firstAdvance.reason };
					}

					// Adaptive spawn cadence: count a clean Plan-stage approval so the
					// tier can promote after 3 consecutive clean runs.
					if (current === "planning") {
						try {
							recordCleanRun(ctx.cwd);
						} catch {
							// Best-effort: a cadence write failure must not block approval.
						}
					}

					const completedStage = expectedNext;
					const nextCommand = NEXT_COMMAND[completedStage];
					const nextWorkingStage = STAGE_COMMANDS[completedStage];

					if (!nextWorkingStage) {
						return { kind: "final" as const, message: `Stage '${current}' approved. Advanced to '${completedStage}'.\nAll stages are complete.` };
					}

					const secondAdvance = advanceStage(ctx.cwd, firstAdvance.state, nextWorkingStage as Parameters<typeof advanceStage>[2]);
					if (!secondAdvance.ok) {
						return { kind: "error" as const, message: secondAdvance.reason };
					}

					return {
						kind: "advance" as const,
						fromStage: current,
						completedStage,
						nextCommand,
						nextWorkingStage,
						secondState: secondAdvance.state,
					};
				},
			);

			if (!lockResult.ok) {
				ctx.ui.notify(
					`Lock busy — could not acquire the run lock.\n${lockResult.reason}` +
						(lockResult.holder ? `\nHolder: ${describeHolder(lockResult.holder)}` : "") +
						`\nWait a moment, or run /senai-doctor to inspect the lock.`,
					"error",
				);
				return;
			}

			const result = lockResult.value;
			if (result.kind === "noop" || result.kind === "error") {
				ctx.ui.notify(result.message, "error");
				return;
			}
			if (result.kind === "final") {
				ctx.ui.notify(result.message, "info");
				return;
			}
			// result.kind === "advance"
			const signalSuffix = pendingSignalSummary ? `\n\n${pendingSignalSummary}` : "";
			ctx.ui.notify(
				`Stage '${result.fromStage}' approved. Advanced to '${result.completedStage}'.\n` +
					`Automatically running the next stage: ${result.nextCommand}${signalSuffix}`,
				"info",
			);

			// Stage boundary: compact a large parent context before injecting the
			// next stage prompt.
			const usage = ctx.getContextUsage();
			const overBudget =
				usage != null &&
				((usage.percent != null && usage.percent >= 50) ||
					(usage.tokens != null && usage.tokens >= 0.4 * usage.contextWindow));
			if (overBudget) {
				ctx.compact({
					customInstructions: "Pi Senai stage boundary. Preserve the run state summary.",
				});
			}

			const { prompt } = buildStagePrompt(ctx.cwd, result.secondState, STAGE_SKILL[result.nextWorkingStage]);
			pi.sendUserMessage(prompt);
		},
	});
}
