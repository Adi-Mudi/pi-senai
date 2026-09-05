import * as fs from "node:fs";
import * as path from "node:path";

import { loadArchitectReport } from "../architect/index.js";
import { loadArchitectInputsConfig } from "../architect/inputs-config.js";
import { GENERATED_ROLES, getProjectSlug } from "../agents/generator.js";
import { loadAgentConfig, resolveAgentName } from "../agents/config.js";
import { loadAgentsFilesConfig } from "../agents/agents-files-config.js";
import { loadFilesConfig } from "../agents/files-config.js";
import { type SenaiRole } from "../agents/suggestions.js";
import { D_FLOOR_CLEAN, PROMOTE_AFTER_CLEAN, loadCadenceState } from "../implement/cadence.js";
import { lockInfo } from "../io/lock.js";
import { artifactMissing } from "./_helpers.js";
import { getArtifactPaths, getPreRunDiscussionDir, getSenaiDir, STAGE_RANK } from "../core/paths.js";
import { loadState, type SenaiState } from "../core/state.js";
import { validateBriefSections } from "../core/mission-brief.js";

import type { DiagnosticItem, DiagnosticSection } from "./_types.js";

/** Setup-progress guide: detects which of the documented one-time setup steps
 *  are complete and names the one next command. Guidance only — never emits
 *  errors, so it cannot change the report's pass/fail verdict. */
export function checkSetupProgress(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	let filesDone = false;
	try {
		filesDone = loadFilesConfig(cwd) !== null;
	} catch {
		filesDone = false; // corrupted counts as not done; the config section reports it
	}

	let inputsDone = false;
	try {
		inputsDone = loadArchitectInputsConfig(cwd) !== null;
	} catch {
		inputsDone = false;
	}

	let architectDone = false;
	try {
		architectDone = loadArchitectReport(cwd) !== null;
	} catch {
		architectDone = false;
	}

	let agentsDone = false;
	try {
		const agentConfig = loadAgentConfig(cwd);
		if (agentConfig) {
			const slug = getProjectSlug(cwd);
			agentsDone = GENERATED_ROLES.some((def) => {
				const expectedName = `${slug}-${def.role}`;
				return (
					resolveAgentName(agentConfig, def.role as SenaiRole) === expectedName &&
					fs.existsSync(path.join(cwd, ".pi", "agents", `${expectedName}.md`))
				);
			});
		}
	} catch {
		agentsDone = false;
	}

	let agentsFilesDone = false;
	try {
		// Done means at least one real assignment (truth or reads) — an empty
		// agents_files.json means the step was never actually performed.
		const agentsFilesConfig = loadAgentsFilesConfig(cwd);
		agentsFilesDone =
			agentsFilesConfig !== null &&
			Object.values(agentsFilesConfig.documents).some(
				(docs) => docs?.primary !== undefined || (docs?.reads?.length ?? 0) > 0,
			);
	} catch {
		agentsFilesDone = false;
	}

	const steps: Array<{ done: boolean; label: string; command: string }> = [
		{ done: filesDone, label: "Project files configured", command: "/senai-configure-files" },
		{ done: inputsDone, label: "Architect inputs selected", command: "/senai-configure-architect-inputs" },
		{ done: architectDone, label: "Architecture generated", command: "/senai-generate-architect" },
		{ done: agentsDone, label: "Sub-agent team generated", command: "/senai-generate-sub-agents" },
		{ done: agentsFilesDone, label: "Agent documents assigned", command: "/senai-configure-agents-files" },
	];

	const completed = steps.filter((s) => s.done).length;
	const allDone = completed === steps.length;

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		items.push({
			status: step.done ? "ok" : "info",
			message: `${i + 1}. ${step.label} — ${step.done ? "done" : `pending (run ${step.command})`}`,
		});
	}
	items.push({ status: "info", message: "6. Doctor verification — this command" });
	items.push({
		status: allDone ? "ok" : "info",
		message: `7. First run — ${allDone ? "ready (/senai-plan <mission>)" : "pending"}`,
	});
	items.push({
		status: "info",
		message: "8. Optional: /senai-discussion — refine the mission in a conversational pass before /senai-plan.",
	});

	if (allDone) {
		items.push({ status: "ok", message: "Setup complete — run /senai-plan <mission> to start your first run (or /senai-discussion first to refine the mission)." });
	} else {
		const next = steps.find((s) => !s.done)!;
		items.push({ status: "info", message: `Setup progress: ${completed}/5 checks complete. Next: run ${next.command}.` });
	}

	// Old artifact root (.IDE_Plans/senai/) renamed to .IDE_Plans/pi-senai/.
	// Warn once if the old directory still exists; user can move or delete it.
	const oldSenaiDir = path.join(cwd, ".IDE_Plans/senai");
	if (fs.existsSync(oldSenaiDir)) {
		const newSenaiDir = path.join(cwd, ".IDE_Plans/pi-senai");
		items.push({
			status: "warning",
			message: "Old `.IDE_Plans/senai/` directory found. Pi-senai now uses `.IDE_Plans/pi-senai/`.",
			details: [
				`Move: mv "${oldSenaiDir}" "${newSenaiDir}"`,
				"Or delete it if the artifacts are disposable.",
			],
		});
	}

	return { title: "Setup progress", items };
}

