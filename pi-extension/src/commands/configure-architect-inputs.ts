import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { discoverProjectFiles } from "../agents/files-discovery.js";
import { loadFilesConfig } from "../agents/files-config.js";
import {
	createDefaultArchitectInputsConfig,
	loadArchitectInputsConfig,
	saveArchitectInputsConfig,
	type ArchitectDocumentType,
	type ArchitectInputsConfig,
} from "../architect-inputs-config.js";
import { runListEditor, type ListEditorItem } from "../ui/list-editor.js";
import { runRolePicker, type RolePickerItem } from "../ui/role-picker.js";
import { browsePath, normalizePath, SUGGESTION_PAGE_SIZE } from "./_shared.js";

export function registerArchitectInputsCommands(pi: ExtensionAPI) {
	pi.registerCommand("senai-configure-architect-inputs", {
		description: "Select documents the architect agent reads",
		handler: async (_args, ctx) => {
			const existing = loadArchitectInputsConfig(ctx.cwd);
			const config: ArchitectInputsConfig = existing ?? createDefaultArchitectInputsConfig();
			const filesConfig = loadFilesConfig(ctx.cwd);
			const excludedPaths = filesConfig?.excludedPaths ?? [
				".git/",
				"node_modules/",
				"__pycache__/",
				".venv/",
				"venv/",
				"dist/",
				"build/",
				"target/",
				".pi/",
				".idea/",
				".vscode/",
			];

			const discovered = discoverProjectFiles(ctx.cwd, excludedPaths);

			const candidates = [
				...discovered.documentFiles,
				...discovered.documentFolders.map((f) => f.path),
				...discovered.testFiles,
				...discovered.testFolders.map((f) => f.path),
				"README.md",
			];

			// Build type-aware suggestions.
			const typePatterns: Record<ArchitectDocumentType, RegExp> = {
				prd: /prd|product.requirement|requirements/i,
				mrd: /mrd|market.requirement/i,
				brd: /brd|business.requirement/i,
				rtm: /rtm|traceability|trace/i,
				nfr: /nfr|non.functional|non_functional/i,
				"test-plan": /test.plan|test.strategy|testing/i,
				adr: /adr|architecture.decision/i,
				readme: /readme/i,
				code: /src\/|app\/|lib\//i,
				feasibility: /feasib/i,
			};

			const documentsByType: Partial<Record<ArchitectDocumentType, string[]>> = {};
			for (const docType of Object.keys(typePatterns) as ArchitectDocumentType[]) {
				documentsByType[docType] = candidates.filter((p) => typePatterns[docType].test(p));
			}

			const typeLabels: Record<ArchitectDocumentType, string> = {
				prd: "PRD",
				mrd: "MRD",
				brd: "BRD",
				rtm: "RTM",
				nfr: "NFR",
				"test-plan": "Test plan",
				adr: "ADR",
				readme: "README",
				code: "Code",
				feasibility: "Feasibility",
			};

			const typeIds = Object.keys(typePatterns) as ArchitectDocumentType[];

			let lastSelectedId: string | undefined;

			while (true) {
				const pickerItems: RolePickerItem[] = typeIds.map((docType) => {
					const count = config.documents.filter((d) => d.type === docType).length;
					return {
						id: docType,
						label: typeLabels[docType],
						agent: "",
						summary: count > 0 ? `${count} selected` : "not set",
						assigned: count > 0,
					};
				});
				pickerItems.push({
					id: "additional-constraints",
					label: "Additional constraints",
					agent: "",
					summary: config.additionalConstraints.length > 0
						? `${config.additionalConstraints.length} entries`
						: "not set",
					assigned: config.additionalConstraints.length > 0,
				});

				const action = await runRolePicker(ctx, {
					title: "Configure architect inputs",
					subtitle: " Select a document type to configure, or Finish when done.",
					items: pickerItems,
					initialSelectedId: lastSelectedId,
				});

				if (action.kind === "back") {
					ctx.ui.notify("Configuration cancelled.", "warning");
					return;
				}

				if (action.kind === "finish") {
					break;
				}

				lastSelectedId = action.role;

				if (action.role === "additional-constraints") {
					const constraints = await ctx.ui.editor(
						"Enter additional constraints (one per line)",
						config.additionalConstraints.join("\n"),
					);
					if (constraints !== undefined) {
						config.additionalConstraints = constraints
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line.length > 0);
					}
					continue;
				}

				const docType = action.role as ArchitectDocumentType;
				if (!typeIds.includes(docType)) continue;

				const suggestions = documentsByType[docType] ?? [];
				const current = config.documents.filter((d) => d.type === docType).map((d) => d.path);
				const done = await editArchitectDocumentType(ctx, docType, suggestions, current, excludedPaths);
				if (done === null) continue;
				lastSelectedId = docType;

				config.documents = config.documents.filter((d) => d.type !== docType);
				for (const p of done) {
					config.documents.push({ type: docType, path: p });
				}
			}

			saveArchitectInputsConfig(ctx.cwd, config);
			ctx.ui.notify(
				`Architect inputs saved. ${config.documents.length} documents configured.`,
				"info",
			);
		},
	});
}

async function editArchitectDocumentType(
	ctx: ExtensionContext,
	docType: ArchitectDocumentType,
	suggestions: string[],
	current: string[],
	excludedPaths: string[],
): Promise<string[] | null> {
	let selected = [...current];
	let filterQuery = "";

	while (true) {
		const action = await runListEditor(ctx, {
			title: `${docType.toUpperCase()} inputs (${selected.length} selected)`,
			items: buildArchitectDocumentItems(suggestions, selected),
			filterQuery,
			enableFilter: true,
			customActions: [{ id: "add-custom", label: "Add custom path" }],
			pageSize: SUGGESTION_PAGE_SIZE,
		});

		switch (action.kind) {
			case "back":
				return current;
			case "done":
				return action.paths;
			case "filter":
				selected = action.paths;
				filterQuery = action.query;
				break;
			case "custom": {
				selected = action.paths;
				const picked = await browsePath(ctx, ctx.cwd, "both", excludedPaths);
				if (picked && !selected.includes(picked)) {
					selected.push(normalizePath(picked));
				}
				break;
			}
		}
	}
}

function buildArchitectDocumentItems(suggestions: string[], current: string[]): ListEditorItem[] {
	const items: ListEditorItem[] = [];
	for (const p of suggestions) {
		if (current.includes(p)) continue;
		items.push({
			id: `suggest:${p}`,
			kind: "suggestion",
			label: `⬜ Suggest: ${p}`,
			value: p,
		});
	}
	for (const p of current) {
		items.push({
			id: `selected:${p}`,
			kind: "selected",
			label: `✅ Remove: ${p}`,
			value: p,
		});
	}
	return items;
}
