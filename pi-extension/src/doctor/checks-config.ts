import * as fs from "node:fs";
import * as path from "node:path";

import { type AgentConfig } from "../core/agents-config/config.js";
import { type FilesConfig } from "../core/agents-config/files-config.js";
import { type AgentsFilesConfig } from "../core/agents-config/agents-files-config.js";
import {
	DOCUMENT_ROLES,
	ROLE_LABELS,
	SENAI_ROLES,
	type SenaiRole,
} from "../core/agents-config/suggestions.js";
import { suggestTruthDocuments } from "../core/agents-config/document-suggestions.js";

import {
	documentSignalWords,
	isPathConflict,
	mandateTextForRole,
	significantWords,
	wordsOverlap,
} from "./_helpers.js";
import {
	MANDATE_CHECK_ROLES,
	type DiagnosticItem,
	type DiagnosticSection,
	type ResolvedAgent,
} from "./_types.js";

/** Configuration-file health: validates presence, parse, and version for
 *  the three .pi/senai/ JSON files (agents.json, files.json,
 *  agents_files.json). Emits an error per missing or malformed file, an
 *  OK line per valid one, and a warning per stale schema version. */
export function checkConfigFiles(
	cwd: string,
	agentConfig: AgentConfig | null,
	filesConfig: FilesConfig | null,
	agentsFilesConfig: AgentsFilesConfig | null,
	filesConfigError: string | null,
	agentConfigError: string | null,
	agentsFilesConfigError: string | null,
): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	const agentPath = path.join(cwd, ".pi", "senai", "agents.json");
	if (agentConfigError) {
		items.push({
			status: "error",
			message: agentConfigError,
			details: ["Run /senai-configure-agents to recreate the file."],
		});
	} else if (agentConfig) {
		items.push({ status: "ok", message: `agents.json found and valid at ${agentPath}` });
		if (agentConfig.version !== 1) {
			items.push({
				status: "warning",
				message: `agents.json version is ${agentConfig.version}; expected 1`,
			});
		}
	} else {
		items.push({
			status: "error",
			message: `agents.json missing or invalid at ${agentPath}`,
			details: ["Run /senai-generate-sub-agents (or /senai-generate-architect) to create it, or /senai-configure-agents to configure agents manually."],
		});
	}

	const filesPath = path.join(cwd, ".pi", "senai", "files.json");
	if (filesConfigError) {
		items.push({
			status: "error",
			message: filesConfigError,
			details: ["Run /senai-configure-files to recreate the file."],
		});
	} else if (filesConfig) {
		items.push({ status: "ok", message: `files.json found and valid at ${filesPath}` });
	} else {
		items.push({
			status: "error",
			message: `files.json missing or invalid at ${filesPath}`,
			details: ["Run /senai-configure-files to create it."],
		});
	}

	const agentsFilesPath = path.join(cwd, ".pi", "senai", "agents_files.json");
	if (agentsFilesConfigError) {
		items.push({
			status: "error",
			message: agentsFilesConfigError,
			details: ["Run /senai-configure-agents-files to recreate the file."],
		});
	} else if (agentsFilesConfig) {
		items.push({
			status: "ok",
			message: `agents_files.json found and valid at ${agentsFilesPath}`,
		});
		if (agentsFilesConfig.version !== 2) {
			items.push({
				status: "warning",
				message: `agents_files.json version is ${agentsFilesConfig.version}; expected 2`,
			});
		}
	} else {
		items.push({
			status: "error",
			message: `agents_files.json missing or invalid at ${agentsFilesPath}`,
			details: ["Run /senai-configure-agents-files to create it."],
		});
	}

	return { title: "Configuration files", items };
}

/** Project file scope: walks the three path lists declared in files.json
 *  (codePaths, inputDocuments, testPaths), reports any path that does not
 *  exist on disk, and flags any pair of paths that overlap (folder/file
 *  conflict, equality). */
