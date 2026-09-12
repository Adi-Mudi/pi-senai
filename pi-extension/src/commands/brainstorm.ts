import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadState, endBrainstormSession, recordDiscussion, startBrainstorm, type DiscussionEvent } from "../core/state.js";
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
import { loadSkill } from "../prompt.js";
import { runSimpleConfirm } from "../ui/simple-picker.js";
import { guardBriefContent, guardApproveReadiness, guardSeedInput, BRAINSTORM_DISPATCH_CAP } from "../brainstorm/guard.js";
import { buildRegistryBlock, loadBrainstormRegistry, MISSION_SEQUENCE } from "../brainstorm/registry.js";
import { getMissionPack, type MissionPack } from "../core/mission-packs.js";
import { BRAINSTORM_COMMUNITY_DISPATCH_TIMEOUT_MS, BRAINSTORM_DISPATCH_TIMEOUT_MS } from "../brainstorm/dispatcher.js";
import {
	buildSummary,
	countBriefSections,
	createAuditSession,
	writeAuditLog,
} from "../brainstorm/audit.js";

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

/** Render the lifecycle-pack lines for the prompt header. Only non-empty
 *  pack fields produce a line, so types on the empty pack add nothing. */
function packHeaderLines(pack: MissionPack): string[] {
	const lines: string[] = [];
	if (pack.extraBriefSections.length > 0) {
		lines.push(`Pack extra brief sections: ${pack.extraBriefSections.join(", ")}`);
	}
	if (pack.conditionalScans.length > 0) {
		lines.push(
			`Pack conditional scans: ${pack.conditionalScans.map((c) => `${c.scan} if ${c.trigger}`).join("; ")}`,
		);
	}
	if (pack.neverRules.length > 0) {
		lines.push(`Pack NEVER rules: ${pack.neverRules.join("; ")}`);
	}
	return lines;
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
			// Phase 2 guard: refuse empty seed. The parent LLM needs at least
			// one signal (topic, insight, goal, question) to anchor the Q&A.
			const seedGuard = guardSeedInput(args);
			if (!seedGuard.ok) {
				ctx.ui.notify(seedGuard.reason!, "warning");
				return;
			}
			const topic = args.trim();
			let loaded = loadState(ctx.cwd);
			// A finalized explore session is complete. If the previous brainstorm
			// was an explore mission whose decision document already finalized,
			// reset the session fields so this new brainstorm starts fresh
			// instead of resuming the finished one.
			if (loaded.missionType === "explore" && loaded.exploreDecision && loaded.brainstormRunId) {
				const prevBrief = getBrainstormMissionBriefPath(ctx.cwd, loaded.brainstormRunId);
				const finalized =
					fs.existsSync(prevBrief) &&
					!fs.readFileSync(prevBrief, "utf8").startsWith("<!-- pi-senai mission-brief: draft -->");
				if (finalized) {
					loaded = endBrainstormSession(ctx.cwd, loaded);
				}
			}
			// Mint (or resume) the brainstorm run id and persist it. The id is
			// stable across multiple turns of the same session, so the parent
			// LLM and /senai-brainstorm-approve both see the same folder.
			const state = startBrainstorm(ctx.cwd, topic, loaded);
			const brainstormRunId = state.brainstormRunId || "(none)";
			const location = state.runId ? `run ${state.runId}` : `brainstorm ${brainstormRunId}`;
			const stage = state.currentStage;
			// New-flow hard lock: the scan gate, dispatch tree, and brief writing
			// stay sealed until the user confirms the parent's understanding
			// (state.understandingConfirmed === true via the session tool).
			// Approve-side legacy exemption lives in guardApproveReadiness.
			const unlocked = state.understandingConfirmed === true;
			ctx.ui.notify(
				`Opening /senai-brainstorm (${location}, stage '${stage}').\n` +
					(!unlocked
						? `UNDERSTAND first: mission-type question, then at most 2 follow-ups, then the one-paragraph confirm loop.\n`
						: `Understanding confirmed — scan gate and specialist dispatch are unlocked.\n`) +
					`Use /senai-brainstorm-approve to finalize the mission-brief.md.`,
				"info",
			);
			const briefLocation = resolveBriefPath(ctx.cwd, state);
			const dispatchCount = state.brainstormDispatchCount ?? 0;
			const dispatchRemaining = Math.max(0, BRAINSTORM_DISPATCH_CAP - dispatchCount);
			const header = [
				`<pi-senai stage="discussion">`,
				`Topic: ${topic || "(no topic — start with the mission-type question)"}`,
				`Brainstorm run id: ${brainstormRunId}`,
				`Active run: ${state.runId || "(none — brainstorm is pre-run)"}`,
				`Stage: ${state.currentStage}`,
				`Brief location: ${briefLocation}`,
				`Understanding confirmed: ${state.understandingConfirmed === true ? "yes" : "no"}`,
				`Mission type: ${state.missionType ?? "(not picked yet)"}`,
				...(state.missionType
					? [`Sequence for this type: ${MISSION_SEQUENCE[state.missionType].stages.join(" → ")}`]
					: []),
				...(state.missionType ? packHeaderLines(getMissionPack(state.missionType)) : []),
				`Scans selected: ${state.scansSelected?.join(", ") || "(not selected yet)"}`,
				`Dispatch counter: ${dispatchCount} / ${BRAINSTORM_DISPATCH_CAP} (${dispatchRemaining} remaining)`,
				`Dispatch timeout: ${BRAINSTORM_DISPATCH_TIMEOUT_MS}ms (code/doc) / ${BRAINSTORM_COMMUNITY_DISPATCH_TIMEOUT_MS}ms (community)`,
				`</pi-senai>`,
				``,
				loadSkill("brainstorm"),
			];

			if (!unlocked) {
				// Sealed prompt: no registry, no dispatch tree. The parent stays in
				// [0] UNDERSTAND / [1] CONFIRM until the lock opens.
				pi.sendUserMessage(
					[
						...header,
						``,
						`## HARD LOCK ACTIVE — understand before scan`,
						``,
						`Understanding is not confirmed yet. Stay in [0] UNDERSTAND / [1] CONFIRM:`,
						`- Ask the mission-type question first. Types (from MISSION_SEQUENCE):`,
						...Object.values(MISSION_SEQUENCE).map(
							(seq) => `  - ${seq.questionPack} — ${seq.summary}`,
						),
						`- Then at most 2 dynamic follow-up questions from the mission-type pack.`,
						`- Write ONE short understanding paragraph and ask the user to confirm it.`,
						`- Only after the user confirms, record it:`,
						`  senai_brainstorm_session({ action: "confirm-understanding", missionType: "<type>" })`,
						`- Then re-invoke /senai-brainstorm "${topic}" to unlock the scan gate.`,
						`- Do NOT dispatch subagents and do NOT write the brief while locked.`,
						`- Quick inline reads (1-2 files, your own Read/Grep) are allowed.`,
					].join("\n"),
				);
				return;
			}

			// Unlocked: load the brainstorm-eligible agent registry + render it
			// as a stage-prompt block so the parent LLM can see which
			// specialists are available for read-only dispatch.
			const registry = loadBrainstormRegistry(ctx.cwd);
			const registryBlock = buildRegistryBlock(registry, topic);
			const prompt = [
				...header,
				``,
				registryBlock,
				``,
				`## Specialist dispatch decision tree`,
				``,
				`Per user turn, the parent picks ONE of:`,
				`- Quick read (single file) → parent reads inline, log "inline" decision`,
				`- CODE-SCAN (multi-file patterns, risk/dependency) → dispatch scout-2 or scout-3 (scanType: "code")`,
				`- DOC-SCAN (PRD, docs, architecture) → dispatch scout-4 or scout-1 (scanType: "doc")`,
				`- COMMUNITY-SCAN (official docs, forums) → dispatch community-researcher (scanType: "community", 90s budget)`,
				`- Trade-off / option comparison → dispatch planner`,
				`- None of the above → ask another AskUserQuestion round`,
				``,
				`## Dispatch contract`,
				``,
				`Before each dispatch, validate via the dispatcher rules:`,
				`- Agent must be brainstorm-eligible AND serve the scan type (see table above).`,
				`- Dispatch count must stay under cap (${BRAINSTORM_DISPATCH_CAP}); max 2 per scan type.`,
				`- Tools allowlist is read-only (Read, Grep, Glob, WebSearch, FetchURL).`,
				`- All artifact paths (if any) must stay inside the brainstorm folder.`,
				`- A live subagent pane is OPTIONAL display only — scout-notes files are the truth.`,
				``,
				`Record session state via the senai_brainstorm_session tool:`,
				`- set-scans after the scan-plan gate`,
				`- upsert-question after every DISCUSS state change (reason required for not-wanted/replaced)`,
				...(state.missionType === "explore"
					? [
						``,
						`## Explore mission — DECIDE door (no plan, no implement)`,
						`When the discussion is done:`,
						`- Ask the user to pick ONE door: go (do it — seeds a new brainstorm) / clarify (needs more research) / kill (drop it).`,
						`- Record it: senai_brainstorm_session({ action: "set-decision", decision: "<door>" })`,
						`- Then run /senai-brainstorm-approve to finalize the decision document.`,
						`- Do NOT suggest /senai-plan — explore has no plan stage.`,
					]
					: []),
				``,
				`When calling subagent, pass the prepared payload directly. The dispatcher module formats it for you.`,
				// Web research goes through the same dispatch pipeline: the parent
				// dispatches the community-researcher; source picking happens inside
				// the web-research subagent. The parent does NOT call
				// WebSearch/FetchURL directly.
				loadSkill("community-research"),
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

					// New-flow hard lock: understanding must be confirmed and
					// every question in a terminal state before finalize.
					const readiness = guardApproveReadiness(fresh);
					if (!readiness.ok) {
						return {
							kind: "rejected" as const,
							reason: readiness.reason!,
						};
					}

					// Phase 2 guard: HARD reject if any section is still a `_TBD_`
					// placeholder or empty. This replaces the old soft "Finalize
					// anyway?" dialog for placeholder content. The user MUST fill
					// the gaps before approve succeeds.
					const contentGuard = guardBriefContent(raw, fresh.missionType);
					if (!contentGuard.ok) {
						return {
							kind: "rejected" as const,
							reason: contentGuard.reason!,
						};
					}

					// Legacy soft check: still warn-and-confirm when a section
					// heading is missing entirely (separate from content gaps).
					// Kept for backward compat — most real briefs hit the hard
					// guard above before reaching this.
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

					// Phase 5: write the dispatch audit log. The parent LLM
					// accumulates decisions in the in-memory session; we read
					// it back at finalize. Decisions start empty for now — the
					// parent can append via the audit module or write directly
					// to the file via its Write tool. The summary block + brief
					// coverage are computed from final state.
					try {
						const session = createAuditSession(
							fresh.brainstormRunId ?? "(no-id)",
							"(seed unknown — capture at /senai-brainstorm entry)",
						);
						const coverage = countBriefSections(raw, fresh.missionType);
						const wallClockMs = Date.now() - new Date(event.ts).getTime();
						const summary = buildSummary(session, {
							wallClockMs,
							briefSectionsFilled: coverage.filled,
							briefSectionsTotal: coverage.total,
						});
						writeAuditLog(ctx.cwd, session, summary);
					} catch {
						// Best-effort: audit log failure never blocks approve.
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
			if (outcome.kind === "rejected") {
				// Phase 2 hard reject — brief still has _TBD_ placeholders.
				ctx.ui.notify(outcome.reason, "warning");
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
			if (outcome.state.missionType === "explore") {
				const door = outcome.state.exploreDecision;
				const decisionDoc = outcome.brainstormRunId
					? path.relative(ctx.cwd, getBrainstormMissionBriefPath(ctx.cwd, outcome.brainstormRunId))
					: "(unknown)";
				const doorMessage =
					door === "go"
						? `Decision: GO.\nNext: start a new brainstorm seeded with the decision document:\n  /senai-brainstorm "see ${decisionDoc}"`
						: door === "clarify"
							? `Decision: CLARIFY — more research needed.\nNext: run /senai-brainstorm again to continue researching this topic.`
							: `Decision: KILL — dropped. Nothing further to do.`;
				ctx.ui.notify(`Decision document finalized: ${decisionDoc}\n${doorMessage}`, "info");
				return;
			}
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
