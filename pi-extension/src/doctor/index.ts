import { loadAgentConfig, type AgentConfig } from "../agents/config.js";
import { loadFilesConfig, type FilesConfig } from "../agents/files-config.js";
import { loadAgentsFilesConfig, type AgentsFilesConfig } from "../agents/agents-files-config.js";

import {
	type DiagnosticSection,
	type DiagnosticReport,
} from "./_types.js";
import * as ChecksRunState from "./checks-runstate.js";
import * as ChecksConfig from "./checks-config.js";
import * as ChecksAgents from "./checks-agents.js";
import * as ChecksArchitecture from "./checks-architecture.js";
import * as ChecksEnvironment from "./checks-environment.js";
import * as ChecksDocs from "./checks-docs.js";

// Re-export so existing consumers of `../doctor/index.js` keep working.
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

  sections.push(ChecksRunState.checkSetupProgress(cwd));
  sections.push(ChecksRunState.checkLock(cwd));
  sections.push(ChecksRunState.checkCadence(cwd));
  sections.push(ChecksConfig.checkConfigFiles(cwd, agentConfig, filesConfig, agentsFilesConfig, filesConfigError, agentConfigError, agentsFilesConfigError));
  sections.push(ChecksRunState.checkDiscussions(cwd));

  const resolvedAgents = ChecksAgents.resolveAllAgents(cwd, agentConfig);
  sections.push(ChecksAgents.checkAgentMappings(resolvedAgents));
  sections.push(ChecksAgents.checkAgentCapabilities(resolvedAgents));
  sections.push(ChecksDocs.checkTestingDiscipline(cwd, filesConfig));
  sections.push(ChecksRunState.checkRunArtifacts(cwd));

  if (filesConfig) {
    sections.push(ChecksConfig.checkFileScope(cwd, filesConfig));
  }

  if (agentsFilesConfig) {
    sections.push(ChecksConfig.checkAgentsFiles(cwd, agentsFilesConfig, filesConfig, resolvedAgents));
  }

  sections.push(ChecksEnvironment.checkEnvironment());
  sections.push(ChecksEnvironment.checkSubagentExtension());
  sections.push(ChecksEnvironment.checkStrayFiles(cwd));
  sections.push(ChecksArchitecture.checkArchitectureSetup(cwd));
  sections.push(ChecksArchitecture.checkArchitectureAgentMapping(cwd, agentConfig));
  sections.push(ChecksArchitecture.checkGeneratedAgentContent(cwd));
  sections.push(ChecksArchitecture.checkArchitectureDrift(cwd));
  sections.push(ChecksArchitecture.checkGeneratedTeamContent(cwd, agentConfig));
  sections.push(ChecksArchitecture.checkGeneratedRolesCompleteness(cwd));
  sections.push(ChecksArchitecture.checkTechnologyResources(cwd));
  sections.push(ChecksAgents.checkAgentSkillReferences(cwd, resolvedAgents));
  sections.push(ChecksAgents.checkAgentFileIntegrity(cwd, resolvedAgents));
  sections.push(ChecksEnvironment.checkSecretScan(cwd));
  sections.push(ChecksDocs.checkDocsFactory(cwd));
  sections.push(ChecksDocs.checkCommunityResearchCache(cwd));

  const summary = sections.reduce(
    (acc, section) => {
      for (const item of section.items) {
        acc[item.status]++;
      }
      return acc;
    },
    { ok: 0, warning: 0, error: 0, info: 0 },
  );

  const ok = summary.error === 0;

  return { ok, summary, sections };
}

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

export {
	checkSetupProgress,
	checkLock,
	checkCadence,
	checkRunArtifacts,
	checkDiscussions,
} from "./checks-runstate.js";

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
} from "./checks-agents.js";

export {
  checkArchitectureSetup,
  checkArchitectureAgentMapping,
  checkGeneratedAgentContent,
  checkArchitectureDrift,
  checkGeneratedTeamContent,
  checkGeneratedRolesCompleteness,
  checkTechnologyResources,
} from "./checks-architecture.js";

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
