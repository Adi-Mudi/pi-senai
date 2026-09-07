// Generates the human-readable architecture.md and per-ADR .md files
// from a profile + report. Also contains the markdown builders used by
// /senai-generate-architect.

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "../io/atomic-write.js";
import { getArchitectStateDir } from "../core/paths.js";
import { slugify } from "./helpers.js";
import {
	buildContainerMermaid,
	buildSequenceMermaid,
	buildSystemContextMermaid,
} from "./diagram.js";
import type { ArchitectAdr, ArchitectReport } from "./report.js";
import type { ArchitectProfile } from "./profile.js";

export function generateArchitectureDocs(
	cwd: string,
	profile: ArchitectProfile,
	report: ArchitectReport,
): string[] {
	const docsDir = getArchitectStateDir(cwd);
	const adrsDir = path.join(docsDir, "adrs");
	fs.mkdirSync(adrsDir, { recursive: true });

	const created: string[] = [];

	const architecturePath = path.join(docsDir, "architecture.md");
	atomicWriteFile(architecturePath, buildArchitectureMarkdown(profile, report), "utf8");
	created.push(architecturePath);

	// Regeneration replaces the ADR set: remove old ADRs so the folder always
	// matches the current report exactly.
	for (const entry of fs.readdirSync(adrsDir)) {
		if (!entry.endsWith(".md")) continue;
		try {
			fs.unlinkSync(path.join(adrsDir, entry));
		} catch {
			// Ignore deletion failures.
		}
	}

	for (const adr of report.adrs) {
		const adrFileName = `${adr.id}-${slugify(adr.title)}.md`;
		const adrPath = path.join(adrsDir, adrFileName);
		atomicWriteFile(adrPath, buildAdrMarkdown(adr), "utf8");
		created.push(adrPath);
	}

	return created;
}

