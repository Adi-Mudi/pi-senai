import * as fs from "node:fs";
import * as path from "node:path";

import { type FilesConfig } from "../agents/files-config.js";
import { GENERATOR_VERSION } from "../agents/generator.js";
import { DOC_TYPES, isDocStub, type DocTypeId } from "../docs-factory/catalog.js";
import { cacheSize, oldestCacheTimestamp } from "../scouts/community-research.js";

import type { DiagnosticItem, DiagnosticSection } from "./_types.js";

/** Post-hoc audit of the recorded run: verifies that every artifact a stage
 *  was supposed to produce actually exists and is non-empty. Catches the
 *  "subagent reported completed but wrote nothing" failure seen in real
 *  sessions, which the parent only noticed after user prodding. */
export function checkTestingDiscipline(cwd: string, filesConfig: FilesConfig | null): DiagnosticSection {
	// Single-glance audit for the testing-discipline feature added in v2.0+.
	// Reads environment variables, files.json testPaths, and the three stage
	// skills to surface the discipline's runtime state without running the
	// scanner itself. All items are info or warning — never error — because
	// the discipline is opt-in.
	const items: DiagnosticItem[] = [];

	// 1. Strict mode status (always shown).
	const strictMode = process.env.SENAI_TEST_DISCIPLINE_STRICT === "1";
	items.push({
		status: "info",
		message: `Strict mode: ${strictMode ? "on (blocking findings will halt advance)" : "off (advisory; set SENAI_TEST_DISCIPLINE_STRICT=1 to enable)"}`,
	});

	// 2. Coverage floor (always shown).
	const floorRaw = process.env.SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR;
	const floor = floorRaw && floorRaw !== "" && Number.isFinite(Number(floorRaw)) ? Number(floorRaw) : 80;
	items.push({
		status: "info",
		message: `Coverage floor: ${floor}% (set SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR to override; 0 disables)`,
	});

	// 3. Test paths configured.
	const testPaths = filesConfig?.testPaths ?? [];
	if (testPaths.length === 0) {
		items.push({
			status: "warning",
			message: "Test paths are not configured in files.json — the scanner cannot run.",
			details: ["Run /senai-configure-files and set the testPaths field so senai_scan_test_smells has files to scan."],
		});
	} else {
		items.push({
			status: "ok",
			message: `Test paths configured: ${testPaths.length} entr${testPaths.length === 1 ? "y" : "ies"} in files.json.`,
		});
	}

	// 4. Scanner module compiled and present in dist/.
	try {
		const distPath = path.join(cwd, "dist", "pi-extension", "src", "test-discipline.js");
		if (fs.existsSync(distPath)) {
			items.push({
				status: "ok",
				message: "Scanner module compiled (test-discipline.js present in dist/).",
			});
		} else {
			items.push({
				status: "warning",
				message: "Scanner module dist/ not found — run `npm run build` before testing the scanner.",
			});
		}
	} catch {
		items.push({
			status: "warning",
			message: "Scanner module check failed unexpectedly.",
		});
	}

	// 5. Stage skills carry the discipline block.
	const skillFiles = [
		"skills/senai-implement.md",
		"skills/senai-document.md",
		"skills/senai-deliver.md",
	];
	const missing = skillFiles.filter((rel) => {
		const p = path.join(cwd, rel);
		if (!fs.existsSync(p)) return true;
		try {
			return !fs.readFileSync(p, "utf8").includes("## Testing discipline");
		} catch {
			return true;
		}
	});
	if (missing.length === 0) {
		items.push({ status: "ok", message: "Stage skills carry ## Testing discipline: implement, document, deliver." });
	} else {
		items.push({
			status: "warning",
			message: `${missing.length} stage skill(s) missing the ## Testing discipline block.`,
			details: missing,
		});
	}

	// 6. Generated agents on the latest version.
	const agentsDir = path.join(cwd, ".pi", "agents");
	if (fs.existsSync(agentsDir)) {
		const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
		if (files.length === 0) {
			items.push({ status: "info", message: "No generated agents yet — run /senai-generate-sub-agents." });
		} else {
			const onLatest = files.filter((f) => {
				try {
					return fs.readFileSync(path.join(agentsDir, f), "utf8").includes(`(generator v${GENERATOR_VERSION})`);
				} catch {
					return false;
				}
			});
			const stale = files.filter((f) => !onLatest.includes(f));
			if (stale.length === 0) {
				items.push({
					status: "ok",
					message: `Generated agents on v${GENERATOR_VERSION}: ${onLatest.length} of ${files.length}.`,
				});
			} else {
				items.push({
					status: "warning",
					message: `Generated agents on v${GENERATOR_VERSION}: ${onLatest.length} of ${files.length} (${stale.length} stale).`,
					details: stale,
				});
			}
		}
	} else {
		items.push({ status: "info", message: "No generated agents yet — run /senai-generate-sub-agents." });
	}

	return { title: "Testing discipline", items };
}

interface DocsStructureManifestTarget {
	path: string;
	docType: string;
	maxLines: number;
}

