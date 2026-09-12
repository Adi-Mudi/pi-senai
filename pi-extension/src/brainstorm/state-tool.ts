/**
 * Brainstorm session tool.
 *
 * The parent LLM drives the brainstorm lifecycle (UNDERSTAND → CONFIRM →
 * scan gate → DISCUSS) through conversation, but the hard-lock state must
 * live in state.json — not in chat memory. This tool is the LLM-callable
 * bridge to the state helpers in core/state.ts:
 *
 *   - confirm-understanding: releases the hard lock after the user confirms
 *     the parent's one-paragraph understanding (records the mission type).
 *   - set-scans: persists the scan kinds picked at the scan-plan gate.
 *   - upsert-question: records one DISCUSS-loop question state change.
 *
 * All writes run inside withFileMutationQueue (tools execute in parallel in
 * pi) and withRunLock (cross-session exclusion, per the saveState contract).
 */

import { Type } from "typebox";
import {
	withFileMutationQueue,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	confirmUnderstanding,
	EXPLORE_DECISIONS,
	loadState,
	MISSION_TYPES,
	setExploreDecision,
	setScansSelected,
	upsertBrainstormQuestion,
	type BrainstormQuestion,
	type ExploreDecision,
	type MissionType,
	type ScanType,
} from "../core/state.js";
import { getBrainstormMissionBriefPath, getStatePath } from "../core/paths.js";
import {
	appendOutOfScopeDecision,
	syncDecisionsToDiscussionDoc,
} from "../core/mission-brief.js";
import { withRunLock } from "../io/lock.js";

const SCAN_TYPES = ["code", "doc", "community"] as const;
const QUESTION_STATES = ["draft", "discussing", "agreed", "not-wanted", "replaced"] as const;

