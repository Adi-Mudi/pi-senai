import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadState, recordDiscussion, startBrainstorm, type DiscussionEvent } from "../core/state.js";
import {
	getBrainstormDiscussionDir,
	getBrainstormMissionBriefPath,
	getPreRunDiscussionDir,
	getPreRunMissionBriefPath,
	getRunDiscussionsDir,
	getRunMissionBriefPath,
} from "../core/paths.js";
import { withRunLock, describeHolder } from "../io/lock.js";
import { finalizeMissionBrief, validateBriefSections } from "../core/mission-brief.js";
import { purgeCache as purgeCommunityCache } from "../scouts/community-research.js";
import { SOURCE_PICKER_OPTIONS } from "../scouts/web-fetcher.js";
import { loadSkill } from "../prompt.js";
import { runSimpleConfirm } from "../ui/simple-picker.js";

/** Resolve the brief path for the current brainstorm session. Brainstorm
 *  run id wins (new flow); then active run id (mid-run brainstorm);
 *  finally the legacy pre-run folder (backward compat reads only). */
function resolveBriefPath(cwd: string, state: { runId?: string; brainstormRunId?: string }): string {
	if (state.brainstormRunId) {
		return getBrainstormMissionBriefPath(cwd, state.brainstormRunId);
	}
	if (state.runId) {
		return getRunMissionBriefPath(cwd, state.runId);
	}
	return getPreRunMissionBriefPath(cwd);
}

/** Resolve the discussions directory for the current brainstorm session.
 *  Same precedence as resolveBriefPath. */
function resolveDiscussionsDir(
	cwd: string,
	state: { runId?: string; brainstormRunId?: string },
): string {
	if (state.brainstormRunId) {
		return getBrainstormDiscussionDir(cwd, state.brainstormRunId);
	}
	if (state.runId) {
		return getRunDiscussionsDir(cwd, state.runId);
	}
	return getPreRunDiscussionDir(cwd);
}

export function registerBrainstormCommands(pi: ExtensionAPI) {
	// /senai-brainstorm is conversational: the parent LLM runs the
	// AskUserQuestion loops driven by skills/senai-brainstorm.md, then
	// calls recordDiscussion from mission-brief.ts. This slash command
	// emits the stage prompt that loads the skill; the parent does the
	// actual Q&A and writes the brief via its own tool calls.
	pi.registerCommand("senai-brainstorm", {
		description: "Open a brainstorm with the user to refine the mission: /senai-brainstorm <topic>",
		handler: async (args, ctx) => {
			const topic = args.trim();
			const loaded = loadState(ctx.cwd);
			// Mint (or resume) the brainstorm run id and persist it. The id is
			// stable across multiple turns of the same session, so the parent
			// LLM and /senai-brainstorm-approve both see the same folder.
			const state = startBrainstorm(ctx.cwd, topic, loaded);
			const brainstormRunId = state.brainstormRunId || "(none)";
			const location = state.runId ? `run ${state.runId}` : `brainstorm ${brainstormRunId}`;
			const stage = state.currentStage;
			ctx.ui.notify(
				`Opening /senai-brainstorm (${location}, stage '${stage}').\n` +
					`The parent will ask the mission-type question first, then 2-5 focused questions.\n` +
					`Use /senai-brainstorm-approve to finalize the mission-brief.md.`,
				"info",
			);
			const briefLocation = resolveBriefPath(ctx.cwd, state);
			const prompt = [
				`<pi-senai stage="discussion">`,
				`Topic: ${topic || "(no topic — start with the mission-type question)"}`,
				`Brainstorm run id: ${brainstormRunId}`,
				`Active run: ${state.runId || "(none — brainstorm is pre-run)"}`,
				`Stage: ${state.currentStage}`,
				`Brief location: ${briefLocation}`,
				`</pi-senai>`,
				``,
				loadSkill("brainstorm"),
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

	pi.registerCommand("senai-brainstorm-approve", {
		description: "Finalize the current mission-brief.md (clears the draft marker, logs the event)",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			const briefPath = resolveBriefPath(ctx.cwd, state);

			if (!fs.existsSync(briefPath)) {
				ctx.ui.notify(
					"No mission-brief.md found. Run /senai-brainstorm first.",
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
					mode: "brainstorm-approve",
					command: "/senai-brainstorm-approve",
					runId: state.runId,
				},
				async () => {
					// Re-read both state and brief under the lock so concurrent
					// finalize calls cannot race.
					const fresh = loadState(ctx.cwd);
					const liveBriefPath = resolveBriefPath(ctx.cwd, fresh);
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
					const transcriptsDir = resolveDiscussionsDir(ctx.cwd, fresh);
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
						brainstormRunId: fresh.brainstormRunId,
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
						brainstormRunId: fresh.brainstormRunId,
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
				ctx.ui.notify("No mission-brief.md found. Run /senai-brainstorm first.", "warning");
				return;
			}
			if (outcome.kind === "cancelled") {
				ctx.ui.notify(
					"Cancelled. Fill the missing sections, then re-run /senai-brainstorm-approve.",
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
			const nextHint = outcome.runId
				? "Next: run /senai-plan again or /senai-approve to continue the run."
				: "Next: run /senai-plan <mission> to start a run that consumes this brief.";
			ctx.ui.notify(
				`Mission brief finalized. Discussions so far: ${outcome.state.discussions ?? 1}.\n` +
					nextHint,
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
					mode: "brainstorm-research",
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