/**
 * Report the project-wide run lock state. The lock is held by
 * `/senai-approve` and `/senai-discussion-approve` for the duration of
 * their mutation. A held lock with a live pid means another Pi session is
 * mid-flight; a held lock with a dead pid or stale heartbeat is recovered
 * automatically by the next acquire call.
 */
export function checkLock(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const meta = lockInfo(cwd);
	if (!meta) {
		items.push({ status: "ok", message: "Lock state: free (no holder)." });
		return { title: "Lock state", items };
	}

	const ageSec = Math.max(
		0,
		Math.floor((Date.now() - Date.parse(meta.heartbeatAt)) / 1000),
	);
	const ageStartSec = Math.max(
		0,
		Math.floor((Date.now() - Date.parse(meta.startedAt)) / 1000),
	);
	const staleMs = Number.parseInt(process.env.SENAI_LOCK_STALE_MS ?? "60000", 10);
	const isStale = ageSec * 1000 > staleMs;

	items.push({ status: isStale ? "warning" : "info", message: `Lock state: held by ${meta.command} (mode=${meta.mode}).` });
	items.push({ status: "info", message: `  pid=${meta.pid}, host=${meta.host}, runId=${meta.runId ?? "(none)"}` });
	items.push({
		status: "info",
		message: `  startedAt=${meta.startedAt} (${ageStartSec}s ago), heartbeatAt=${meta.heartbeatAt} (${ageSec}s ago)`,
	});
	if (isStale) {
		items.push({
			status: "warning",
			message: `Heartbeat is older than ${staleMs}ms — the next /senai-approve or /senai-discussion-approve will auto-steal this lock.`,
		});
	} else {
		items.push({
			status: "info",
			message:
				"Another Senai command is in flight. Wait a moment or run /senai-doctor again. The lock is released automatically when the holder finishes.",
		});
	}

	return { title: "Lock state", items };
}

/** Reports the adaptive spawn cadence for the Plan stage. Tells the user
 *  which dispatch tier (A/B/C/D) is currently in effect, when the last
 *  rate-limit error fired, and whether the floor (tier D) has been stuck
 *  long enough to deserve a manual reset. */
export function checkCadence(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const state = loadCadenceState(cwd);

	const tierLabel: Record<string, string> = {
		A: "A (parallel burst)",
		B: "B (staggered)",
		C: "C (batch-2)",
		D: "D (fully serial)",
	};

	items.push({
		status: "ok",
		message: `Cadence tier: ${tierLabel[state.tier] ?? state.tier}` +
			(state.consecutiveCleanRuns > 0
				? ` (${state.consecutiveCleanRuns} clean run${state.consecutiveCleanRuns === 1 ? "" : "s"} since last 429)`
				: " (fresh)"),
	});

	if (state.last429At) {
		items.push({
			status: "info",
			message: `Last rate-limit error: ${state.last429At}`,
		});
	} else {
		items.push({
			status: "info",
			message: "No rate-limit errors recorded for this project.",
		});
	}

	if (state.tier === "A") {
		items.push({
			status: "info",
			message: `Tier A is the ceiling. The Plan stage runs scouts in a single burst.`,
		});
	} else if (state.tier === "D") {
		const cleanNote =
			state.consecutiveCleanRuns >= D_FLOOR_CLEAN
				? ` — eligible to escape to C (run /senai-cadence-reset).`
				: ` — ${D_FLOOR_CLEAN - state.consecutiveCleanRuns} more clean run(s) before escape is eligible.`;
		items.push({
			status: state.consecutiveCleanRuns >= D_FLOOR_CLEAN ? "warning" : "info",
			message: `Tier D is the floor. The Plan stage runs scouts one at a time.${cleanNote}`,
		});
	} else {
		items.push({
			status: "info",
			message: `Promotes to the next-faster tier after ${PROMOTE_AFTER_CLEAN} consecutive clean runs.`,
		});
	}

	if (state.history.length > 0) {
		const recent = state.history.slice(-5);
		items.push({
			status: "info",
			message: `Recent history (last ${recent.length} of ${state.history.length}):`,
		});
		for (const entry of recent) {
			items.push({
				status: "info",
				message: `  ${entry.ts}  ${entry.from} → ${entry.to}  (${entry.reason})`,
			});
		}
	}

	items.push({
		status: "info",
		message: "Use /senai-cadence-status for the full report, /senai-cadence-reset to escape tier D.",
	});

	return { title: "Spawn cadence", items };
}

