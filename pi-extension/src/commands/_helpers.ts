// Shared helpers for the commands/ subfolder.
// Phase 3l.1: extracted from commands/index.ts.
// - ensureStage
// - checkStageArtifact
// - listMissingStageArtifacts
// - ensureAgentConfig (and its private helpers validateTruthDocuments, dirHasFiles,
//   isNonEmptyFile)

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadAgentConfig, validateMappedAgents } from "../agents/config.js";
import {
	loadAgentsFilesConfig,
	validateAgentsFilesConfig,
	type AgentsFilesConfig,
} from "../agents/agents-files-config.js";
import { loadFilesConfig, validateFilesConfig } from "../agents/files-config.js";
import { getArtifactPaths } from "../core/paths.js";
import type { SenaiState } from "../core/state.js";
import { SENAI_ROLES, ROLE_LABELS } from "../agents/suggestions.js";

const REQUIRED_STAGE_FOR_MANUAL_COMMAND: Record<"planned" | "implemented" | "documented", SenaiState["currentStage"]> = {
	planned: "planned",
	implemented: "implemented",
	documented: "documented",
};

export const COMPLETED_STAGE_ARTIFACT: Record<string, "plan" | "implement" | "document" | "deliver"> = {
	planning: "plan",
	implementing: "implement",
	documenting: "document",
	delivering: "deliver",
};

export function ensureStage(
	_cwd: string,
	state: SenaiState,
	targetStage: "planned" | "implemented" | "documented",
): { ok: true; state: SenaiState } | { ok: false; reason: string } {
	const required = REQUIRED_STAGE_FOR_MANUAL_COMMAND[targetStage];
	if (state.currentStage === required) {
		return { ok: true, state };
	}
	if (state.currentStage === "none") {
		return { ok: false, reason: "No active run. Start with /senai-plan <mission>." };
	}
	return {
		ok: false,
		reason: `Manual command can only run from '${required}'. Current stage is '${state.currentStage}'. Run /senai-status to see the next step.`,
	};
}

function dirHasFiles(dir: string): boolean {
	try {
		return fs.readdirSync(dir).length > 0;
	} catch {
		return false;
	}
}

function isNonEmptyFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).size > 0;
	} catch {
		return false;
	}
}

export function checkStageArtifact(
	state: SenaiState,
	stage: "plan" | "implement" | "document" | "deliver",
	ctx: ExtensionContext,
): { ok: true } | { ok: false } {
	if (state.currentStage === "none") {
		ctx.ui.notify("No active run. Start with /senai-plan <mission>", "warning");
		return { ok: false };
	}
	if (!state.runId) {
		ctx.ui.notify("Run ID is missing. Start a new run with /senai-plan.", "error");
		return { ok: false };
	}

	const artifacts = getArtifactPaths(ctx.cwd, state.runId);

	if (stage === "plan") {
		const missing: string[] = [];
		if (!fs.existsSync(artifacts.plan)) missing.push(artifacts.plan);
		for (const scoutPath of [
			artifacts.scoutAngle1,
			artifacts.scoutAngle2,
			artifacts.scoutAngle3,
			artifacts.scoutAngle4,
		]) {
			if (!fs.existsSync(scoutPath)) missing.push(scoutPath);
		}
		if (missing.length > 0) {
			ctx.ui.notify(
				`Plan artifacts not found: ${missing.join(", ")}. Complete the Plan stage first.`,
				"warning",
			);
			return { ok: false };
		}
	}

	if (stage === "implement") {
		if (!dirHasFiles(artifacts.implementDir)) {
			ctx.ui.notify(
				`Implement artifacts not found in ${artifacts.implementDir}. Complete the Implement stage first.`,
				"warning",
			);
			return { ok: false };
		}
	}

	if (stage === "document") {
		if (!dirHasFiles(artifacts.documentDir)) {
			ctx.ui.notify(
				`Document artifacts not found in ${artifacts.documentDir}. Complete the Document stage first.`,
				"warning",
			);
			return { ok: false };
		}
	}

	if (stage === "deliver") {
		const missing: string[] = [];
		if (!fs.existsSync(artifacts.securityReport)) missing.push(artifacts.securityReport);
		if (!fs.existsSync(artifacts.deliverSummary)) missing.push(artifacts.deliverSummary);
		if (missing.length > 0) {
			ctx.ui.notify(
				`Deliver artifacts not found: ${missing.join(", ")}. Complete the Deliver stage first.`,
				"warning",
			);
			return { ok: false };
		}
	}

	return { ok: true };
}

