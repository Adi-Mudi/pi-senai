// Scans the .pi/architecture-library/ directory and returns parsed entries.
// Reads both .md (with YAML frontmatter) and .json files.

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { parseStringArray, slugify } from "./helpers.js";

export interface ArchitectureLibraryEntry {
	id: string;
	name: string;
	filePath: string;
	domain: string[];
	teamSize: string;
	complexity: string;
	bestForDrivers: string[];
	notForDrivers: string[];
	content: string;
}

export function discoverArchitectureLibrary(cwd: string): ArchitectureLibraryEntry[] {
	const libraryDir = path.join(cwd, ".pi", "architecture-library");
	if (!fs.existsSync(libraryDir)) return [];

	const entries: ArchitectureLibraryEntry[] = [];
	const files = fs.readdirSync(libraryDir);

	for (const file of files) {
		const filePath = path.join(libraryDir, file);
		try {
			if (file.endsWith(".md")) {
				const content = fs.readFileSync(filePath, "utf8");
				const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
				const name = String(frontmatter.name ?? "").trim();
				if (!name) continue;
				const id = String(frontmatter.id ?? "").trim() || slugify(name);

				entries.push({
					id,
					name,
					filePath,
					domain: parseStringArray(frontmatter.domain) ?? [],
					teamSize: String(frontmatter["team-size"] ?? ""),
					complexity: String(frontmatter.complexity ?? ""),
					bestForDrivers: parseStringArray(frontmatter["best-for-drivers"]) ?? [],
					notForDrivers: parseStringArray(frontmatter["not-for-drivers"]) ?? [],
					content,
				});
			} else if (file.endsWith(".json")) {
				const raw = fs.readFileSync(filePath, "utf8");
				const parsed = JSON.parse(raw) as unknown;
				const items = Array.isArray(parsed) ? parsed : [parsed];
				for (const item of items) {
					if (!item || typeof item !== "object") continue;
					const name = String((item as any).name ?? "").trim();
					if (!name) continue;
					const id = String((item as any).id ?? "").trim() || slugify(name);
					const contentParts: string[] = [];
					if ((item as any).description) contentParts.push(String((item as any).description));
					if ((item as any).platform) contentParts.push(`Platform: ${String((item as any).platform)}`);
					if ((item as any).runtime) contentParts.push(`Runtime: ${String((item as any).runtime)}`);
					if ((item as any).style) contentParts.push(`Style: ${String((item as any).style)}`);
					if (Array.isArray((item as any).strengths)) {
						contentParts.push("Strengths: " + (item as any).strengths.join(", "));
					}
					if (Array.isArray((item as any).weaknesses)) {
						contentParts.push("Weaknesses: " + (item as any).weaknesses.join(", "));
					}
					if ((item as any).fitRationale) contentParts.push(String((item as any).fitRationale));
					if ((item as any).qualityAttributeSupport) {
						contentParts.push("Quality attributes: " + JSON.stringify((item as any).qualityAttributeSupport));
					}

					entries.push({
						id,
						name,
						filePath,
						domain: parseStringArray((item as any).platform ?? (item as any).domain) ?? [],
						teamSize: String((item as any).teamSize ?? (item as any)["team-size"] ?? ""),
						complexity: String((item as any).complexity ?? ""),
						bestForDrivers: parseStringArray((item as any).bestForDrivers ?? (item as any)["best-for-drivers"]) ?? [],
						notForDrivers: parseStringArray((item as any).notForDrivers ?? (item as any)["not-for-drivers"]) ?? [],
						content: contentParts.join("\n\n"),
					});
				}
			}
		} catch {
			// Skip malformed architecture files.
		}
	}

	return entries;
}
