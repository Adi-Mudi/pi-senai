import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	advanceStage,
	loadState,
	setBrainstormBriefPath,
	setMissionBriefPath,
	startRun,
} from "../core/state.js";
import {
	getBrainstormMissionBriefPath,
	getPreRunMissionBriefPath,
} from "../core/paths.js";
import { buildStagePrompt } from "../prompt.js";
import { runSimpleConfirm } from "../ui/simple-picker.js";
import {
	checkStageArtifact,
	ensureAgentConfig,
	ensureStage,
} from "./_helpers.js";

/** /senai-plan and /senai-implement — extracted from registerCommands
 *  in commands/index.ts during Phase 3l.2. */

/** Adopt a brainstorm run id: reuse it as the plan run id and copy the
 *  brief from Brainstorm/<id>/ into runs/<id>/ so the rest of the pipeline
 *  (which only knows about runs/) can pick it up. Returns the new state
 *  with runId + missionBriefPath set, or null if no brainstorm id is in
 *  state. */
function adoptBrainstormRunId(
	cwd: string,
	state: ReturnType<typeof loadState>,
	mission: string,
): ReturnType<typeof loadState> | null {
	if (!state.brainstormRunId) return null;
	const brainstormBrief = getBrainstormMissionBriefPath(cwd, state.brainstormRunId);
	if (!fs.existsSync(brainstormBrief)) return null;

	// The brainstorm run id becomes the plan run id. Mint plan folders next
	// to it and copy the brief in.
	const runId = state.brainstormRunId;
	const runDir = path.join(cwd, ".IDE_Plans/pi-senai/runs", runId);
	fs.mkdirSync(path.join(runDir, "plan/scouts"), { recursive: true });
	fs.mkdirSync(path.join(runDir, "plan/reviews"), { recursive: true });
	fs.mkdirSync(path.join(runDir, "implement"), { recursive: true });
	fs.mkdirSync(path.join(runDir, "document"), { recursive: true });
	fs.mkdirSync(path.join(runDir, "deliver"), { recursive: true });

	const runBrief = path.join(runDir, "mission-brief.md");
	fs.copyFileSync(brainstormBrief, runBrief);

	const adopted: ReturnType<typeof loadState> = {
		...state,
		version: 1,
		mission,
		runId,
		startedAt: state.startedAt || new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		stageResults: state.stageResults ?? {},
	};
	const withBrief = setBrainstormBriefPath(
		cwd,
		adopted,
		path.relative(cwd, runBrief),
	);
	return withBrief;
}

export function registerPlanCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-plan", {
		description: "Start the Plan stage: /senai-plan <mission>",
		handler: async (args, ctx) => {
			if (!ensureAgentConfig(ctx.cwd, ctx)) return;
			const mission = args.trim();
			if (!mission) {
				ctx.ui.notify("Usage: /senai-plan <mission>", "warning");
				return;
			}

			// Warn-and-confirm when a run is already in flight. state.json.stage
			// is the source of truth — none and delivered are the only safe
			// starting points; every active stage has artifacts the user might
			// lose by overwriting. Default = cancel (the user re-reads state and
			// chooses again). Note: /senai-plan does NOT touch stage — the warn
			// runs before startRun, never mutates state.
			const existing = loadState(ctx.cwd);
			const activeStage = existing.currentStage;
			if (activeStage !== "none" && activeStage !== "delivered") {
				const proceed = await runSimpleConfirm(
					ctx,
					"Active run in progress",
					`Run "${existing.mission}" (${existing.runId}) is in stage '${activeStage}'.\n\n` +
						`Starting /senai-plan will REPLACE state.json with a new run.\n` +
						`To refine the active run without replacing it, run /senai-brainstorm instead.\n\n` +
						`Start a new run anyway?`,
				);
				if (!proceed) {
					ctx.ui.notify("Cancelled. Run /senai-brainstorm to update the active run.", "info");
					return;
				}
			}

			// Adopt the brainstorm run id when one is in flight and the brief
			// is on disk. Falls back to minting a fresh plan run id otherwise.
			const adopted = adoptBrainstormRunId(ctx.cwd, existing, mission);

			let state: ReturnType<typeof loadState>;
			let briefNote = "";
			if (adopted) {
				state = adopted;
				briefNote = `\nAdopted brainstorm run ${state.runId}. Brief copied to ${state.missionBriefPath}.`;
			} else {
				state = startRun(ctx.cwd, mission);

				// Consume a legacy pre-run discussion if one exists; reference it in state.
				const preRunBrief = getPreRunMissionBriefPath(ctx.cwd);
				if (fs.existsSync(preRunBrief)) {
					state = setMissionBriefPath(ctx.cwd, state, path.relative(ctx.cwd, preRunBrief));
					briefNote = `\nPre-run mission brief consumed: ${state.missionBriefPath}`;
				}
			}

			const advance = advanceStage(ctx.cwd, state, "planning");
			if (!advance.ok) {
				ctx.ui.notify(advance.reason, "error");
				return;
			}

			ctx.ui.notify(
				`Plan stage started for: ${mission}\n` +
					`When the plan is ready and you approve it, run /senai-approve to continue.` +
					briefNote,
				"info",
			);

			const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "plan");
			pi.sendUserMessage(prompt);
		},
	});
}