export function checkFileScope(cwd: string, config: FilesConfig): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	const categories: Array<{
		key: keyof FilesConfig;
		label: string;
	}> = [
		{ key: "codePaths", label: "Code paths" },
		{ key: "inputDocuments", label: "Input documents" },
		{ key: "testPaths", label: "Test paths" },
	];

	for (const { key, label } of categories) {
		const paths = config[key] as string[];
		if (paths.length === 0) {
			items.push({
				status: "warning",
				message: `${label}: none configured`,
			});
			continue;
		}

		const missing: string[] = [];
		for (const p of paths) {
			const fullPath = path.resolve(cwd, p);
			if (!fs.existsSync(fullPath)) {
				missing.push(p);
			}
		}

		if (missing.length > 0) {
			items.push({
				status: "error",
				message: `${label}: ${paths.length} configured, ${missing.length} not found`,
				details: missing,
			});
		} else {
			items.push({
				status: "ok",
				message: `${label}: ${paths.length} configured, all exist`,
			});
		}
	}

	const allSelected = [...config.codePaths, ...config.inputDocuments, ...config.testPaths];
	const conflicts: string[] = [];
	for (let i = 0; i < allSelected.length; i++) {
		for (let j = i + 1; j < allSelected.length; j++) {
			const a = allSelected[i];
			const b = allSelected[j];
			if (isPathConflict(a, b)) {
				conflicts.push(`${a} overlaps ${b}`);
			}
		}
	}

	if (conflicts.length > 0) {
		items.push({
			status: "error",
			message: "Path conflicts detected",
			details: conflicts,
		});
	}

	return { title: "Project file scope", items };
}

/** Agent document assignments: validates the truth and comparison
 *  documents declared per role in agents_files.json. Checks existence,
 *  flags artifact-driven roles that have been assigned documents by
 *  mistake, verifies that truth documents match the suggestion rules
 *  (mandate overlap for roles the suggestion rules do not cover), and
 *  warns on recommended roles that have no truth document at all. */
