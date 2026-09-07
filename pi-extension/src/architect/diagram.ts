// Mermaid diagram builders for architecture.md.
// Three diagrams: system context, container/components, typical interaction flow.

import type { ArchitectReport } from "./report.js";
import { slugify } from "./helpers.js";

export function buildSystemContextMermaid(report: ArchitectReport): string {
	const externals = report.interfaces.filter((i) => i.type === "external").map((i) => i.name);
	const lines = ["graph TD"];
	lines.push("    User((User))");
	lines.push(`    System[${report.selectedArchitecture}]`);
	lines.push("    User --> System");
	for (const ext of externals) {
		const id = `id_${slugify(ext)}`;
		lines.push(`    ${id}[${ext}]`);
		lines.push(`    System --> ${id}`);
	}
	return lines.join("\n");
}

export function buildContainerMermaid(report: ArchitectReport): string {
	const lines = ["graph TD"];
	for (const comp of report.components) {
		const id = `id_${slugify(comp.name)}`;
		lines.push(`    ${id}[${comp.name}]`);
	}
	for (const comp of report.components) {
		const from = `id_${slugify(comp.name)}`;
		for (const dep of comp.dependencies) {
			const to = `id_${slugify(dep)}`;
			lines.push(`    ${from} --> ${to}`);
		}
	}
	return lines.join("\n");
}

export function buildSequenceMermaid(report: ArchitectReport): string {
	const lines = ["sequenceDiagram"];
	lines.push("    actor U as User");
	const participants = report.components.slice(0, 6);
	for (const comp of participants) {
		const id = `id_${slugify(comp.name)}`;
		lines.push(`    participant ${id} as ${comp.name}`);
	}
	if (participants.length === 0) {
		lines.push("    participant System");
		lines.push("    U->>System: initiates request");
		lines.push("    System-->>U: returns result");
	} else {
		const firstId = `id_${slugify(participants[0].name)}`;
		const lastId = `id_${slugify(participants[participants.length - 1].name)}`;
		lines.push(`    U->>${firstId}: initiates request`);
		for (let i = 0; i < participants.length - 1; i++) {
			const from = `id_${slugify(participants[i].name)}`;
			const to = `id_${slugify(participants[i + 1].name)}`;
			lines.push(`    ${from}->>${to}: processes`);
		}
		lines.push(`    ${lastId}-->>U: returns result`);
	}
	return lines.join("\n");
}
