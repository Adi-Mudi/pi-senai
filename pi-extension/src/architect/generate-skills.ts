// Generates project-specific stage skills in .pi/skills/<project>-<archId>-<stage>/SKILL.md
// from a selected architecture.

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "../io/atomic-write.js";
import { slugify } from "./helpers.js";
import { ARCHITECT_STAGES } from "./cleanup.js";
import type { ArchitectProfile } from "./profile.js";
import type { ArchitectureLibraryEntry } from "./library-scan.js";

export function generateSkillFiles(
	cwd: string,
	profile: ArchitectProfile,
	architecture: ArchitectureLibraryEntry,
): string[] {
	const skillsDir = path.join(cwd, ".pi", "skills");
	fs.mkdirSync(skillsDir, { recursive: true });

	const created: string[] = [];
	const archId = architecture.id || slugify(architecture.name);

	for (const stage of ARCHITECT_STAGES) {
		const skillName = `${profile.projectSlug}-${archId}-${stage}`;
		const skillDir = path.join(skillsDir, skillName);
		fs.mkdirSync(skillDir, { recursive: true });
		const filePath = path.join(skillDir, "SKILL.md");

		const content = buildSkillMarkdown(skillName, stage, profile, architecture);
		atomicWriteFile(filePath, content, "utf8");
		created.push(filePath);
	}

	return created;
}

function buildSkillMarkdown(
	skillName: string,
	stage: string,
	profile: ArchitectProfile,
	architecture: ArchitectureLibraryEntry,
): string {
	const stageDescription: Record<string, string> = {
		plan: "Plan the implementation following the selected architecture",
		implement: "Implement code following the selected architecture",
		document: "Document the project and its architecture decisions",
		deliver: "Run final checks and package the deliverable",
	};

	const baseLines = [
		"---",
		`name: ${skillName}`,
		`description: ${stageDescription[stage]} for ${profile.projectName}`,
		"---",
		"",
		`# ${skillName}`,
		"",
		`${stageDescription[stage]} for ${profile.projectName}.`,
		"",
		`Architecture: ${architecture.name}`,
	];

	if (architecture.id === "pi-architecture") {
		baseLines.push("");
		baseLines.push("## Pi Extension Compliance");
		baseLines.push("");
		baseLines.push("This project follows Pi's official architecture. Before any action:");
		baseLines.push(
			"- Read the Pi extension docs at https://pi.dev/docs/latest/skills and https://app.unpkg.com/@mariozechner/pi-coding-agent@latest/files/docs/extensions.md.",
		);
		baseLines.push("- Use `ctx.cwd` not `process.cwd()` for all file operations.");
		baseLines.push("- Respect the layered architecture: lower layers never import from higher layers.");
		baseLines.push("- Run all writes through the extension's atomic-write helper.");
	}

	baseLines.push(
		"",
		"## Rules",
		"",
		`- Follow the ${architecture.name} architecture.`,
		"- Respect the project constraints and quality attributes in .pi/architect/architectural-drivers.json.",
		"- Read .pi/architect/architecture.md and relevant ADRs in .pi/architect/adrs/ before acting.",
		"- Do not use patterns listed as forbidden in the architecture library.",
	);

	return baseLines.join("\n");
}