export function registerImplementCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-implement", {
		description: "Start the Implement stage (requires approved plan)",
		handler: async (_args, ctx) => {
			if (!ensureAgentConfig(ctx.cwd, ctx)) return;
			const state = loadState(ctx.cwd);
			const check = checkStageArtifact(state, "plan", ctx);
			if (!check.ok) return;

			const ensured = ensureStage(ctx.cwd, state, "planned");
			if (!ensured.ok) {
				ctx.ui.notify(ensured.reason, "warning");
				return;
			}

			const advance = advanceStage(ctx.cwd, ensured.state, "implementing");
			if (!advance.ok) {
				ctx.ui.notify(advance.reason, "error");
				return;
			}

			ctx.ui.notify(
				`Implement stage started.\n` +
					`When implementation and tests are complete and you approve, run /senai-approve to continue.`,
				"info",
			);

			const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "implement");
			pi.sendUserMessage(prompt);
		},
	});
}

export function registerDocumentCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-document", {
		description: "Start the Document stage (requires implemented code)",
		handler: async (_args, ctx) => {
			if (!ensureAgentConfig(ctx.cwd, ctx)) return;
			const state = loadState(ctx.cwd);
			const check = checkStageArtifact(state, "implement", ctx);
			if (!check.ok) return;

			const ensured = ensureStage(ctx.cwd, state, "implemented");
			if (!ensured.ok) {
				ctx.ui.notify(ensured.reason, "warning");
				return;
			}

			const advance = advanceStage(ctx.cwd, ensured.state, "documenting");
			if (!advance.ok) {
				ctx.ui.notify(advance.reason, "error");
				return;
			}

			ctx.ui.notify(
				`Document stage started.\n` +
					`When documentation is complete and you approve, run /senai-approve to continue.`,
				"info",
			);

			const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "document");
			pi.sendUserMessage(prompt);
		},
	});
}

export function registerDeliverCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-deliver", {
		description: "Start the Deliver stage (requires documentation)",
		handler: async (_args, ctx) => {
			if (!ensureAgentConfig(ctx.cwd, ctx)) return;
			const state = loadState(ctx.cwd);
			const check = checkStageArtifact(state, "document", ctx);
			if (!check.ok) return;

			const ensured = ensureStage(ctx.cwd, state, "documented");
			if (!ensured.ok) {
				ctx.ui.notify(ensured.reason, "warning");
				return;
			}

			const advance = advanceStage(ctx.cwd, ensured.state, "delivering");
			if (!advance.ok) {
				ctx.ui.notify(advance.reason, "error");
				return;
			}

			ctx.ui.notify(
				`Deliver stage started.\n` +
					`When security audit and packaging are complete and you approve, run /senai-approve to finish.`,
				"info",
			);

			const { prompt } = buildStagePrompt(ctx.cwd, advance.state, "deliver");
			pi.sendUserMessage(prompt);
		},
	});
}
