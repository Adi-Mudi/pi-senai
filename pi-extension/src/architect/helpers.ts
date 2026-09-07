// Generic helpers used across the architect factory.
// Pure functions, no I/O, no side effects.

import type { ArchitecturalDrivers } from "./drivers.js";

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
}

export function parseStringArray(value: unknown): string[] | undefined {
	if (typeof value === "string") {
		return value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	if (Array.isArray(value)) {
		return value
			.map((s) => String(s).trim())
			.filter(Boolean);
	}
	return undefined;
}

export function buildDriverText(drivers: ArchitecturalDrivers): string {
	const parts: string[] = [];
	for (const fr of drivers.functionalRequirements) parts.push(fr.description);
	for (const qa of drivers.qualityAttributes) {
		parts.push(qa.category);
		parts.push(qa.description);
		if (qa.target) parts.push(qa.target);
	}
	for (const c of drivers.constraints) {
		parts.push(c.category);
		parts.push(c.description);
	}
	for (const tc of drivers.technicalConcerns) parts.push(tc.description);
	return parts.join(" ");
}

/** Extracts the bullet/numbered rules from a markdown library entry's
 *  "## Core rules" section. Stops at the next "## " heading. */
export function extractArchitectureRules(content: string): string[] {
	const rules: string[] = [];
	const lines = content.split("\n");
	let inRules = false;
	for (const line of lines) {
		if (/^## Core rules/i.test(line)) {
			inRules = true;
			continue;
		}
		if (inRules && line.startsWith("## ")) {
			break;
		}
		if (inRules && /^\d+\./.test(line.trim())) {
			rules.push(line.trim().replace(/^\d+\.\s*/, ""));
		}
	}
	return rules;
}
