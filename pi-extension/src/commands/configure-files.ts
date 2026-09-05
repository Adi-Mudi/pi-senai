import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { discoverProjectFiles } from "../agents/files-discovery.js";
import { loadFilesConfig, saveFilesConfig, type FilesConfig } from "../agents/files-config.js";
import { runListEditor, type ListEditorItem } from "../ui/list-editor.js";
import { runSimplePicker } from "../ui/simple-picker.js";
import {
	SUGGESTION_PAGE_SIZE,
	browsePath,
	normalizePath,
	type PickerMode,
	isPathConflict,
} from "./_shared.js";

type CategoryKey = "codePaths" | "inputDocuments" | "testPaths";

export function registerFilesCommands(pi: ExtensionAPI) {
	pi.registerCommand("senai-files", {
		description: "Show the configured project file list",
		handler: async (_args, ctx) => {
			const config = loadFilesConfig(ctx.cwd);
			if (!config || getAllSelectedPaths(config).length === 0) {
				ctx.ui.notify("No project files configured. Run /senai-configure-files first.", "info");
				return;
			}
			const lines = ["Pi Senai Project Files", ""];
			if (config.codePaths.length > 0) {
				lines.push("Code paths:");
				for (const f of config.codePaths) lines.push(`  ${f}`);
				lines.push("");
			}
			if (config.inputDocuments.length > 0) {
				lines.push("Input documents:");
				for (const f of config.inputDocuments) lines.push(`  ${f}`);
				lines.push("");
			}
			if (config.testPaths.length > 0) {
				lines.push("Test paths:");
				for (const f of config.testPaths) lines.push(`  ${f}`);
				lines.push("");
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("senai-configure-files", {
		description: "Configure important project files and folders",
		handler: async (_args, ctx) => {
			const existing = loadFilesConfig(ctx.cwd);
			const config: FilesConfig = existing ?? {
				version: 2,
				codePaths: [],
				inputDocuments: [],
				testPaths: [],
				excludedPaths: [
					".git/", "node_modules/", "__pycache__/", ".venv/", "venv/",
					"dist/", "build/", "target/", ".pi/", ".idea/", ".vscode/",
				],
			};

			const discovered = discoverProjectFiles(ctx.cwd, config.excludedPaths);

			let editing = true;
			while (editing) {
				const choice = await runSimplePicker(ctx, {
					title: `Project files — ${config.codePaths.length} code, ${config.inputDocuments.length} docs, ${config.testPaths.length} tests`,
					items: [
						{ id: "code", label: "Edit code paths" },
						{ id: "docs", label: "Edit input documents" },
						{ id: "tests", label: "Edit test paths" },
						{ id: "excluded", label: "Edit excluded paths" },
						{ id: "finish", label: "Finish" },
					],
				});

				if (choice === "code") {
					await editCategory(ctx, config, "codePaths", discovered.codeFolders.map((f) => f.path));
				} else if (choice === "docs") {
					await editCategory(ctx, config, "inputDocuments", [
						...discovered.documentFolders.map((f) => f.path),
						...discovered.documentFiles,
					]);
				} else if (choice === "tests") {
					await editCategory(ctx, config, "testPaths", [
						...discovered.testFolders.map((f) => f.path),
						...discovered.testFiles,
					]);
				} else if (choice === "excluded") {
					await editExcludedPaths(ctx, config);
				} else {
					editing = false;
				}
			}

			saveFilesConfig(ctx.cwd, config);
			ctx.ui.notify("Project files saved to .pi/senai/files.json", "info");
		},
	});
}

export function buildDocumentCandidates(cwd: string, filesConfig: FilesConfig | null): string[] {
	const excludedPaths = filesConfig?.excludedPaths ?? [
		".git/", "node_modules/", "__pycache__/", ".venv/", "venv/",
		"dist/", "build/", "target/", ".pi/", ".idea/", ".vscode/",
	];
	const discovered = discoverProjectFiles(cwd, excludedPaths);
	const candidates = new Set<string>();
	for (const p of filesConfig?.inputDocuments ?? []) candidates.add(p);
	for (const folder of discovered.documentFolders) candidates.add(folder.path);
	for (const file of discovered.documentFiles) candidates.add(file);
	return Array.from(candidates).sort((a, b) => a.localeCompare(b));
}

export function buildCategoryItems(
	suggestions: string[],
	current: string[],
	otherPaths: string[],
): ListEditorItem[] {
	const items: ListEditorItem[] = [];
	for (const path of suggestions) {
		if (isPathConflict(path, current, otherPaths)) continue;
		if (current.includes(path)) continue;
		items.push({
			id: `suggest:${path}`,
			kind: "suggestion",
			label: `⬜ Suggest: ${path}`,
			value: path,
		});
	}
	for (const path of current) {
		items.push({
			id: `selected:${path}`,
			kind: "selected",
			label: `✅ Remove: ${path}`,
			value: path,
		});
	}
	return items;
}

async function editCategory(
	ctx: ExtensionContext,
	config: FilesConfig,
	key: CategoryKey,
	suggestions: string[],
): Promise<void> {
	let filterQuery = "";
	let editing = true;

	while (editing) {
		const otherPaths = getAllSelectedPaths(config).filter((p) => !config[key].includes(p));
		const action = await runListEditor(ctx, {
			title: `${key} (${config[key].length} selected)`,
			items: buildCategoryItems(suggestions, config[key], otherPaths),
			filterQuery,
			enableFilter: true,
			customActions: [{ id: "add-custom", label: "Add custom path" }],
			pageSize: SUGGESTION_PAGE_SIZE,
		});

		switch (action.kind) {
			case "back":
				editing = false;
				break;
			case "done":
				config[key] = action.paths as FilesConfig[CategoryKey];
				editing = false;
				break;
			case "filter":
				config[key] = action.paths as FilesConfig[CategoryKey];
				filterQuery = action.query;
				break;
			case "custom": {
				config[key] = action.paths as FilesConfig[CategoryKey];
				const mode: PickerMode = key === "codePaths" ? "folder" : "both";
				const picked = await browsePath(ctx, ctx.cwd, mode, config.excludedPaths);
				if (picked && !isPathConflict(picked, config[key], otherPaths)) {
					config[key].push(normalizePath(picked));
				}
				break;
			}
		}
	}
}

export function matchesFilter(path: string, query: string): boolean {
	if (!query) return true;
	return path.toLowerCase().includes(query.toLowerCase());
}

async function editExcludedPaths(ctx: ExtensionContext, config: FilesConfig): Promise<void> {
	let editing = true;
	while (editing) {
		const action = await runListEditor(ctx, {
			title: `Excluded paths (${config.excludedPaths.length})`,
			items: config.excludedPaths.map((p) => ({
				id: `selected:${p}`,
				kind: "selected" as const,
				label: `✅ Remove: ${p}`,
				value: p,
			})),
			customActions: [{ id: "add-excluded", label: "Add excluded path" }],
		});

		switch (action.kind) {
			case "back":
				editing = false;
				break;
			case "done":
				config.excludedPaths = action.paths;
				editing = false;
				break;
			case "custom": {
				config.excludedPaths = action.paths;
				const picked = await browsePath(ctx, ctx.cwd, "both", config.excludedPaths);
				if (picked) config.excludedPaths.push(normalizePath(picked));
				break;
			}
		}
	}
}

function getAllSelectedPaths(config: FilesConfig): string[] {
	return [...config.codePaths, ...config.inputDocuments, ...config.testPaths];
}
