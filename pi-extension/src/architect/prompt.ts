// Builds the LLM prompt that drives the architecture generation task.

import * as path from "node:path";
import { getArchitectStateDir } from "../core/paths.js";
import { getArchitectProfilePath } from "./profile.js";
import { getArchitectReportPath } from "./report.js";
import type { ArchitectProfile } from "./profile.js";

export function buildArchitectPrompt(cwd: string, profile: ArchitectProfile): string {
	const architectStateDir = getArchitectStateDir(cwd);
	return [
		`# Architect Generation Task`,
		``,
		`Project: ${profile.projectName}`,
		`Architecture: ${profile.selectedArchitecture}`,
		``,
		`Read the architectural drivers from ${getArchitectProfilePath(cwd)}.`,
		``,
		"Follow these steps:",
		"1. Load the architecture library from .pi/architecture-library/.",
		"2. Confirm the selected architecture matches the drivers.",
		`3. Write the architect report to ${getArchitectReportPath(cwd)} with these fields:`,
		"   - selectedArchitecture",
		"   - confidence (high|medium|low)",
		"   - missingResources",
		"   - reasoning",
		"   - skillProfile.recommendedAgents",
		"   - skillProfile.forbiddenPatterns",
		"   - developmentOrder (ordered list of implementation steps)",
		"   - feasibility (feasible|risky|not-feasible)",
		"   - feasibilityReasoning",
		"   - techStack (recommended languages, frameworks, platforms)",
		"   - atomicFunctions (small, single-responsibility functions/modules)",
		"   - systemOverview",
		"   - components (name, responsibility, dependencies)",
		"   - interfaces (internal/external APIs and communication patterns)",
		"   - dataFlow",
		"   - dataModel",
		"   - deployment",
		"   - qualityAttributeMapping",
		"   - adrs (architecture decision records)",
		"   - constraints",
		"4. Evaluate feasibility. If not-feasible, stop and notify the user. If risky, ask the user before proceeding.",
		"5. If resources are missing, set missingResources and stop for web search.",
		`6. Generate ${path.join(architectStateDir, "architecture.md")} and ${path.join(architectStateDir, "adrs")}/*.md from the report.`,
		"7. Generate project-specific agents in .pi/agents/.",
		"8. Generate project-specific skills in .pi/skills/<project>-<architecture-id>-<stage>/SKILL.md.",
		"",
		"Do not proceed to agent generation if confidence is low and missingResources is not empty.",
	].join("\n");
}