export function checkRunArtifacts(cwd: string): DiagnosticSection {
	const title = "Run artifacts";
	let state: SenaiState;
	try {
		state = loadState(cwd);
	} catch {
		return {
			title,
			items: [{ status: "info", message: "state.json unreadable — run artifact audit skipped." }],
		};
	}
	if (!state.runId) {
		return { title, items: [{ status: "info", message: "No senai run recorded yet." }] };
	}

	const artifacts = getArtifactPaths(cwd, state.runId);
	const planArtifacts: Array<[string, string]> = [
		["plan/plan.md", artifacts.plan],
		["plan/plan-overview.md", artifacts.planOverview],
		["plan/discussion-notes.md", artifacts.discussionNotes],
		["plan/scouts/scout-angle_1.md", artifacts.scoutAngle1],
		["plan/scouts/scout-angle_2.md", artifacts.scoutAngle2],
		["plan/scouts/scout-angle_3.md", artifacts.scoutAngle3],
		["plan/scouts/scout-angle_4.md", artifacts.scoutAngle4],
		["plan/reviews/review-correctness.md", artifacts.reviewCorrectness],
		["plan/reviews/review-security.md", artifacts.reviewSecurity],
		["plan/reviews/review-tests.md", artifacts.reviewTests],
	];
	const deliverArtifacts: Array<[string, string]> = [
		["deliver/security-report.md", artifacts.securityReport],
		["deliver/deliver-summary.md", artifacts.deliverSummary],
	];
	const missingLabels = (list: Array<[string, string]>) =>
		list.filter(([, p]) => artifactMissing(p)).map(([label]) => label);

	const items: DiagnosticItem[] = [];
	const rank = STAGE_RANK[state.currentStage] ?? 0;

	if (rank >= STAGE_RANK.planned) {
		const missing = missingLabels(planArtifacts);
		if (missing.length > 0) {
			items.push({
				status: "warning",
				message: `Plan stage is marked complete but ${missing.length} artifact(s) are missing or empty`,
				details: [
					...missing,
					"A writer subagent reported completion without writing its file. Do not trust 'completed' — verify artifacts.",
				],
			});
		} else {
			items.push({ status: "ok", message: "All 10 plan-stage artifacts exist and are non-empty." });
		}
	} else if (state.currentStage === "planning") {
		const missing = missingLabels(planArtifacts);
		if (missing.length > 0) {
			items.push({
				status: "info",
				message: `Run '${state.runId}' is in 'planning' with ${missing.length}/10 plan artifacts still missing`,
				details: [
					...missing,
					"If no subagent is actively working on these, the run may be stuck — check the live subagent widget.",
				],
			});
		}
	}

	if (state.currentStage === "delivered") {
		const missing = missingLabels(deliverArtifacts);
		if (missing.length > 0) {
			items.push({
				status: "error",
				message: `Run is delivered but ${missing.length} deliver artifact(s) are missing or empty`,
				details: missing,
			});
		} else {
			items.push({ status: "ok", message: "Both deliver-stage artifacts exist and are non-empty." });
		}

		// A delivered run must have document-stage output; "delivered" with an
		// empty document/ directory means stages were skipped or state drifted.
		let documentEmpty = true;
		try {
			documentEmpty = fs.readdirSync(artifacts.documentDir).length === 0;
		} catch {
			documentEmpty = true;
		}
		if (documentEmpty) {
			items.push({
				status: "error",
				message: "Run is delivered but the document/ directory is empty or missing.",
				details: ["Stage state and artifacts disagree — inspect the run before trusting it."],
			});
		}

		// Implement-stage reports must live in implement/, never in deliver/.
		let deliverEntries: string[] = [];
		try {
			deliverEntries = fs.readdirSync(artifacts.deliverDir);
		} catch {
			deliverEntries = [];
		}
		const misplaced = deliverEntries.filter((name) =>
			["lint-report.md", "test-report.md", "full-test-report.md"].includes(name),
		);
		if (misplaced.length > 0) {
			items.push({
				status: "error",
				message: `deliver/ contains implement-stage file(s): ${misplaced.join(", ")}`,
				details: ["Move them into the run's implement/ directory."],
			});
		}
	}

	// plan.md is injected into every later stage prompt — flag token bloat.
	const PLAN_SIZE_WARN_BYTES = 50 * 1024;
	if (rank >= STAGE_RANK.planned) {
		try {
			const size = fs.statSync(artifacts.plan).size;
			if (size > PLAN_SIZE_WARN_BYTES) {
				items.push({
					status: "warning",
					message: `plan.md is ${Math.round(size / 1024)}KB (>${PLAN_SIZE_WARN_BYTES / 1024}KB) — token bloat.`,
					details: [
						"plan.md is injected into every later stage prompt. Slim it down and move detail into referenced files under the plan directory.",
					],
				});
			}
		} catch {
			/* missing plan.md is already reported above */
		}
	}

	if (items.length === 0) {
		items.push({
			status: "ok",
			message: `Run '${state.runId}' (${state.currentStage}): artifact audit clean.`,
		});
	}
	return { title, items };
}

