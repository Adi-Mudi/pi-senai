import * as fs from "node:fs";
import * as path from "node:path";
import { discoverArchitectureLibrary } from "../architect/index.js";
import { detectPiExtension } from "../architect/pi-extension-detector.js";
import { loadDrivers, createEmptyDrivers } from "../architect/drivers.js";
import { loadArchitectInputsConfig } from "../architect/inputs-config.js";
import type { DiagnosticItem, DiagnosticSection } from "./_types.js";

function readAgentFrontmatter(filePath: string): Record<string, string> | null {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const match = content.match(/^---\n([\s\S]*?)\n---/);
		if (!match) return null;
		const fm: Record<string, string> = {};
		for (const line of match[1].split("\n")) {
			const idx = line.indexOf(":");
			if (idx <= 0) continue;
			fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
		}
		return fm;
	} catch {
		return null;
	}
}

export function checkPiExtensionConformance(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	let drivers = null;
	try {
		drivers = loadDrivers(cwd);
	} catch {
		drivers = createEmptyDrivers();
	}
	let inputsConfig = null;
	try {
		inputsConfig = loadArchitectInputsConfig(cwd);
	} catch {
		inputsConfig = null;
	}
	const detection = detectPiExtension(cwd, drivers, inputsConfig);

	if (!detection.isPiExtension) {
		items.push({
			status: "info",
			message: "Project is not detected as a Pi extension — skipping Pi conformance checks.",
		});
		return { title: "Pi Extension Conformance", items };
	}

	items.push({
		status: "ok",
		message: `Detected as Pi extension (confidence ${detection.confidence.toFixed(2)}, ${detection.matchedPatterns.length} patterns).`,
	});

	const pkgPath = path.join(cwd, "package.json");
	let isDistributable = false;
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
			const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : [];
			isDistributable = keywords.includes("pi-package") || keywords.includes("pi-extension");
			const peer = pkg.peerDependencies as Record<string, string> | undefined;
			const hasPiPeer = peer !== undefined && Object.keys(peer).some((k) =>
				k.startsWith("@mariozechner/pi-") || k.startsWith("@earendil-works/pi-") || k === "@sinclair/typebox" || k === "typebox",
			);
			const importsPi = hasImportsFromPiPackages(cwd);
			if (importsPi && peer === undefined) {
				items.push({
					status: "error",
					message: "package.json imports from Pi packages but does not declare peerDependencies.",
					details: [
						"Extensions must list @mariozechner/pi-coding-agent, @mariozechner/pi-ai, and @sinclair/typebox in peerDependencies with '*' range.",
					],
				});
			} else if (!hasPiPeer && peer !== undefined) {
				items.push({
					status: "warning",
					message: "peerDependencies present but no Pi package declared.",
				});
			} else {
				items.push({
					status: "ok",
					message: "package.json peerDependencies include Pi packages.",
				});
			}
			if (isDistributable) {
				items.push({
					status: "ok",
					message: "package.json declares pi-package keyword (discoverable in Pi gallery).",
				});
			}
		} catch {
			items.push({
				status: "warning",
				message: "Could not parse package.json for Pi conformance.",
			});
		}
	}

	const agentsDir = path.join(cwd, ".pi", "agents");
	if (fs.existsSync(agentsDir)) {
		const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
		let missing = 0;
		for (const file of files) {
			const fm = readAgentFrontmatter(path.join(agentsDir, file));
			if (!fm || !fm.name || !fm.description) missing++;
		}
		if (missing > 0) {
			items.push({
				status: "error",
				message: `${missing} of ${files.length} agent files in .pi/agents/ are missing required frontmatter (name + description).`,
			});
		} else if (files.length > 0) {
			items.push({
				status: "ok",
				message: `All ${files.length} agent files have required frontmatter.`,
			});
		}
	}

	const skillsDir = path.join(cwd, ".pi", "skills");
	if (fs.existsSync(skillsDir)) {
		const skillFiles = collectSkillFiles(skillsDir);
		let missing = 0;
		for (const skillFile of skillFiles) {
			const fm = readAgentFrontmatter(skillFile);
			if (!fm || !fm.name || !fm.description) missing++;
		}
		if (missing > 0) {
			items.push({
				status: "error",
				message: `${missing} of ${skillFiles.length} skill files are missing required frontmatter.`,
			});
		} else if (skillFiles.length > 0) {
			items.push({
				status: "ok",
				message: `All ${skillFiles.length} skill files have required frontmatter.`,
			});
		}
	}

	const library = discoverArchitectureLibrary(cwd);
	const hasPiArchitecture = library.some((e) => e.id === "pi-architecture");
	if (!hasPiArchitecture) {
		items.push({
			status: "warning",
			message: ".pi/architecture-library/ is missing the pi-architecture entry.",
			details: [
				"Add .pi/architecture-library/pi-architecture.md so the factory can select Pi's official architecture for extension projects.",
			],
		});
	} else {
		items.push({
			status: "ok",
			message: "pi-architecture entry present in .pi/architecture-library/.",
		});
	}

	return { title: "Pi Extension Conformance", items };
}

function hasImportsFromPiPackages(cwd: string): boolean {
	const srcDirs = [path.join(cwd, "src"), path.join(cwd, "extensions"), path.join(cwd, "pi-extension", "src")];
	for (const dir of srcDirs) {
		if (!fs.existsSync(dir)) continue;
		try {
			const files = listTsFiles(dir);
			for (const file of files) {
				const content = fs.readFileSync(file, "utf8");
				if (
					content.includes("@mariozechner/pi-") ||
					content.includes("@earendil-works/pi-") ||
					content.includes("@sinclair/typebox") ||
					content.includes('from "typebox"') ||
					content.includes("from 'typebox'")
				) {
					return true;
				}
			}
		} catch {
			// Skip read errors.
		}
	}
	return false;
}

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === "dist") continue;
				out.push(...listTsFiles(full));
			} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
				out.push(full);
			}
		}
	} catch {
		// Skip unreadable dirs.
	}
	return out;
}

function collectSkillFiles(rootDir: string): string[] {
	const out: string[] = [];
	try {
		for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
			const full = path.join(rootDir, entry.name);
			if (entry.isDirectory()) {
				const skillMd = path.join(full, "SKILL.md");
				if (fs.existsSync(skillMd)) out.push(skillMd);
				out.push(...collectSkillFiles(full));
			} else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "SKILL.md") {
				out.push(full);
			}
		}
	} catch {
		// Skip unreadable.
	}
	return out;
}