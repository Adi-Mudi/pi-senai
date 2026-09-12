/**
 * Web-researcher loader (Phase 7)
 *
 * Loads the canonical web-researcher agent body shipped with the extension.
 * Used by tests to verify the agent definition is present and well-formed.
 * The actual agent file at .pi/agents/web-research.md is generated from
 * this body by /senai-generate-sub-agents (or copied manually by the user).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getPackageAssetDir } from "../io/package-dir.js";

/** Filename of the canonical agent body shipped with the extension. */
export const WEB_RESEARCHER_BODY_FILENAME = "web-researcher-body.md";

/** Absolute path to the canonical body. tsc copies .ts files to dist/
 *  but does NOT copy the .md sibling, so we resolve via process.cwd()
 *  to the source tree (pi-extension/src/agents/...). */
export function getWebResearcherBodyPath(): string {
	// body lives at pi-extension/src/agents/<name>.md inside the package
	return path.join(
		getPackageAssetDir(),
		"pi-extension",
		"src",
		"agents",
		WEB_RESEARCHER_BODY_FILENAME,
	);
}

export interface WebResearcherFrontmatter {
	name: string;
	description: string;
	tools: string[];
}

/** Parse the YAML-style frontmatter at the top of the body file. Tolerant
 *  parser — only handles the simple `key: value` shape used by Pi agent
 *  files; returns null if the file is missing or malformed. */
export function parseWebResearcherFrontmatter(): WebResearcherFrontmatter | null {
	const bodyPath = getWebResearcherBodyPath();
	let raw: string;
	try {
		raw = fs.readFileSync(bodyPath, "utf8");
	} catch {
		return null;
	}
	if (!raw.startsWith("---")) return null;
	const end = raw.indexOf("\n---", 3);
	if (end === -1) return null;
	const frontmatterBlock = raw.slice(3, end);

	const nameMatch = frontmatterBlock.match(/^name:\s*(.+)$/m);
	const descMatch = frontmatterBlock.match(/^description:\s*(.+)$/m);
	const toolsMatch = frontmatterBlock.match(/^tools:\s*\[(.+)\]$/m);
	if (!nameMatch || !descMatch || !toolsMatch) return null;

	const tools = toolsMatch[1]
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	return {
		name: nameMatch[1].trim(),
		description: descMatch[1].trim(),
		tools,
	};
}
