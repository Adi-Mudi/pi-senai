import * as fs from "node:fs";
import * as path from "node:path";
import { discoverArchitectureLibrary } from "../architect/index.js";
import { loadArchitectInputsConfig } from "../architect/inputs-config.js";
import type { DiagnosticItem, DiagnosticSection } from "./_types.js";

const REQUIRED_PI_EXTENSION_DOMAINS = [
	"pi-extension",
	"pi-extension-spec",
	"pi-extension-project",
];

export function checkLibraryCompleteness(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	const libraryDir = path.join(cwd, ".pi", "architecture-library");
	if (!fs.existsSync(libraryDir)) {
		items.push({
			status: "warning",
			message: ".pi/architecture-library/ does not exist.",
			details: ["Run `/senai-configure-architect-inputs` first to set up architecture inputs."],
		});
		return { title: "Library Completeness", items };
	}

	const entries = discoverArchitectureLibrary(cwd);
	items.push({
		status: "ok",
		message: `Found ${entries.length} architecture-library entries.`,
	});

	for (const required of REQUIRED_PI_EXTENSION_DOMAINS) {
		const matches = entries.filter((e) => e.domain.includes(required));
		if (matches.length === 0) {
			items.push({
				status: "warning",
				message: `Library is missing entries with domain "${required}".`,
				details: [
					"Add library entries tagged with this domain so the factory can recommend Pi extension patterns.",
				],
			});
		} else {
			items.push({
				status: "ok",
				message: `Library has ${matches.length} entries for domain "${required}".`,
			});
		}
	}

	let inputsConfig = null;
	try {
		inputsConfig = loadArchitectInputsConfig(cwd);
	} catch {
		inputsConfig = null;
	}
	if (inputsConfig) {
		const configDomains = new Set<string>();
		for (const doc of inputsConfig.documents) {
			configDomains.add(doc.type);
		}
		const libraryDomains = new Set<string>();
		for (const entry of entries) {
			for (const d of entry.domain) libraryDomains.add(d);
		}
		const missingFromLibrary: string[] = [];
		for (const docType of configDomains) {
			if (!libraryDomains.has(docType)) {
				missingFromLibrary.push(docType);
			}
		}
		if (missingFromLibrary.length > 0) {
			items.push({
				status: "info",
				message: `Document types in architect-inputs.json without library coverage: ${missingFromLibrary.join(", ")}.`,
				details: [
					"Consider adding library entries for these types or updating architect-inputs.json.",
				],
			});
		} else {
			items.push({
				status: "ok",
				message: "All document types in architect-inputs.json have library coverage.",
			});
		}
	}

	const malformed: string[] = [];
	for (const file of fs.readdirSync(libraryDir)) {
		if (!file.endsWith(".md")) continue;
		try {
			const content = fs.readFileSync(path.join(libraryDir, file), "utf8");
			if (!/^---\n[\s\S]*?\n---/.test(content)) {
				malformed.push(file);
				continue;
			}
			if (!/^name:\s*\S+/m.test(content)) {
				malformed.push(file);
			}
		} catch {
			malformed.push(file);
		}
	}
	if (malformed.length > 0) {
		items.push({
			status: "warning",
			message: `${malformed.length} library entries are missing frontmatter or name: ${malformed.join(", ")}.`,
		});
	}

	return { title: "Library Completeness", items };
}