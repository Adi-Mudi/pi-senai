import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadAgentConfig, resolveAgentName } from "../agents/config.js";
import {
	loadAgentsFilesConfig,
	saveAgentsFilesConfig,
	type AgentFilesDocuments,
	type AgentsFilesConfig,
} from "../agents/agents-files-config.js";
import { roleDocumentNeed, suggestTruthDocuments } from "../agents/document-suggestions.js";
import { loadFilesConfig } from "../agents/files-config.js";
import { buildDocumentCandidates } from "./configure-files.js";
import {
	PICKER_ROLES,
	ROLE_GUIDANCE,
	ROLE_LABELS,
	SENAI_ROLES,
	type SenaiRole,
} from "../agents/suggestions.js";
import { runListEditor, type ListEditorCustomAction, type ListEditorItem } from "../ui/list-editor.js";
import { runRolePicker, type RolePickerItem } from "../ui/role-picker.js";
import { runSimplePicker, type SimplePickerItem } from "../ui/simple-picker.js";
import { browsePath, normalizePath, SUGGESTION_PAGE_SIZE } from "./_shared.js";

export function registerAgentsFilesCommands(pi: ExtensionAPI) {
	pi.registerCommand("senai-agents-files", {
		description: "Show configured document assignments per role",
		handler: async (_args, ctx) => {
			const config = loadAgentsFilesConfig(ctx.cwd);
			if (!config || Object.keys(config.documents).length === 0) {
				ctx.ui.notify(
					"No agent document assignments configured. Run /senai-configure-agents-files first.",
					"info",
				);
				return;
			}
			const lines = ["Pi Senai Agent Document Assignments", ""];
			for (const role of SENAI_ROLES) {
				const docs = config.documents[role];
				if (!docs) continue;
				const parts: string[] = [];
				if (docs.primary) parts.push(`truth=${docs.primary}`);
				if (docs.reads?.length) parts.push(`reads=[${docs.reads.join(", ")}]`);
				if (parts.length > 0) {
					lines.push(`  ${ROLE_LABELS[role]} (${role}): ${parts.join(" ")}`);
				}
			}
			if (lines.length === 2) {
				lines.push("  No assignments found.");
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("senai-configure-agents-files", {
		description: "Configure truth and comparison documents for each role",
		handler: async (_args, ctx) => {
			const existing = loadAgentsFilesConfig(ctx.cwd);
			const config: AgentsFilesConfig = existing ?? { version: 2, documents: {} };
			const agentConfig = loadAgentConfig(ctx.cwd);
			const filesConfig = loadFilesConfig(ctx.cwd);
			const candidates = buildDocumentCandidates(ctx.cwd, filesConfig);

			// Only picker-visible document roles are shown (PICKER_ROLES).
			// Sequence roles (discussion, planner, code-review, security-gate) and
			// artifact-driven roles are hidden; JSON stays valid for all roles.
			const truthSuggestions = new Map(
				suggestTruthDocuments(ctx.cwd).map((s) => [s.role, s.path]),
			);
			const pickerItems: RolePickerItem[] = PICKER_ROLES.map((role) => {
				const agent = resolveAgentName(agentConfig, role);
				const docs = config.documents[role];
				let summary: string;
				let assigned = false;
				if (docs?.primary) {
					summary = `truth=${docs.primary}${docs.reads?.length ? ` reads=${docs.reads.length}` : ""}`;
					assigned = true;
				} else if (docs?.reads?.length) {
					summary = `reads=${docs.reads.length}`;
					assigned = true;
				} else {
					const suggested = truthSuggestions.get(role);
					summary = suggested ? `not set, suggested: ${suggested}` : "not set";
				}
				return {
					id: role,
					label: ROLE_LABELS[role],
					agent,
					summary,
					assigned,
					guidance: ROLE_GUIDANCE[role],
					needs: roleDocumentNeed(role),
				};
			});

			let editing = true;
			while (editing) {
				const action = await runRolePicker(ctx, {
					title: "Configure agent documents",
					subtitle: " Sequence roles (discussion, planner, code review, security gate) follow stage artifacts automatically — assign them by editing agents_files.json directly.",
					items: pickerItems,
				});

				if (action.kind === "back" || action.kind === "finish") {
					editing = false;
				} else {
					await editRoleDocuments(
						ctx,
						action.role as SenaiRole,
						config,
						candidates,
						filesConfig?.excludedPaths ?? [],
					);
					// Refresh the summary/assigned state for the selected role.
					const docs = config.documents[action.role as SenaiRole];
					const item = pickerItems.find((i) => i.id === action.role);
					if (item) {
						if (docs?.primary) {
							item.summary = `truth=${docs.primary}${docs.reads?.length ? ` reads=${docs.reads.length}` : ""}`;
							item.assigned = true;
						} else if (docs?.reads?.length) {
							item.summary = `reads=${docs.reads.length}`;
							item.assigned = true;
						} else {
							item.summary = "not set";
							item.assigned = false;
						}
					}
				}
			}

			saveAgentsFilesConfig(ctx.cwd, config);
			ctx.ui.notify("Agent document assignments saved to .pi/senai/agents_files.json", "info");
		},
	});
}

async function editRoleDocuments(
	ctx: ExtensionContext,
	role: SenaiRole,
	config: AgentsFilesConfig,
	candidates: string[],
	excludedPaths: string[],
): Promise<void> {
	const docs = config.documents[role] ?? {};
	let primary = docs.primary;
	let reads = [...(docs.reads ?? [])];
	let filterQuery = "";

	let editing = true;
	while (editing) {
		const customActions: ListEditorCustomAction[] = [
			{ id: "set-truth", label: "Set truth document" },
			{ id: "add-custom-read", label: "Add custom path" },
		];
		if (primary) {
			customActions.unshift({ id: "clear-truth", label: "Clear truth" });
		}

		const action = await runListEditor(ctx, {
			title: `${ROLE_LABELS[role]} (${role})${primary ? ` — truth: ${primary}` : ""}`,
			items: buildRoleDocumentItems(primary, reads, candidates),
			filterQuery,
			enableFilter: true,
			customActions,
			pageSize: SUGGESTION_PAGE_SIZE,
		});

		switch (action.kind) {
			case "back":
				editing = false;
				break;
			case "done":
				reads = action.paths;
				updateRoleDocs(config, role, primary, reads);
				editing = false;
				break;
			case "filter":
				reads = action.paths;
				filterQuery = action.query;
				updateRoleDocs(config, role, primary, reads);
				break;
			case "custom": {
				reads = action.paths;
				updateRoleDocs(config, role, primary, reads);
				if (action.id === "set-truth") {
					const result = await pickTruthDocument(ctx, primary, reads, candidates);
					if (result.action === "set") primary = result.value;
					else if (result.action === "clear") primary = undefined;
					updateRoleDocs(config, role, primary, reads);
				} else if (action.id === "clear-truth") {
					primary = undefined;
					updateRoleDocs(config, role, primary, reads);
				} else if (action.id === "add-custom-read") {
					const picked = await browsePath(ctx, ctx.cwd, "both", excludedPaths);
					if (picked) {
						const normalized = normalizePath(picked);
						if (!reads.includes(normalized) && normalized !== primary) {
							reads.push(normalized);
							updateRoleDocs(config, role, primary, reads);
						}
					}
				}
				break;
			}
		}
	}
}

function buildRoleDocumentItems(
	primary: string | undefined,
	reads: string[],
	candidates: string[],
): ListEditorItem[] {
	const items: ListEditorItem[] = [];
	const used = new Set<string>();
	if (primary) used.add(primary);
	for (const r of reads) used.add(r);

	for (const r of reads) {
		items.push({
			id: `read:${r}`,
			kind: "selected",
			label: `✅ Read: ${r}`,
			value: r,
		});
	}
	for (const c of candidates) {
		if (used.has(c)) continue;
		items.push({
			id: `suggest:${c}`,
			kind: "suggestion",
			label: `⬜ Suggest: ${c}`,
			value: c,
		});
	}
	return items;
}

function updateRoleDocs(
	config: AgentsFilesConfig,
	role: SenaiRole,
	primary: string | undefined,
	reads: string[],
): void {
	if (!primary && reads.length === 0) {
		delete config.documents[role];
		return;
	}
	const docs: AgentFilesDocuments = {};
	if (primary) docs.primary = primary;
	if (reads.length > 0) docs.reads = [...reads];
	config.documents[role] = docs;
}

type TruthPickResult =
	| { action: "set"; value: string }
	| { action: "clear" }
	| { action: "cancel" };

async function pickTruthDocument(
	ctx: ExtensionContext,
	current: string | undefined,
	reads: string[],
	candidates: string[],
): Promise<TruthPickResult> {
	const pickerItems: SimplePickerItem[] = [];
	if (current) pickerItems.push({ id: "__clear__", label: "(clear truth document)" });
	for (const c of candidates) {
		if (c === current || reads.includes(c)) continue;
		pickerItems.push({ id: c, label: c });
	}
	const choice = await runSimplePicker(ctx, { title: "Select truth document", items: pickerItems });
	if (choice === undefined) return { action: "cancel" };
	if (choice === "__clear__") return { action: "clear" };
	return { action: "set", value: choice };
}