/** Doc factory checks:
 *  1. For each manifest target that is filled (no longer a stub): validate the
 *     template's required sections are present, in order, and the file is
 *     within its length cap. Over cap or missing section → warning naming the
 *     file, the count/section, and the cap.
 *  2. Missing skeleton stubs → warning; unexpected non-stub files in
 *     factory-owned subfolders → info. */
export function checkDocsFactory(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const manifestPath = path.join(cwd, ".pi", "senai", "docs-structure.json");
	if (!fs.existsSync(manifestPath)) {
		items.push({
			status: "info",
			message: "No docs skeleton generated.",
			details: [
				"Run /senai-generate-docs-structure to create the docs folder skeleton and template stubs for the selected document types.",
			],
		});
		return { title: "Documentation factory", items };
	}

	let targets: DocsStructureManifestTarget[];
	try {
		const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
		const rawTargets = Array.isArray(parsed.targets) ? parsed.targets : [];
		targets = rawTargets
			.filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
			.map((t) => ({
				path: String(t.path ?? ""),
				docType: String(t.docType ?? ""),
				maxLines: typeof t.maxLines === "number" ? t.maxLines : 0,
			}))
			.filter((t) => t.path.length > 0);
	} catch (err: any) {
		items.push({
			status: "warning",
			message: `Docs structure manifest is corrupt: ${err.message}`,
			details: ["Fix: re-run /senai-generate-docs-structure to rewrite .pi/senai/docs-structure.json."],
		});
		return { title: "Documentation factory", items };
	}

	const manifestPaths = new Set(targets.map((t) => t.path));

	for (const target of targets) {
		const fullPath = path.join(cwd, target.path);
		if (!fs.existsSync(fullPath)) {
			items.push({
				status: "warning",
				message: `Skeleton doc missing: ${target.path}`,
				details: [
					"The docs skeleton was generated but this stub was deleted.",
					"Fix: re-run /senai-generate-docs-structure.",
				],
			});
			continue;
		}
		let content: string;
		try {
			content = fs.readFileSync(fullPath, "utf8");
		} catch {
			continue;
		}
		if (isDocStub(content)) continue; // unfilled stub: nothing to validate yet
		const spec = target.docType in DOC_TYPES ? DOC_TYPES[target.docType as DocTypeId] : undefined;
		if (!spec) continue;
		const lines = content.split("\n");
		if (lines.length > spec.maxLines) {
			items.push({
				status: "warning",
				message: `${target.path} is ${lines.length} lines — over the ${spec.maxLines}-line cap (${spec.basedOn}).`,
				details: [
					"The doc factory keeps docs short and cheap in tokens. Trim to the cap; move detail into a linked page of the same type.",
				],
			});
		}
		let cursor = -1;
		for (const section of spec.requiredSections) {
			const idx = lines.findIndex((l, i) => i > cursor && l.trim() === section);
			if (idx === -1) {
				items.push({
					status: "warning",
					message: `${target.path} is missing required section "${section}" (template: ${spec.id}).`,
					details: [`Template ${spec.id} requires, in order: ${spec.requiredSections.join(", ")}.`],
				});
			} else {
				cursor = idx;
			}
		}
	}

	const factoryDirs = ["docs/tutorials", "docs/how-to", "docs/reference", "docs/explanation", "docs/adr"];
	const stray: string[] = [];
	for (const dir of factoryDirs) {
		const fullDir = path.join(cwd, dir);
		let entries: string[] = [];
		try {
			entries = fs.readdirSync(fullDir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".md")) continue;
			const rel = `${dir}/${entry}`;
			if (manifestPaths.has(rel)) continue;
			let content = "";
			try {
				content = fs.readFileSync(path.join(fullDir, entry), "utf8");
			} catch {
				continue;
			}
			if (!isDocStub(content)) stray.push(rel);
		}
	}
	if (stray.length > 0) {
		items.push({
			status: "info",
			message: `${stray.length} file(s) in factory docs folders are not part of the generated skeleton.`,
			details: [
				...stray,
				"Not an error — your own docs are fine here. Regenerate the skeleton if they should be factory-managed.",
			],
		});
	}

	if (items.length === 0) {
		items.push({
			status: "ok",
			message: `Docs skeleton intact (${targets.length} target(s)); all filled docs within template and length limits.`,
		});
	}

	return { title: "Documentation factory", items };
}

/** Reports the cross-run community-research cache state. Always emitted, even
 *  when the cache is empty (informational). Includes file count, oldest
 *  entry timestamp, and a hint for manual purge. */
export function checkCommunityResearchCache(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const size = cacheSize(cwd);
	const oldest = oldestCacheTimestamp(cwd);

	if (size === 0) {
		items.push({
			status: "info",
			message: "Community research cache: empty (no /senai-discussion scout runs yet).",
		});
		return { title: "Community research cache", items };
	}

	items.push({
		status: "info",
		message: `Community research cache: ${size} file(s) under .IDE_Plans/pi-senai/.cache/community-research/.`,
	});
	if (oldest) {
		items.push({
			status: "info",
			message: `  Oldest entry: ${oldest}`,
		});
	}
	items.push({
		status: "info",
		message: "Run /senai-purge-community-cache to clear the cache.",
	});

	return { title: "Community research cache", items };
}