// ArchitectReport I/O — read, write, normalize, and resolve the report file path.
// Report is the LLM-generated architecture document (confidence, components, ADRs, etc.).

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../io/atomic-write.js";
import { getArchitectStateDir } from "../core/paths.js";

export const ARCHITECT_REPORT_FILE = "architect-report.json";

export interface ArchitectComponent {
	name: string;
	responsibility: string;
	dependencies: string[];
}

export interface ArchitectInterface {
	name: string;
	type: "internal" | "external";
	description: string;
}

export interface ArchitectAdr {
	id: string;
	title: string;
	context: string;
	decision: string;
	consequences: string;
}

export interface ArchitectQualityMapping {
	qualityAttribute: string;
	decision: string;
}

export interface ArchitectReport {
	selectedArchitecture: string;
	confidence: "high" | "medium" | "low";
	missingResources: string[];
	reasoning: string;
	skillProfile: {
		recommendedAgents: string[];
		forbiddenPatterns: string[];
	};
	developmentOrder: string[];
	feasibility: "feasible" | "risky" | "not-feasible";
	feasibilityReasoning: string;
	techStack: string[];
	atomicFunctions: string[];
	systemOverview: string;
	components: ArchitectComponent[];
	interfaces: ArchitectInterface[];
	dataFlow: string;
	dataModel: string;
	deployment: string;
	qualityAttributeMapping: ArchitectQualityMapping[];
	adrs: ArchitectAdr[];
	constraints: string[];
}

export function getArchitectReportPath(cwd: string): string {
	return path.join(getArchitectStateDir(cwd), ARCHITECT_REPORT_FILE);
}

export function loadArchitectReport(cwd: string): ArchitectReport | null {
	const reportPath = getArchitectReportPath(cwd);
	try {
		const raw = fs.readFileSync(reportPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

		const normalized = { ...record } as unknown as ArchitectReport;

		if (Array.isArray(record.adrs)) {
			normalized.adrs = record.adrs
				.map((adr: unknown): ArchitectAdr | null => {
					if (typeof adr === "string") {
						const trimmed = adr.trim();
						if (!trimmed) return null;
						const match = trimmed.match(/^(ADR-\d+)[:\s]+(.+)$/);
						if (match) {
							return {
								id: match[1],
								title: match[2].trim(),
								context: "",
								decision: "",
								consequences: "",
							};
						}
						return {
							id: "ADR-000",
							title: trimmed,
							context: "",
							decision: "",
							consequences: "",
						};
					}
					if (adr && typeof adr === "object") {
						const obj = adr as Record<string, unknown>;
						const id = typeof obj.id === "string" && obj.id.trim() !== "" ? obj.id.trim() : "";
						const title = typeof obj.title === "string" && obj.title.trim() !== "" ? obj.title.trim() : "";
						if (!id || !title) return null;
						return {
							id,
							title,
							context: typeof obj.context === "string" ? obj.context : "",
							decision: typeof obj.decision === "string" ? obj.decision : "",
							consequences: typeof obj.consequences === "string" ? obj.consequences : "",
						};
					}
					return null;
				})
				.filter((adr): adr is ArchitectAdr => adr !== null);
		}

		// Older reports store confidence as a number (e.g. 95). Normalize it to
		// the string scale so downstream checks read it correctly.
		if (typeof record.confidence === "number" && Number.isFinite(record.confidence)) {
			normalized.confidence =
				record.confidence >= 80 ? "high" : record.confidence >= 50 ? "medium" : "low";
		}

		return normalized;
	} catch (err: any) {
		if (err.code === "ENOENT") return null;
		throw new Error(`Invalid architect report at ${reportPath}: ${err.message}`);
	}
}

export function saveArchitectReport(cwd: string, report: ArchitectReport): void {
	atomicWriteJson(getArchitectReportPath(cwd), report);
}
