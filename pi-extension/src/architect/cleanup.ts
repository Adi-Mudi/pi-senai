// Stale-artifact cleanup + legacy-state migration for the architect factory.
// Also hosts the architecture-bound role constants used across the factory and doctor.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { getArchitectStateDir } from "../core/paths.js";
import { loadGeneratedManifest } from "./manifest.js";
import type { SenaiRole } from "../core/agents-config/suggestions.js";
import type { ArchitectProfile } from "./profile.js";

export const ARCHITECT_ROLES = [
	"planner",
	"implementer",
	"reviewer-correctness",
	"reviewer-security",
	"reviewer-tests",
] as const;

export const ARCHITECT_STAGES = ["plan", "implement", "document", "deliver"] as const;

/** Maps each architecture-bound Senai role to its generated agent name suffix.
 *  Single source of truth — doctor.ts derives its checks from this. */
export const ARCHITECTURE_AGENT_MAPPING: Array<{ role: SenaiRole; suffix: string }> = [
	{ role: "scout-1", suffix: "planner" },
	{ role: "planner", suffix: "planner" },
	{ role: "implementer", suffix: "implementer" },
	{ role: "reviewer-correctness", suffix: "reviewer-correctness" },
	{ role: "reviewer-security", suffix: "reviewer-security" },
	{ role: "reviewer-tests", suffix: "reviewer-tests" },
	{ role: "code-review", suffix: "reviewer-correctness" },
];

// Maps each generated architecture role to the stage skill it should reference.
// Reviewers act in the plan stage: their review artifacts live under plan/reviews/.
export const ARCHITECT_ROLE_STAGE: Record<string, string> = {
	planner: "plan",
	implementer: "implement",
	"reviewer-correctness": "plan",
	"reviewer-security": "plan",
	"reviewer-tests": "plan",
};

export function migrateLegacyArchitectState(cwd: string): string[] {
	const legacyDir = path.join(cwd, ".IDE_Plans", "architect");
	const targetDir = getArchitectStateDir(cwd);
	const moved: string[] = [];
	if (!fs.existsSync(legacyDir)) return moved;
	if (fs.existsSync(targetDir)) return moved;
	fs.mkdirSync(targetDir, { recursive: true });
	for (const entry of fs.readdirSync(legacyDir)) {
		if (entry === "architect-map") continue; // skip old temporary map dir
		const src = path.join(legacyDir, entry);
		const dest = path.join(targetDir, entry);
		fs.renameSync(src, dest);
		moved.push(path.relative(cwd, dest));
	}
	return moved;
}

// Removes generated agents and skills from PREVIOUS architecture runs of this
// project (same project slug, different architecture id). A file is deleted
// only when BOTH guards pass: the name pattern matches (slug prefix +
// architect role/stage suffix) AND the generation manifest proves we wrote it
// and the user never edited it (hash still matches). Anything else is kept
// and reported, so user-created or user-edited files stay safe.
export function removeStaleArchitectureArtifacts(
	cwd: string,
	profile: ArchitectProfile,
): { removed: string[]; kept: string[] } {
	const removed: string[] = [];
	const kept: string[] = [];
	const prefix = `${profile.projectSlug}-`;
	const manifest = loadGeneratedManifest(cwd);

	// A path is deletable only when the manifest proves we generated it and its
	// content was never modified since.
	const isProvenUntouched = (absPath: string): boolean => {
		const rel = path.relative(cwd, absPath);
		const expectedHash = manifest?.files[rel];
		if (expectedHash === undefined) return false;
		try {
			const actual = createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
			return actual === expectedHash;
		} catch {
			return false;
		}
	};

	const expectedAgents = new Set(
		ARCHITECT_ROLES.map((role) => `${profile.projectSlug}-${profile.selectedArchitecture}-${role}`),
	);
	const agentsDir = path.join(cwd, ".pi", "agents");
	if (fs.existsSync(agentsDir)) {
		for (const entry of fs.readdirSync(agentsDir)) {
			if (!entry.endsWith(".md")) continue;
			const name = entry.slice(0, -3);
			if (!name.startsWith(prefix)) continue;
			if (!ARCHITECT_ROLES.some((role) => name.endsWith(`-${role}`))) continue;
			if (expectedAgents.has(name)) continue;
			const filePath = path.join(agentsDir, entry);
			if (!isProvenUntouched(filePath)) {
				kept.push(path.relative(cwd, filePath));
				continue;
			}
			try {
				fs.unlinkSync(filePath);
				removed.push(path.relative(cwd, filePath));
			} catch {
				// Ignore deletion failures.
			}
		}
	}

	const expectedSkills = new Set(
		ARCHITECT_STAGES.map((stage) => `${profile.projectSlug}-${profile.selectedArchitecture}-${stage}`),
	);
	const skillsDir = path.join(cwd, ".pi", "skills");
	if (fs.existsSync(skillsDir)) {
		for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const name = entry.name;
			if (!name.startsWith(prefix)) continue;
			if (!ARCHITECT_STAGES.some((stage) => name.endsWith(`-${stage}`))) continue;
			if (expectedSkills.has(name)) continue;
			const dirPath = path.join(skillsDir, name);
			// A generated skill directory holds exactly one tracked file: SKILL.md.
			if (!isProvenUntouched(path.join(dirPath, "SKILL.md"))) {
				kept.push(path.relative(cwd, dirPath));
				continue;
			}
			try {
				fs.rmSync(dirPath, { recursive: true, force: true });
				removed.push(path.relative(cwd, dirPath));
			} catch {
				// Ignore deletion failures.
			}
		}
	}

	return { removed, kept };
}