export function registerBrainstormSessionTool(pi: ExtensionAPI): void {
	// Mirror every mutation into the session file (pi.appendEntry) so /fork
	// and /resume carry the brainstorm progress with the session, not just
	// the project-level state.json. Best-effort: the state.json write above
	// is the truth; the entry is for session portability + observability.
	const persistEntry = (state: Parameters<typeof snapshot>[0]) => {
		try {
			pi.appendEntry("senai-brainstorm", snapshot(state));
		} catch {
			// Headless or read-only session — state.json already has the truth.
		}
	};
	pi.registerTool({
		name: "senai_brainstorm_session",
		label: "Update brainstorm session state",
		description:
			"Update the active brainstorm session during /senai-brainstorm. Actions: " +
			"confirm-understanding (after the user confirms your understanding paragraph — releases the hard lock), " +
			"set-scans (persist the scan selection from the scan-plan gate), " +
			"set-decision (explore missions only: record the decide door go/clarify/kill — required before approve), " +
			"upsert-question (record one question state change during DISCUSS; reason is required for not-wanted/replaced). " +
			"Returns the updated session snapshot.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("confirm-understanding"),
				Type.Literal("set-scans"),
				Type.Literal("set-decision"),
				Type.Literal("upsert-question"),
			]),
			missionType: Type.Optional(
				Type.Union(
					MISSION_TYPES.map((t) => Type.Literal(t)),
					{ description: "Required for confirm-understanding." },
				),
			),
			decision: Type.Optional(
				Type.Union(EXPLORE_DECISIONS.map((d) => Type.Literal(d)), {
					description: "Required for set-decision (explore missions).",
				}),
			),
			scans: Type.Optional(
				Type.Array(Type.Union(SCAN_TYPES.map((s) => Type.Literal(s))), {
					description: "Required for set-scans. Empty array = user skipped scans.",
				}),
			),
			question: Type.Optional(
				Type.Object(
					{
						id: Type.String({ description: "Question id, e.g. Q1." }),
						text: Type.String(),
						suggestedAnswer: Type.Optional(Type.String()),
						state: Type.Union(QUESTION_STATES.map((s) => Type.Literal(s))),
						reason: Type.Optional(
							Type.String({ description: "Required when state is not-wanted or replaced." }),
						),
					},
					{ description: "Required for upsert-question." },
				),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return withFileMutationQueue(getStatePath(ctx.cwd), async () => {
				const lockResult = await withRunLock(
					{
						cwd: ctx.cwd,
						mode: "brainstorm-research",
						command: "senai_brainstorm_session",
						runId: loadState(ctx.cwd).runId || undefined,
					},
					async () => {
						const state = loadState(ctx.cwd);
						if (!state.brainstormRunId) {
							return {
								ok: false as const,
								reason: "No active brainstorm. Run /senai-brainstorm <seed> first.",
							};
						}

						if (params.action === "confirm-understanding") {
							const missionType = params.missionType as MissionType | undefined;
							if (!missionType || !(MISSION_TYPES as readonly string[]).includes(missionType)) {
								return {
									ok: false as const,
									reason: `confirm-understanding needs missionType: ${MISSION_TYPES.join(" | ")}.`,
								};
							}
							const next = confirmUnderstanding(ctx.cwd, state, missionType);
							persistEntry(next);
							return { ok: true as const, state: snapshot(next) };
						}

						if (params.action === "set-scans") {
							const scans = params.scans as ScanType[] | undefined;
							if (!scans) {
								return { ok: false as const, reason: "set-scans needs a scans array (may be empty)." };
							}
							const invalid = scans.filter((s) => !(SCAN_TYPES as readonly string[]).includes(s));
							if (invalid.length > 0) {
								return {
									ok: false as const,
									reason: `Unknown scan type(s): ${invalid.join(", ")}. Allowed: ${SCAN_TYPES.join(", ")}.`,
								};
							}
							const next = setScansSelected(ctx.cwd, state, [...new Set(scans)]);
							persistEntry(next);
							return { ok: true as const, state: snapshot(next) };
						}

						if (params.action === "set-decision") {
							if (state.missionType !== "explore") {
								return {
									ok: false as const,
									reason: `set-decision is only valid for explore missions (current: ${state.missionType ?? "none"}).`,
								};
							}
							const decision = params.decision as ExploreDecision | undefined;
							if (!decision || !(EXPLORE_DECISIONS as readonly string[]).includes(decision)) {
								return {
									ok: false as const,
									reason: `set-decision needs decision: ${EXPLORE_DECISIONS.join(" | ")}.`,
								};
							}
							const next = setExploreDecision(ctx.cwd, state, decision);
							persistEntry(next);
							return { ok: true as const, state: snapshot(next) };
						}

						// upsert-question
						const question = params.question as BrainstormQuestion | undefined;
						if (!question || !question.id || !question.text || !question.state) {
							return {
								ok: false as const,
								reason: "upsert-question needs question: { id, text, state }.",
							};
						}
						if (!(QUESTION_STATES as readonly string[]).includes(question.state)) {
							return {
								ok: false as const,
								reason: `Unknown question state "${question.state}". Allowed: ${QUESTION_STATES.join(", ")}.`,
							};
						}
						if (
							(question.state === "not-wanted" || question.state === "replaced") &&
							(!question.reason || question.reason.trim() === "")
						) {
							return {
								ok: false as const,
								reason: `State "${question.state}" requires a reason (deferred, not forgotten).`,
							};
						}
						const next = upsertBrainstormQuestion(ctx.cwd, state, question);
						// The discussion document is the truth: regenerate the
						// decisions ledger (Agreed / Not wanted / Open) on every
						// change, and copy rejections into the brief's Out-of-scope.
						let ledgerPath: string | null = null;
						try {
							ledgerPath = syncDecisionsToDiscussionDoc(
								ctx.cwd,
								next.brainstormRunId!,
								next.brainstormQuestions ?? [],
							);
							if (question.state === "not-wanted" || question.state === "replaced") {
								appendOutOfScopeDecision(
									getBrainstormMissionBriefPath(ctx.cwd, next.brainstormRunId!),
									question,
								);
							}
						} catch {
							// Ledger sync is best-effort; the state write already landed.
						}
						persistEntry(next);
						return { ok: true as const, state: snapshot(next), ledgerPath };
					},
				);

				if (!lockResult.ok) {
					return {
						content: [{ type: "text" as const, text: `Lock busy — state not updated. ${lockResult.reason}` }],
						details: null,
						isError: true,
					};
				}
				const value = lockResult.value;
				if (!value.ok) {
					return {
						content: [{ type: "text" as const, text: value.reason }],
						details: null,
						isError: true,
					};
				}
				return {
					content: [{ type: "text" as const, text: JSON.stringify(value.state, null, 2) }],
					details: value.state,
				};
			});
		},
	});
}

function snapshot(state: ReturnType<typeof loadState>) {
	return {
		brainstormRunId: state.brainstormRunId,
		understandingConfirmed: state.understandingConfirmed === true,
		missionType: state.missionType ?? null,
		scansSelected: state.scansSelected ?? [],
		questions: state.brainstormQuestions ?? [],
		exploreDecision: state.exploreDecision ?? null,
	};
}