export function checkAgentsFiles(
	cwd: string,
	config: AgentsFilesConfig,
	filesConfig: FilesConfig | null,
	resolved: Record<SenaiRole, ResolvedAgent>,
): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	const allConfiguredDocs = new Set<string>();
	if (filesConfig) {
		for (const p of filesConfig.inputDocuments) allConfiguredDocs.add(path.resolve(cwd, p));
	}

	for (const role of SENAI_ROLES) {
		const docs = config.documents[role];
		if (!docs) continue;
		const label = ROLE_LABELS[role];

		if (docs.primary) {
			const fullPath = path.resolve(cwd, docs.primary);
			if (fs.existsSync(fullPath)) {
				const inScope = allConfiguredDocs.has(fullPath);
				items.push({
					status: inScope ? "ok" : "warning",
					message: `${label} (${role}) truth document: ${docs.primary}`,
					details: inScope
						? ["File exists and is in the inputDocuments scope."]
						: ["File exists but is NOT in the inputDocuments scope. Add it to files.json if you want agents to discover it."],
				});
			} else {
				items.push({
					status: "error",
					message: `${label} (${role}) truth document MISSING: ${docs.primary}`,
					details: ["The configured truth document does not exist in the project."],
				});
			}
		}

		if (docs.reads) {
			for (const readPath of docs.reads) {
				const fullPath = path.resolve(cwd, readPath);
				if (fs.existsSync(fullPath)) {
					items.push({
						status: "ok",
						message: `${label} (${role}) comparison document: ${readPath}`,
					});
				} else {
					items.push({
						status: "error",
						message: `${label} (${role}) comparison document MISSING: ${readPath}`,
					});
				}
			}
		}
	}

	// Artifact-driven roles consume stage outputs, not project documents. A
	// hand-edited assignment on one of these roles is a configuration error
	// (the /senai-configure-agents-files picker hides these roles by design).
	for (const role of SENAI_ROLES) {
		if ((DOCUMENT_ROLES as readonly string[]).includes(role)) continue;
		const docs = config.documents[role];
		if (!docs) continue;
		const hasAssignment =
			docs.primary !== undefined || (docs.reads?.length ?? 0) > 0;
		if (!hasAssignment) continue;
		const label = ROLE_LABELS[role];
		items.push({
			status: "error",
			message: `${label} (${role}) has document assignments, but this role reads stage artifacts, not project documents.`,
			details: [
				...(docs.primary ? [`Truth document assigned: ${docs.primary}`] : []),
				...(docs.reads?.length
					? [`Comparison documents assigned: ${docs.reads.join(", ")}`]
					: []),
				"Fix: remove this role from agents_files.json (run /senai-configure-agents-files; artifact-driven roles are hidden there by design).",
			],
		});
	}

	// A truth document that contradicts the suggestion rules is a
	// misassignment: the file exists, so the existence check passes, but the
	// role should follow a different document type. Strict error per user
	// decision; roles without a confident suggestion are not judged.
	const allSuggestions = suggestTruthDocuments(cwd);
	for (const s of allSuggestions) {
		const assigned = config.documents[s.role]?.primary;
		if (!assigned || assigned === s.path) continue;
		if (!fs.existsSync(path.resolve(cwd, assigned))) continue; // the MISSING error above already covers this
		const label = ROLE_LABELS[s.role];
		items.push({
			status: "error",
			message: `${label} (${s.role}) truth document mismatch: assigned ${assigned}, but the expected ${s.reason} looks like ${s.path}.`,
			details: [
				"The assigned file exists, but it does not match the document type this role should follow.",
				`Fix: run /senai-configure-agents-files and set the truth document to ${s.path}. If the assignment is intentional, re-classify the document type via /senai-configure-architect-inputs.`,
			],
		});
	}

	// Layer 2 — mandate check for roles the suggestion rules do not cover.
	// Compare what the agent does (mandate/description) with what the document
	// is (type, filename, first heading). No overlap = clear contradiction =
	// error. Not enough signal = reported as unverifiable, never silent.
	const unverifiable: string[] = [];
	for (const role of MANDATE_CHECK_ROLES) {
		const assigned = config.documents[role]?.primary;
		if (!assigned) continue;
		const fullPath = path.resolve(cwd, assigned);
		if (!fs.existsSync(fullPath)) continue; // the MISSING error above already covers this
		const docWords = documentSignalWords(cwd, assigned, fullPath);
		const mandateWords = significantWords(mandateTextForRole(resolved[role], role));
		if (docWords.size === 0 || mandateWords.size === 0) {
			unverifiable.push(`${ROLE_LABELS[role]} (${role}) → ${assigned}`);
			continue;
		}
		if (!wordsOverlap(docWords, mandateWords)) {
			const label = ROLE_LABELS[role];
			items.push({
				status: "error",
				message: `${label} (${role}) truth document does not match the agent's mandate: ${assigned}.`,
				details: [
					`Agent mandate: ${mandateTextForRole(resolved[role], role)}`,
					"The document shows no overlap with what this agent does.",
					"Fix: run /senai-configure-agents-files and assign a document that fits the role, or remove the assignment.",
				],
			});
		}
	}
	if (unverifiable.length > 0) {
		items.push({
			status: "warning",
			message: `Doctor cannot verify ${unverifiable.length} document assignment(s) (not enough signal to judge).`,
			details: [
				...unverifiable,
				"These assignments pass, but they are YOUR responsibility — doctor has no rule for them.",
				"Tip: classify the document type via /senai-configure-architect-inputs and give the file a meaningful name and top heading to make it verifiable.",
			],
		});
	}

	// Recommended roles without a truth document get a warning with concrete
	// suggestions; the user approves by running /senai-configure-agents-files.
	// Assignments stay optional. One item per role (not one aggregated item) so
	// every missing assignment is visible in the summary, with the exact
	// default path to assign.
	const suggestions = allSuggestions.filter(
		(s) => !config.documents[s.role]?.primary,
	);
	for (const s of suggestions) {
		items.push({
			status: "warning",
			message: `${ROLE_LABELS[s.role]} (${s.role}) has no truth document. Assign: ${s.path}`,
			details: [
				`Why: ${s.reason}.`,
				"Without a truth document this role reads whatever it finds — the main source of doc bloat and contradictions.",
				`Fix: run /senai-configure-agents-files and set the truth document to ${s.path}.`,
			],
		});
	}

	if (items.length === 0) {
		items.push({ status: "info", message: "No per-role document assignments configured." });
	}

	return { title: "Agent document assignments", items };
}