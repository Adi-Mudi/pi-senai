// ArchitectProfile I/O — read, write, and resolve the profile file path.
// Profile is the user's stated project context (name, slug, selected architecture, drivers, extra constraints).

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../io/atomic-write.js";
import { getArchitectStateDir } from "../core/paths.js";
import { slugify } from "./helpers.js";
import type { ArchitecturalDrivers } from "./drivers.js";

export const ARCHITECT_PROFILE_FILE = "architect-profile.json";

export interface ArchitectProfile {
	projectName: string;
	projectSlug: string;
	selectedArchitecture: string;
	drivers: ArchitecturalDrivers;
	additionalConstraints: string[];
}

export function getArchitectProfilePath(cwd: string): string {
	return path.join(getArchitectStateDir(cwd), ARCHITECT_PROFILE_FILE);
}

export function loadArchitectProfile(cwd: string): ArchitectProfile | null {
	const profilePath = getArchitectProfilePath(cwd);
	try {
		const raw = fs.readFileSync(profilePath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;

		const projectName = typeof parsed.projectName === "string" ? parsed.projectName : "";
		let projectSlug = typeof parsed.projectSlug === "string" ? parsed.projectSlug : "";
		if (!projectSlug && typeof parsed.project === "string") {
			projectSlug = parsed.project;
		}
		if (!projectSlug && projectName) {
			projectSlug = slugify(projectName);
		}

		const selectedArchitecture =
			typeof parsed.selectedArchitecture === "string" ? parsed.selectedArchitecture : "";

		if (!projectName || !projectSlug || !selectedArchitecture) {
			throw new Error("profile is missing projectName, projectSlug, or selectedArchitecture");
		}

		return {
			...parsed,
			projectName,
			projectSlug,
			selectedArchitecture,
		} as ArchitectProfile;
	} catch (err: any) {
		if (err.code === "ENOENT") return null;
		throw new Error(`Invalid architect profile at ${profilePath}: ${err.message}`);
	}
}

export function saveArchitectProfile(cwd: string, profile: ArchitectProfile): void {
	atomicWriteJson(getArchitectProfilePath(cwd), profile);
}

// Re-export slugify from helpers to keep the import surface stable for callers
// that used to import it from the architect barrel.
export { slugify } from "./helpers.js";
