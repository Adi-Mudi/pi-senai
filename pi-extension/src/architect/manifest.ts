// Generated-manifest tracking for drift detection.
// Records the sha256 hash of every generated file at generation time.
// The drift check compares against these hashes, never against timestamps.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { atomicWriteJson } from "../io/atomic-write.js";
import { getArchitectStateDir } from "../core/paths.js";

export const GENERATED_MANIFEST_FILE = "generated-manifest.json";

export interface GeneratedManifest {
	version: 1;
	generatedAt: string;
	files: Record<string, string>;
}

export function writeGeneratedManifest(cwd: string, files: string[]): GeneratedManifest {
	const manifest: GeneratedManifest = {
		version: 1,
		generatedAt: new Date().toISOString(),
		files: {},
	};
	for (const filePath of files) {
		const hash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
		manifest.files[path.relative(cwd, filePath)] = hash;
	}
	const manifestPath = path.join(getArchitectStateDir(cwd), GENERATED_MANIFEST_FILE);
	atomicWriteJson(manifestPath, manifest);
	return manifest;
}

export function loadGeneratedManifest(cwd: string): GeneratedManifest | null {
	const manifestPath = path.join(getArchitectStateDir(cwd), GENERATED_MANIFEST_FILE);
	try {
		const raw = fs.readFileSync(manifestPath, "utf8");
		const parsed = JSON.parse(raw) as GeneratedManifest;
		if (parsed.version !== 1 || typeof parsed.files !== "object" || parsed.files === null) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

// Merges new files into an existing manifest without wiping other entries.
// Used when a second generator (e.g. the sub-agent generator) adds files to
// drift tracking after the architecture factory wrote its own entries.
export function addToGeneratedManifest(cwd: string, files: string[]): GeneratedManifest {
	const existing = loadGeneratedManifest(cwd);
	const manifest: GeneratedManifest = existing ?? { version: 1, generatedAt: "", files: {} };
	for (const filePath of files) {
		if (!fs.existsSync(filePath)) continue;
		const hash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
		manifest.files[path.relative(cwd, filePath)] = hash;
	}
	manifest.generatedAt = new Date().toISOString();
	const manifestPath = path.join(getArchitectStateDir(cwd), GENERATED_MANIFEST_FILE);
	atomicWriteJson(manifestPath, manifest);
	return manifest;
}
