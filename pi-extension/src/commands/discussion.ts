import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadState } from "../core/state.js";
import {
	getPreRunDiscussionDir,
	getPreRunMissionBriefPath,
	getRunDiscussionsDir,
	getRunMissionBriefPath,
} from "../core/paths.js";
import { withRunLock, describeHolder } from "../io/lock.js";
import { finalizeMissionBrief, validateBriefSections } from "../core/mission-brief.js";
import { recordDiscussion, type DiscussionEvent } from "../core/state.js";
import { purgeCache as purgeCommunityCache } from "../scouts/community-research.js";
import { SOURCE_PICKER_OPTIONS } from "../scouts/web-fetcher.js";
import { loadSkill } from "../prompt.js";
import { runSimpleConfirm } from "../ui/simple-picker.js";

export function registerDiscussionCommands(pi: ExtensionAPI) {
	// /senai-discussion is conversational: the parent LLM runs the
	// AskUserQuestion loops driven by skills/senai-discussion.md, then
	// calls recordDiscussion from mission-brief.ts. This slash command
	// emits the stage prompt that loads the skill; the parent does the
	// actual Q&A and writes the brief via its own tool calls.
	pi.registerCommand("senai-discussion", {
		description: "Open a discussion with the user to refine the mission: /senai-discussion <topic>",
		handler: async (args, ctx) => {
			const topic = args.trim();
			const state = loadState(ctx.cwd);
			const location = state.runId ? `run ${state.runId}` : "pre-run";
			const stage = state.currentStage;
			ctx.ui.notify(
				`Opening /senai-discussion (${location}, stage '${stage}').\n` +
					`The parent will ask the mission-type question first, then 2-5 focused questions.\n` +
					`Use /senai-discussion-approve to finalize the mission-brief.md.`,
				"info",
			);
			const briefLocation = state.runId
				? getRunMissionBriefPath(ctx.cwd, state.runId)
				: getPreRunMissionBriefPath(ctx.cwd);
			const prompt = [
				`<pi-senai stage="discussion">`,
				`Topic: ${topic || "(no topic — start with the mission-type question)"}`,
				`Run: ${state.runId || "(none — pre-run)"}`,
				`Stage: ${state.currentStage}`,
				`Brief location: ${briefLocation}`,
				`</pi-senai>`,
				``,
				loadSkill("discussion"),
				// Community-research is an optional side-channel inside discussion.
				// The parent loads this skill on demand when a trigger path matches.
				loadSkill("community-research"),
				// Source picker hints for when the parent triggers the community-research
				// side-channel. These mirror the SOURCE_PICKER_OPTIONS exported by
				// web-fetcher.ts so the parent can compose the AskUserQuestion options
				// verbatim and use createWebFetcherPlan(source) to bias WebSearch +
				// FetchURL toward trusted URLs per source.
				``,
				`## Community-research source picker (use only when the side-channel fires)`,
				SOURCE_PICKER_OPTIONS.map((o, i) => `${i + 1}. ${o.label} — ${o.description}`).join("\n"),
				``,
				`For the chosen source, call \`createWebFetcherPlan(source)\` from \`pi-extension/src/scouts/web-fetcher.ts\` (or compose the same prompts inline) to bias WebSearch + FetchURL toward trusted URLs.`,
			].join("\n");
			pi.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("senai-discussion-approve", {
		description: "Finalize the current mission-brief.md (clears the draft marker, logs the event)",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			const briefPath = state.runId
				? getRunMissionBriefPath(ctx.cwd, state.runId)
				: getPreRunMissionBriefPath(ctx.cwd);

			if (!fs.existsSync(briefPath)) {
				ctx.ui.notify(
					"No mission-brief.md found. Run /senai-discussion first.",
					"warning",
				);
				return;
			}

			// Idempotency pre-check (cheap, outside the lock): if the brief is
			// already finalized AND the most recent recorded event references this
			// exact brief, the second call is a no-op and we never touch the lock.
			const preRaw = fs.readFileSync(briefPath, "utf8");
			if (!preRaw.startsWith("<!-- pi-senai mission-brief: draft -->")) {
				const lastEvent = (state.discussionEvents ?? []).at(-1);
				// lastEvent.briefPath is stored relative to ctx.cwd; resolve against
				// ctx.cwd so the comparison is independent of the test process cwd.
				const sameBrief =
					lastEvent &&
					path.resolve(ctx.cwd, lastEvent.briefPath) === path.resolve(briefPath);
				if (sameBrief) {
					ctx.ui.notify(
						`Mission brief is already finalized. Discussions so far: ${state.discussions ?? 1}.`,
						"info",
					);
					return;
				}
			}

			const lockResult = await withRunLock(
				{
					cwd: ctx.cwd,
					mode: "discussion-approve",
					command: "/senai-discussion-approve",
					runId: state.runId,
				},
				async () => {
					// Re-read both state and brief under the lock so concurrent
					// finalize calls cannot race.
					const fresh = loadState(ctx.cwd);
					const liveBriefPath = fresh.runId
						? getRunMissionBriefPath(ctx.cwd, fresh.runId)
						: getPreRunMissionBriefPath(ctx.cwd);
					if (!fs.existsSync(liveBriefPath)) {
						return { kind: "missing" as const };
					}
					const raw = fs.readFileSync(liveBriefPath, "utf8");

					// Idempotency under the lock too: re-check in case a sibling
					// command finalized between the pre-check and now.
					if (!raw.startsWith("<!-- pi-senai mission-brief: draft -->")) {
						const lastEvent = (fresh.discussionEvents ?? []).at(-1);
						const sameBrief =
							lastEvent &&
							path.resolve(ctx.cwd, lastEvent.briefPath) === path.resolve(liveBriefPath);
						if (sameBrief) {
							return { kind: "already" as const, count: fresh.discussions ?? 1 };
						}
					}

					const missing = validateBriefSections(raw);
					if (missing.length > 0) {
						const proceed = await runSimpleConfirm(
							ctx,
							"Mission brief has gaps",
							`The brief is missing required sections:\n${missing.join("\n")}\n\nFinalize anyway?`,
						);
						if (!proceed) {
							return { kind: "cancelled" as const };
						}
					}

					finalizeMissionBrief(liveBriefPath);

					// Log the event. Re-read the transcript directory under the lock
					// to find the most recent transcript file (the parent just wrote
					// one). The directory may be missing if no transcript was written.
					const transcriptsDir = fresh.runId
						? getRunDiscussionsDir(ctx.cwd, fresh.runId)
						: getPreRunDiscussionDir(ctx.cwd);
					let transcriptPath = "";
					try {
						const files = fs
							.readdirSync(transcriptsDir)
							.filter((n) => /^discussion-\d{2}-/.test(n))
							.sort();
						const last = files[files.length - 1];
						if (last) transcriptPath = path.join(transcriptsDir, last);
					} catch {
						transcriptPath = "";
					}

					const event: DiscussionEvent = {
						ts: new Date().toISOString(),
						transcriptPath: path.relative(ctx.cwd, transcriptPath) || transcriptPath,
						briefPath: path.relative(ctx.cwd, liveBriefPath),
						afterStage: fresh.runId ? fresh.currentStage : undefined,
					};

					const recorded = recordDiscussion(ctx.cwd, fresh, event);
					if (!recorded.ok) {
						return { kind: "error" as const, message: recorded.reason };
					}
					return {
						kind: "ok" as const,
						state: recorded.state,
						runId: fresh.runId,
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

			const outcome = lockResult.value;
			if (outcome.kind === "missing") {
				ctx.ui.notify("No mission-brief.md found. Run /senai-discussion first.", "warning");
				return;
			}
			if (outcome.kind === "cancelled") {
				ctx.ui.notify(
					"Cancelled. Fill the missing sections, then re-run /senai-discussion-approve.",
					"info",
				);
				return;
			}
			if (outcome.kind === "error") {
				ctx.ui.notify(outcome.message, "error");
				return;
			}
			if (outcome.kind === "already") {
				ctx.ui.notify(
					`Mission brief was finalized by a concurrent call. Discussions so far: ${outcome.count}.`,
					"info",
				);
				return;
			}
			// outcome.kind === "ok"
			ctx.ui.notify(
				`Mission brief finalized. Discussions so far: ${outcome.state.discussions ?? 1}.\n` +
					(outcome.runId
						? "Next: run /senai-plan again or /senai-approve to continue the run."
						: "Next: run /senai-plan <mission> to start a run that consumes this brief."),
				"info",
			);
		},
	});

	pi.registerCommand("senai-purge-community-cache", {
		description:
			"Clear all community-research cache entries (.IDE_Plans/pi-senai/.cache/community-research/).",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			const lockResult = await withRunLock(
				{
					cwd: ctx.cwd,
					mode: "discussion-research",
					command: "/senai-purge-community-cache",
					runId: state.runId,
				},
				async () => {
					const purged = purgeCommunityCache(ctx.cwd);
					return { kind: "ok" as const, count: purged };
				},
			);

			if (!lockResult.ok) {
				ctx.ui.notify(
					`Lock busy — could not acquire the run lock.\n${lockResult.reason}` +
						(lockResult.holder ? `\nHolder: ${describeHolder(lockResult.holder)}` : ""),
					"error",
				);
				return;
			}

			ctx.ui.notify(
				`Community-research cache purged: ${lockResult.value.count} file(s) removed.`,
				"info",
			);
		},
	});
}
