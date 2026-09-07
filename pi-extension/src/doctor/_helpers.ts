import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter, getAgentDir } from "@mariozechner/pi-coding-agent";

import { loadArchitectInputsConfig } from "../architect/inputs-config.js";
import { GENERATED_ROLES, getBundledTechnologiesDir } from "../agents/generator.js";
import { ROLE_LABELS } from "../core/agents-config/suggestions.js";

import type { ResolvedAgent } from "./_types.js";
import { KNOWN_TOOL_NAMES, MANDATE_STOPWORDS } from "./_types.js";
import type { SenaiRole } from "../core/agents-config/suggestions.js";

/** True if the file is missing or zero bytes. */
export function artifactMissing(filePath: string): boolean {
	try {
		return fs.statSync(filePath).size === 0;
	} catch {
		return true;
	}
}

/** Folder/file conflict: equality, or one ends with "/" and contains the other. */
export function isPathConflict(a: string, b: string): boolean {
	if (a === b) return true;
	if (a.endsWith("/") && b.startsWith(a)) return true;
	if (b.endsWith("/") && a.startsWith(b)) return true;
	return false;
}

/** Compares dotted versions; returns negative when a < b. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

/** Lowercase word set: drops stopwords and words shorter than 4 chars. */
export function significantWords(text: string): Set<string> {
	const words = new Set<string>();
	for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
		if (raw.length < 4) continue;
		if (MANDATE_STOPWORDS.has(raw)) continue;
		words.add(raw);
	}
	return words;
}

/** Exact match, or one word prefixing the other (code/codebase, test/testing). */
export function wordsOverlap(a: Set<string>, b: Set<string>): boolean {
	for (const wa of a) {
		for (const wb of b) {
			if (wa === wb) return true;
			const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
			if (shorter.length >= 4 && longer.startsWith(shorter)) return true;
		}
	}
	return false;
}

/** What the agent does: frontmatter description + generator mandate + label. */
export function mandateTextForRole(agent: ResolvedAgent, role: SenaiRole): string {
	const parts: string[] = [];
	if (agent.frontmatter?.description) parts.push(agent.frontmatter.description);
	const generated = GENERATED_ROLES.find((def) => def.role === role);
	if (generated) parts.push(generated.mandate);
	parts.push(ROLE_LABELS[role]);
	return parts.join(". ");
}

/** What the document is: classified type + filename + first markdown heading. */
export function documentSignalWords(cwd: string, relPath: string, fullPath: string): Set<string> {
	const words = new Set<string>();
	try {
		const inputs = loadArchitectInputsConfig(cwd);
		const entry = inputs?.documents.find((d) => d.path === relPath);
		if (entry?.type) for (const w of significantWords(entry.type)) words.add(w);
	} catch {
		// Invalid architect inputs are reported in the architecture setup section.
	}
	const base = path.basename(relPath).replace(/\.[^.]+$/, "");
	for (const w of significantWords(base)) words.add(w);
	try {
		const content = fs.readFileSync(fullPath, "utf8");
		const heading = content.match(/^#\s+(.+)$/m);
		if (heading) for (const w of significantWords(heading[1])) words.add(w);
	} catch {
		// Unreadable file: fall back to filename/type signals only.
	}
	return words;
}

/** Resolves a skill reference in this order: project .pi/skills/, user skills dir, bundled skills. */
export function resolveSkillFile(cwd: string, skillName: string): string | null {
	const candidates = [
		path.join(cwd, ".pi", "skills", skillName, "SKILL.md"),
		path.join(getAgentDir(), "skills", skillName, "SKILL.md"),
		path.resolve(getBundledTechnologiesDir(), "..", "..", "skills", `${skillName}.md`),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

/** Returns human-readable problems with the SKILL.md (empty frontmatter, empty body, etc.). */
export function validateSkillFile(filePath: string): string[] {
	const problems: string[] = [];
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
		if (!String(frontmatter.name ?? "").trim()) problems.push("SKILL.md frontmatter is missing a name");
		if (!String(frontmatter.description ?? "").trim()) problems.push("SKILL.md frontmatter is missing a description");
		const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
		if (!body) problems.push("SKILL.md body is empty");
	} catch {
		problems.push("SKILL.md could not be parsed");
	}
	return problems;
}

/** True when the tool name is known (built-in list) or a non-empty ext: extension. */
export function isKnownToolName(tool: string): boolean {
	if (tool.startsWith("ext:")) return tool.length > 4;
	return KNOWN_TOOL_NAMES.has(tool.toLowerCase());
}