function buildArchitectureMarkdown(profile: ArchitectProfile, report: ArchitectReport): string {
	const lines: string[] = [
		"# Software Architecture",
		"",
		`Project: ${profile.projectName}`,
		`Selected architecture: ${report.selectedArchitecture}`,
		`Confidence: ${report.confidence}`,
		`Feasibility: ${report.feasibility}`,
		"",
		"## System overview",
		"",
		report.systemOverview || "Not provided.",
		"",
		"## Architecture diagrams",
		"",
		"### System context",
		"",
		"```mermaid",
		buildSystemContextMermaid(report),
		"```",
		"",
		"### Containers and components",
		"",
		"```mermaid",
		buildContainerMermaid(report),
		"```",
		"",
		"### Typical interaction flow",
		"",
		"```mermaid",
		buildSequenceMermaid(report),
		"```",
		"",
		"## Components",
		"",
	];

	if (report.components.length > 0) {
		for (const component of report.components) {
			lines.push(`### ${component.name}`);
			lines.push("");
			lines.push(`- Responsibility: ${component.responsibility}`);
			if (component.dependencies.length > 0) {
				lines.push(`- Dependencies: ${component.dependencies.join(", ")}`);
			}
			lines.push("");
		}
	} else {
		lines.push("No components defined.");
		lines.push("");
	}

	lines.push("## Interfaces");
	lines.push("");
	if (report.interfaces.length > 0) {
		for (const iface of report.interfaces) {
			lines.push(`- **${iface.name}** (${iface.type}): ${iface.description}`);
		}
	} else {
		lines.push("No interfaces defined.");
	}
	lines.push("");

	lines.push("## Data flow");
	lines.push("");
	lines.push(report.dataFlow || "Not provided.");
	lines.push("");

	lines.push("## Data model");
	lines.push("");
	lines.push(report.dataModel || "Not provided.");
	lines.push("");

	lines.push("## Deployment");
	lines.push("");
	lines.push(report.deployment || "Not provided.");
	lines.push("");

	lines.push("## Technology stack");
	lines.push("");
	if (report.techStack.length > 0) {
		for (const tech of report.techStack) {
			lines.push(`- ${tech}`);
		}
	} else {
		lines.push("No technology stack defined.");
	}
	lines.push("");

	lines.push("## Development order");
	lines.push("");
	if (report.developmentOrder.length > 0) {
		for (let i = 0; i < report.developmentOrder.length; i++) {
			lines.push(`${i + 1}. ${report.developmentOrder[i]}`);
		}
	} else {
		lines.push("No development order defined.");
	}
	lines.push("");

	lines.push("## Atomic functions");
	lines.push("");
	if (report.atomicFunctions.length > 0) {
		for (const fn of report.atomicFunctions) {
			lines.push(`- ${fn}`);
		}
	} else {
		lines.push("No atomic functions defined.");
	}
	lines.push("");

	lines.push("## Quality attribute mapping");
	lines.push("");
	if (report.qualityAttributeMapping.length > 0) {
		for (const mapping of report.qualityAttributeMapping) {
			lines.push(`- **${mapping.qualityAttribute}**: ${mapping.decision}`);
		}
	} else {
		lines.push("No quality attribute mapping defined.");
	}
	lines.push("");

	lines.push("## Constraints");
	lines.push("");
	if (report.constraints.length > 0) {
		for (const constraint of report.constraints) {
			lines.push(`- ${constraint}`);
		}
	} else {
		lines.push("No constraints defined.");
	}
	lines.push("");

	lines.push("## Architecture Decision Records");
	lines.push("");
	if (report.adrs.length > 0) {
		for (const adr of report.adrs) {
			lines.push(`- [${adr.id} ${adr.title}](adrs/${adr.id}-${slugify(adr.title)}.md)`);
		}
	} else {
		lines.push("No ADRs defined.");
	}
	lines.push("");

	lines.push("## Reasoning");
	lines.push("");
	lines.push(report.reasoning || "Not provided.");
	lines.push("");

	lines.push("## Feasibility reasoning");
	lines.push("");
	lines.push(report.feasibilityReasoning || "Not provided.");
	lines.push("");

	if (report.selectedArchitecture === "pi-architecture") {
		lines.push("## Pi Extension Mandatory Rules");
		lines.push("");
		lines.push("This project follows Pi's official architecture. The generated agents and skills must obey these rules:");
		lines.push("");
		lines.push("1. Layered codebase: `ai` → `agent` → `coding-agent` → `tui`. Lower layers never import from higher layers.");
		lines.push("2. Extensions import from `@mariozechner/pi-coding-agent` and `@sinclair/typebox` only, listed in `peerDependencies` with `\"*\"` range.");
		lines.push("3. All session-related files are written through atomic helpers (temp + fsync + rename).");
		lines.push("4. Every skill is a folder under `skills/` containing `SKILL.md` with required frontmatter (`name`, `description`).");
		lines.push("5. Every agent is a `.md` file under `.pi/agents/` with required frontmatter (`name`, `description`, `tools`).");
		lines.push("6. Extensions subscribe to lifecycle events via `pi.on(event, handler)` and may return `{ block: true, reason }` for `tool_call` only.");
		lines.push("7. Tools use TypeBox `Type.Object({...})` parameters; never raw objects.");
		lines.push("8. Long-running handlers use `ctx.signal` for cancellation parity.");
		lines.push("9. Run state persists under `.IDE_Plans/<ext>/runs/<run-id>/`; never write outside the configured directories.");
		lines.push("10. Commands are registered one per file under `commands/`; handlers stay thin.");
		lines.push("11. The composition root (`src/index.ts`) only wires, never contains business logic.");
		lines.push("12. Test layout mirrors source layout one-to-one; E2E tests live under `test/e2e/`.");
		lines.push("");
		lines.push("See `.pi/architecture-library/pi-architecture.md` for the full spec.");
	}

	return lines.join("\n");
}

function buildAdrMarkdown(adr: ArchitectAdr): string {
	return [
		"---",
		`name: ${adr.id}-${slugify(adr.title)}`,
		`description: ${adr.title}`,
		"---",
		"",
		`# ${adr.id}: ${adr.title}`,
		"",
		"## Context",
		"",
		adr.context || "Not provided.",
		"",
		"## Decision",
		"",
		adr.decision || "Not provided.",
		"",
		"## Consequences",
		"",
		adr.consequences || "Not provided.",
		"",
	].join("\n");
}