export function listMissingStageArtifacts(
	cwd: string,
	runId: string,
	stage: "plan" | "implement" | "document" | "deliver",
): string[] {
	const artifacts = getArtifactPaths(cwd, runId);
	if (stage === "plan") {
		const required: Array<[string, string]> = [
			["plan/plan.md", artifacts.plan],
			["plan/scouts/scout-angle_1.md", artifacts.scoutAngle1],
			["plan/scouts/scout-angle_2.md", artifacts.scoutAngle2],
			["plan/scouts/scout-angle_3.md", artifacts.scoutAngle3],
			["plan/scouts/scout-angle_4.md", artifacts.scoutAngle4],
		];
		return required.filter(([, p]) => !isNonEmptyFile(p)).map(([label]) => label);
	}
	if (stage === "implement") {
		return dirHasFiles(artifacts.implementDir) ? [] : ["implement/ (no files)"];
	}
	if (stage === "document") {
		return dirHasFiles(artifacts.documentDir) ? [] : ["document/ (no files)"];
	}
	const required: Array<[string, string]> = [
		["deliver/security-report.md", artifacts.securityReport],
		["deliver/deliver-summary.md", artifacts.deliverSummary],
	];
	return required.filter(([, p]) => !isNonEmptyFile(p)).map(([label]) => label);
}

function validateTruthDocuments(cwd: string, config: AgentsFilesConfig | null): string[] {
	const errors: string[] = [];
	if (!config) return errors;
	for (const role of SENAI_ROLES) {
		const docs = config.documents[role];
		if (!docs?.primary) continue;
		const fullPath = path.resolve(cwd, docs.primary);
		if (!fs.existsSync(fullPath)) {
			errors.push(
				`Truth document for ${ROLE_LABELS[role]} (${role}) not found: ${docs.primary}`,
			);
		}
	}
	return errors;
}

export function ensureAgentConfig(cwd: string, ctx: ExtensionContext): boolean {
	const config = loadAgentConfig(cwd);
	if (!config) {
		ctx.ui.notify(
			"No Pi Senai agent configuration found. Run /senai-generate-sub-agents to generate your team, or /senai-configure-agents to configure agents manually.",
			"warning",
		);
		return false;
	}
	const errors = validateMappedAgents(cwd, config);

	const filesConfig = loadFilesConfig(cwd);
	if (!filesConfig) {
		errors.push("No project files configured. Please run /senai-configure-files first.");
	} else {
		try {
			validateFilesConfig(filesConfig);
		} catch (err: any) {
			errors.push(`Files config error: ${err.message}`);
		}
	}

	const agentsFilesConfig = loadAgentsFilesConfig(cwd);
	if (!agentsFilesConfig) {
		errors.push("No agent document assignments configured. Please run /senai-configure-agents-files first.");
	} else {
		try {
			validateAgentsFilesConfig(agentsFilesConfig);
			errors.push(...validateTruthDocuments(cwd, agentsFilesConfig));
		} catch (err: any) {
			errors.push(`Agent files config error: ${err.message}`);
		}
	}

	if (errors.length > 0) {
		ctx.ui.notify("Agent configuration errors:\n" + errors.join("\n"), "error");
		return false;
	}
	return true;
}