/** Discussion checks:
 *  1. For each run directory containing a discussions/ folder, validate that
 *     exactly one discussion transcript subfolder is active — multiple active
 *     subfolders → warning naming the run id.
 *  2. For every existing mission-brief.md (pre-run and per-run), validate
 *     that all REQUIRED_BRIEF_SECTIONS are present, in order. Missing
 *     sections → warning naming the file and the missing section.
 *  3. Orphan pre-run discussion folder with no mission-brief.md → info
 *     (the user started a discussion but never wrote the brief). */
export function checkDiscussions(cwd: string): DiagnosticSection {
	const title = "Discussions";
	const items: DiagnosticItem[] = [];

	// Per-run folders
	const runsRoot = path.join(getSenaiDir(cwd), "runs");
	let runDirs: string[] = [];
	try {
		runDirs = fs.readdirSync(runsRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => path.join(runsRoot, e.name));
	} catch {
		runDirs = [];
	}

	for (const runDir of runDirs) {
		const discussionsDir = path.join(runDir, "discussions");
		let entries: string[] = [];
		try {
			entries = fs.readdirSync(discussionsDir, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => e.name);
		} catch {
			entries = [];
		}
		// Active folders = directories whose name starts with "discussion-".
		const active = entries.filter((n) => /^discussion-/.test(n));
		if (active.length > 1) {
			items.push({
				status: "warning",
				message: `Run ${path.basename(runDir)} has ${active.length} active discussion folders`,
				details: [
					...active.map((a) => `  ${a}`),
					"Multiple active discussions on one run usually means a stale parent left a folder open. Archive the older ones.",
				],
			});
		}

		const briefPath = path.join(runDir, "mission-brief.md");
		if (fs.existsSync(briefPath)) {
			const brief = fs.readFileSync(briefPath, "utf8");
			const missing = validateBriefSections(brief);
			if (missing.length > 0) {
				items.push({
					status: "warning",
					message: `Mission brief in run ${path.basename(runDir)} is missing ${missing.length} required section(s)`,
					details: [...missing.map((m) => `  ${m}`), "Run /senai-discussion to add the missing sections."],
				});
			}
		}
	}

	// Pre-run folder
	const preRunDir = getPreRunDiscussionDir(cwd);
	let preRunEntries: string[] = [];
	try {
		preRunEntries = fs.readdirSync(preRunDir);
	} catch {
		preRunEntries = [];
	}

	const preRunHasBrief = fs.existsSync(path.join(preRunDir, "mission-brief.md"));
	const preRunHasTranscripts = preRunEntries.some((n) => /^discussion-\d{2}-/.test(n));

	if (preRunHasTranscripts && !preRunHasBrief) {
		items.push({
			status: "info",
			message: "Pre-run discussions exist but no mission-brief.md was written.",
			details: ["Run /senai-discussion-approve to finalize the brief, or delete the orphan transcripts."],
		});
	}

	if (preRunHasBrief) {
		const brief = fs.readFileSync(path.join(preRunDir, "mission-brief.md"), "utf8");
		const missing = validateBriefSections(brief);
		if (missing.length > 0) {
			items.push({
				status: "warning",
				message: `Pre-run mission brief is missing ${missing.length} required section(s)`,
				details: [...missing.map((m) => `  ${m}`), "Run /senai-discussion to add the missing sections."],
			});
		}
	}

	if (items.length === 0) {
		items.push({ status: "ok", message: "No discussion artifacts to validate (or all valid)." });
	}

	return { title, items };
}
