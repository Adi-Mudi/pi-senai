import { createRequire } from "node:module";

import { loadAgentConfig, type AgentConfig } from "../core/agents-config/config.js";
import { loadFilesConfig, type FilesConfig } from "../core/agents-config/files-config.js";
import { loadAgentsFilesConfig, type AgentsFilesConfig } from "../core/agents-config/agents-files-config.js";

import { type DiagnosticSection, type DiagnosticReport } from "./_types.js";

import * as ChecksRunState from "./checks-runstate.js";
import * as ChecksConfig from "./checks-config.js";
import * as ChecksAgents from "./checks-agents.js";
import * as ChecksGeneratedTeam from "./checks-generated-team.js";
import * as ChecksEnvironment from "./checks-environment.js";
import * as ChecksDocs from "./checks-docs.js";
import * as ChecksBrainstormAudit from "./checks-brainstorm-audit.js";
import * as ChecksGates from "./checks-gates.js";
import * as ChecksPiExtensionConformance from "./checks-pi-extension-conformance.js";

// The architecture factory and its doctor checks moved to the pi-chirpi
// package (a hard dependency). Senai's doctor calls chirpi's exported check
// functions and shows their sections inline (merged display).
import {
	checkArchitectureSetup,
	checkArchitectureAgentMapping,
	checkGeneratedAgentContent,
	checkArchitectureDrift,
	checkLibraryCompleteness,
	checkFrameworkConfig,
} from "@adi-mudi/pi-chirpi";

// Public type & constant surface — re-exported so existing consumers of
// `../doctor/index.js` keep working unchanged.
export {
	type DiagnosticStatus,
	type DiagnosticItem,
	type DiagnosticSection,
	type DiagnosticReport,
	type ResolvedAgent,
	BUILTIN_AGENT_NAMES,
	CONFLICTING_READONLY_PATTERNS,
	KNOWN_TOOL_NAMES,
	MANDATE_CHECK_ROLES,
	READONLY_ROLES,
	ROLE_REQUIRED_TOOLS,
	VALID_THINKING_LEVELS,
} from "./_types.js";

export {
	compareVersions,
	documentSignalWords,
	isKnownToolName,
	isPathConflict,
	mandateTextForRole,
	resolveSkillFile,
	significantWords,
	validateSkillFile,
	wordsOverlap,
} from "./_helpers.js";

// Public check function surface — re-exported for the same reason.
export {
	checkSetupProgress,
	checkLock,
	checkCadence,
	checkRunArtifacts,
	checkDiscussions,
} from "./checks-runstate.js";

export { checkHardGates } from "./checks-gates.js";

export {
	checkConfigFiles,
	checkFileScope,
	checkAgentsFiles,
} from "./checks-config.js";

export {
	resolveAllAgents,
	checkAgentMappings,
	checkAgentCapabilities,
	checkAgentSkillReferences,
	checkAgentFileIntegrity,
	checkWebToolLock,
} from "./checks-agents.js";

// Architecture check surface now lives in @adi-mudi/pi-chirpi; re-exported
// here so existing consumers of `../doctor/index.js` keep working.
export {
	checkArchitectureSetup,
	checkArchitectureAgentMapping,
	checkGeneratedAgentContent,
	checkArchitectureDrift,
	checkLibraryCompleteness,
} from "@adi-mudi/pi-chirpi";

export {
	checkGeneratedTeamContent,
	checkGeneratedRolesCompleteness,
	checkTechnologyResources,
} from "./checks-generated-team.js";

export {
	checkEnvironment,
	checkSubagentExtension,
	checkStrayFiles,
	checkSecretScan,
} from "./checks-environment.js";

export {
	checkTestingDiscipline,
	checkDocsFactory,
	checkCommunityResearchCache,
} from "./checks-docs.js";

export {
	checkBrainstormAudit,
	parseAuditLog,
	BRAINSTORM_DISPATCH_CAP,
} from "./checks-brainstorm-audit.js";

export {
	checkPiExtensionConformance,
} from "./checks-pi-extension-conformance.js";

/** Hard-stop check: the architecture factory is a hard dependency. When
 *  @adi-mudi/pi-chirpi cannot be resolved, doctor reports an error with the
 *  install command and the chirpi-backed sections are skipped. */
function checkChirpiDependency(): { section: DiagnosticSection; installed: boolean } {
	try {
		createRequire(import.meta.url).resolve("@adi-mudi/pi-chirpi");
		return {
			installed: true,
			section: {
				title: "Chirpi dependency",
				items: [{ status: "ok", message: "@adi-mudi/pi-chirpi is installed (architecture factory)." }],
			},
		};
	} catch {
		return {
			installed: false,
			section: {
				title: "Chirpi dependency",
				items: [
					{
						status: "error",
						message: "@adi-mudi/pi-chirpi is not installed — the architecture factory is unavailable.",
						details: ["Install it with: pi install npm:@adi-mudi/pi-chirpi"],
					},
				],
			},
		};
	}
}

/** Run every doctor check in a fixed order and return the aggregate report. */
export function runSenaiDiagnostic(cwd: string): DiagnosticReport {
	const sections: DiagnosticSection[] = [];

	let agentConfig: AgentConfig | null = null;
	let agentConfigError: string | null = null;
	try {
		agentConfig = loadAgentConfig(cwd);
	} catch (err: any) {
		agentConfigError = err.message;
	}

	let filesConfig: FilesConfig | null = null;
	let filesConfigError: string | null = null;
	try {
		filesConfig = loadFilesConfig(cwd);
	} catch (err: any) {
		filesConfigError = err.message;
	}

	let agentsFilesConfig: AgentsFilesConfig | null = null;
	let agentsFilesConfigError: string | null = null;
	try {
		agentsFilesConfig = loadAgentsFilesConfig(cwd);
	} catch (err: any) {
		agentsFilesConfigError = err.message;
	}

	// Run-state and config come first; they establish the project's current
	// shape and feed the more expensive checks below.
	sections.push(ChecksRunState.checkSetupProgress(cwd));
	sections.push(ChecksRunState.checkLock(cwd));
	sections.push(ChecksRunState.checkCadence(cwd));
	sections.push(ChecksGates.checkHardGates(cwd));
	sections.push(
		ChecksConfig.checkConfigFiles(
			cwd,
			agentConfig,
			filesConfig,
			agentsFilesConfig,
			filesConfigError,
			agentConfigError,
			agentsFilesConfigError,
		),
	);
	sections.push(ChecksRunState.checkDiscussions(cwd));

	// Resolve agents once and feed them into the agent-mapping + skill checks.
	const resolvedAgents = ChecksAgents.resolveAllAgents(cwd, agentConfig);
	sections.push(ChecksAgents.checkAgentMappings(resolvedAgents));
	sections.push(ChecksAgents.checkAgentCapabilities(resolvedAgents));
	sections.push(ChecksAgents.checkWebToolLock(resolvedAgents));
	sections.push(ChecksDocs.checkTestingDiscipline(cwd, filesConfig));
	sections.push(ChecksRunState.checkRunArtifacts(cwd));

	if (filesConfig) {
		sections.push(ChecksConfig.checkFileScope(cwd, filesConfig));
	}
	if (agentsFilesConfig) {
		sections.push(ChecksConfig.checkAgentsFiles(cwd, agentsFilesConfig, filesConfig, resolvedAgents));
	}

	// Environment + subagent extension health.
	sections.push(ChecksEnvironment.checkEnvironment());
	sections.push(ChecksEnvironment.checkSubagentExtension());
	sections.push(ChecksEnvironment.checkStrayFiles(cwd));

	// Chirpi dependency first: it gates every architecture section below.
	const chirpi = checkChirpiDependency();
	sections.push(chirpi.section);

	// Architecture: setup, mapping, generated content, and drift come from
	// pi-chirpi's exported checks. Team agents, generator completeness, and
	// technology resources stay local — they audit senai's sub-agent
	// generator outputs. Drift gets senai's generated team-agent paths so
	// its fix advice points at the right regeneration command.
	if (chirpi.installed) {
		sections.push(checkArchitectureSetup(cwd));
		sections.push(checkArchitectureAgentMapping(cwd, agentConfig));
		sections.push(checkGeneratedAgentContent(cwd));
		sections.push(checkArchitectureDrift(cwd, ChecksGeneratedTeam.generatedTeamAgentPaths(cwd)));
		sections.push(checkFrameworkConfig(cwd));
	} else {
		sections.push({
			title: "Architecture checks",
			items: [{ status: "info", message: "Skipped — @adi-mudi/pi-chirpi is not installed." }],
		});
	}
	sections.push(ChecksGeneratedTeam.checkGeneratedTeamContent(cwd, agentConfig));
	sections.push(ChecksGeneratedTeam.checkGeneratedRolesCompleteness(cwd));
	sections.push(ChecksGeneratedTeam.checkTechnologyResources(cwd));

	// Agent integrity + secret scan.
	sections.push(ChecksAgents.checkAgentSkillReferences(cwd, resolvedAgents));
	sections.push(ChecksAgents.checkAgentFileIntegrity(cwd, resolvedAgents));
	sections.push(ChecksEnvironment.checkSecretScan(cwd));

	// Docs factory + community research cache.
	sections.push(ChecksDocs.checkDocsFactory(cwd));
	sections.push(ChecksDocs.checkCommunityResearchCache(cwd));

	// Phase 6: brainstorm audit — read every brainstorm-dispatch.md the
	// project has produced and surface findings (cap exceeded, suspicious
	// inline scans, skipped decisions, etc.). Always runs, even when no
	// other checks fired.
	sections.push(ChecksBrainstormAudit.checkBrainstormAudit(cwd));

	// Pi extension conformance + library completeness (Phase 6 of the
	// library/factory upgrade). Always run; both adapt to non-Pi projects.
	// Library completeness is owned by pi-chirpi.
	sections.push(ChecksPiExtensionConformance.checkPiExtensionConformance(cwd));
	if (chirpi.installed) {
		sections.push(checkLibraryCompleteness(cwd));
	} else {
		sections.push({
			title: "Library Completeness",
			items: [{ status: "info", message: "Skipped — @adi-mudi/pi-chirpi is not installed." }],
		});
	}

	const summary = sections.reduce(
		(acc, section) => {
			for (const item of section.items) {
				acc[item.status]++;
			}
			return acc;
		},
		{ ok: 0, warning: 0, error: 0, info: 0 },
	);

	return { ok: summary.error === 0, summary, sections };
}

/** Format a DiagnosticReport as a Markdown report for `/senai-doctor`. */
export function formatDiagnosticReport(report: DiagnosticReport): string {
	const lines: string[] = [];
	lines.push("# Pi Senai Diagnostic Report");
	lines.push("");
	lines.push(
		`Summary: ${report.summary.ok} OK, ${report.summary.warning} warnings, ${report.summary.error} errors, ${report.summary.info} info`,
	);
	lines.push("");
	lines.push(report.ok ? "✅ Configuration looks good." : "❌ Please fix the errors above before running Senai stages.");
	lines.push("");

	for (const section of report.sections) {
		lines.push(`## ${section.title}`);
		lines.push("");
		for (const item of section.items) {
			const icon =
				item.status === "ok"
					? "✅"
					: item.status === "warning"
						? "⚠️"
						: item.status === "error"
							? "❌"
							: "ℹ️";
			lines.push(`${icon} ${item.message}`);
			if (item.details) {
				for (const detail of item.details) {
					lines.push(`   - ${detail}`);
				}
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}
