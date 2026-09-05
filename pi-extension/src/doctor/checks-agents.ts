import * as fs from "node:fs";
import * as path from "node:path";

import { resolveAgentName, type AgentConfig } from "../agents/config.js";
import {
	findNearestProjectAgentsDir,
	getUserAgentsDir,
	parseAgentFileFull,
	type AgentFrontmatter,
} from "../agents/discovery.js";
import {
	DEFAULT_AGENTS,
	ROLE_LABELS,
	SENAI_ROLES,
	type SenaiRole,
} from "../agents/suggestions.js";

import {
	BUILTIN_AGENT_NAMES,
	CONFLICTING_READONLY_PATTERNS,
	READONLY_ROLES,
	ROLE_REQUIRED_TOOLS,
	VALID_THINKING_LEVELS,
	type DiagnosticItem,
	type DiagnosticSection,
	type DiagnosticStatus,
	type ResolvedAgent,
} from "./_types.js";
import { isKnownToolName, resolveSkillFile, validateSkillFile } from "./_helpers.js";

export function resolveAllAgents(
	cwd: string,
	agentConfig: AgentConfig | null,
): Record<SenaiRole, ResolvedAgent> {
	const result = {} as Record<SenaiRole, ResolvedAgent>;

	const projectDir = findNearestProjectAgentsDir(cwd);
	const userDir = getUserAgentsDir();

	for (const role of SENAI_ROLES) {
		const name = resolveAgentName(agentConfig, role);

		const projectPath = projectDir ? path.join(projectDir, `${name}.md`) : null;
		const userPath = path.join(userDir, `${name}.md`);

		const foundProject = projectPath && fs.existsSync(projectPath);
		const foundUser = fs.existsSync(userPath);
		const isBuiltin = BUILTIN_AGENT_NAMES.includes(name);

		let source: ResolvedAgent["source"] = "not found";
		let filePath: string | null = null;
		let frontmatter: AgentFrontmatter | null = null;
		const shadowed: ResolvedAgent["shadowed"] = [];

		if (foundProject) {
			source = "project";
			filePath = projectPath;
			frontmatter = parseAgentFileFull(projectPath) ?? null;
			if (foundUser) shadowed.push({ source: "user", filePath: userPath });
			if (isBuiltin) shadowed.push({ source: "builtin" });
		} else if (foundUser) {
			source = "user";
			filePath = userPath;
			frontmatter = parseAgentFileFull(userPath) ?? null;
			if (isBuiltin) shadowed.push({ source: "builtin" });
		} else if (isBuiltin) {
			source = "builtin";
		}

		result[role] = { name, source, filePath, frontmatter, shadowed };
	}

	return result;
}

export function checkAgentMappings(resolved: Record<SenaiRole, ResolvedAgent>): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	for (const role of SENAI_ROLES) {
		const agent = resolved[role];
		const label = ROLE_LABELS[role];

		if (agent.source === "not found") {
			items.push({
				status: "error",
				message: `${label} (${role}) → ${agent.name}: NOT FOUND`,
				details: [
					"No matching agent file in project or user agents, and not a known built-in default.",
					`Create .pi/agents/${agent.name}.md or map this role to an existing agent.`,
				],
			});
			continue;
		}

		const location =
			agent.source === "builtin"
				? "built-in default"
				: `${agent.source} agent at ${agent.filePath}`;

		const details: string[] = [`Source: ${location}`];

		if (agent.shadowed.length > 0) {
			for (const shadow of agent.shadowed) {
				if (shadow.source === "builtin") {
					details.push("Note: a built-in agent with the same name is shadowed by this file.");
				} else {
					details.push(
						`Note: ${shadow.source} agent ${shadow.filePath ?? ""} is shadowed by the project file.`,
					);
				}
			}
		}

		if (!agent.frontmatter && agent.source !== "builtin") {
			items.push({
				status: "error",
				message: `${label} (${role}) → ${agent.name}: found but frontmatter is unreadable`,
				details: ["The .md file may be missing name/description or be malformed."],
			});
			continue;
		}

		items.push({
			status: "info",
			message: `${label} (${role}) → ${agent.name}: ${location}`,
			details,
		});
	}

	// Strict collision warning: roles remapped off their built-in default mean
	// the bare default name (e.g. "planner") silently loads the built-in
	// read-only agent. A spawn with the bare name can never write artifacts.
	const collisions: string[] = [];
	for (const role of SENAI_ROLES) {
		const agent = resolved[role];
		if (agent.source === "not found") continue;
		const bare = DEFAULT_AGENTS[role];
		if (agent.name !== bare) {
			collisions.push(`${role}: spawn with "${agent.name}" — the bare name "${bare}" loads the built-in read-only agent`);
		}
	}
	if (collisions.length > 0) {
		items.push({
			status: "warning",
			message: `${collisions.length} role(s) remap a built-in default name — spawns MUST use the exact mapped name`,
			details: [
				...collisions,
				"During an active run the spawn guard blocks bare names, but outside a run (or in other tools) the wrong agent still loads silently.",
			],
		});
	}

	return { title: "Agent mapping sources", items };
}

export function checkAgentCapabilities(resolved: Record<SenaiRole, ResolvedAgent>): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	for (const role of SENAI_ROLES) {
		const agent = resolved[role];
		const label = ROLE_LABELS[role];

		// Default mappings and built-ins are the documented pre-generation
		// fallback (Pi ships its planner/scout/reviewer agents read-only by
		// design; for those, the main session compensates writes). Custom-mapped
		// and generated agents must carry the tools their role needs — artifact-
		// writing roles include the write tool. Checks apply to custom agents only.
		const isDefaultMapping = agent.name === DEFAULT_AGENTS[role];
		if (agent.source === "not found" || agent.source === "builtin" || isDefaultMapping || !agent.frontmatter) continue;

		const requiredTools = ROLE_REQUIRED_TOOLS[role] ?? [];
		const tools = agent.frontmatter.tools;

		if (tools === undefined || tools === null) {
			items.push({
				status: "info",
				message: `${label} (${role}) → ${agent.name}: no explicit tools list`,
				details: [
					"The agent frontmatter does not declare tools.",
					"The subagent extension will use its own defaults; capability cannot be verified here.",
				],
			});
		} else if (tools.length === 0) {
			items.push({
				status: "warning",
				message: `${label} (${role}) → ${agent.name}: explicit tools list is empty`,
				details: ["This agent may not have any tools available."],
			});
		} else {
			const missingTools = requiredTools.filter((t) => !tools.includes(t));
			if (missingTools.length > 0) {
				items.push({
					status: "error",
					message: `${label} (${role}) → ${agent.name}: MISSING REQUIRED TOOLS`,
					details: [
						`Required: ${requiredTools.join(", ")}`,
						`Found: ${tools.join(", ")}`,
						`Missing: ${missingTools.join(", ")}`,
						`Add the missing tools to the agent frontmatter.`,
					],
				});
			}
		}

		if (READONLY_ROLES.includes(role) && tools && tools.includes("write")) {
			items.push({
				status: "warning",
				message: `${label} (${role}) → ${agent.name}: has write tool but role is read-only`,
				details: [
					"This role should only read and report. The write tool is not needed and may cause unwanted edits.",
				],
			});
		}

		const description = `${agent.frontmatter.name} ${agent.frontmatter.description}`;
		for (const { pattern, reason } of CONFLICTING_READONLY_PATTERNS) {
			if (pattern.test(description)) {
				items.push({
					status: "error",
					message: `${label} (${role}) → ${agent.name}: ROLE CONFLICT`,
					details: [
						reason,
						`This agent is mapped to ${label}, but its mandate conflicts with that role.`,
						`Map it to a different role or choose a more suitable agent.`,
					],
				});
				break;
			}
		}

		// scout-1 is excluded: it is architecture-factory-defined and may
		// intentionally map to the architecture planner agent.
		if (role !== "scout-1" && role.startsWith("scout-") && /planner|planning/i.test(description)) {
			items.push({
				status: "warning",
				message: `${label} (${role}) → ${agent.name}: agent looks like a planner`,
				details: [
					"A scout role is mapped to an agent whose name/description indicates planning.",
					"Scouts should search and report. Map a scout/search agent instead.",
				],
			});
		}

		if (agent.frontmatter.output) {
			items.push({
				status: "warning",
				message: `${label} (${role}) → ${agent.name}: has output="${agent.frontmatter.output}"`,
				details: [
					"The agent may write to its preferred output path instead of the Senai artifact path.",
					"Make sure the agent task explicitly overrides this with the Senai artifact path.",
				],
			});
		}
	}

	if (items.length === 0) {
		items.push({ status: "ok", message: "All mapped agents have suitable capabilities for their roles." });
	}

	return { title: "Agent-role capability fit", items };
}

export function checkAgentSkillReferences(
	cwd: string,
	resolved: Record<SenaiRole, ResolvedAgent>,
): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	let checked = 0;

	for (const role of SENAI_ROLES) {
		const agent = resolved[role];
		if (!agent.frontmatter || !agent.frontmatter.skills || agent.frontmatter.skills.length === 0) continue;

		for (const skillName of agent.frontmatter.skills) {
			checked++;
			const skillPath = resolveSkillFile(cwd, skillName);
			if (!skillPath) {
				items.push({
					status: "error",
					message: `${agent.name} (${role}) references missing skill "${skillName}"`,
					details: [
						`No SKILL.md found in .pi/skills/, the user skills dir, or the bundled skills.`,
						`Create the skill or remove it from the agent's skills: line.`,
					],
				});
				continue;
			}
			const problems = validateSkillFile(skillPath);
			if (problems.length > 0) {
				items.push({
					status: "warning",
					message: `${agent.name} (${role}) references invalid skill "${skillName}"`,
					details: problems.map((p) => `${skillPath}: ${p}`),
				});
			}
		}
	}

	if (items.length === 0) {
		items.push({
			status: checked === 0 ? "info" : "ok",
			message: checked === 0 ? "No agents reference skills." : `All ${checked} skill reference(s) are valid.`,
		});
	}

	return { title: "Agent skill references", items };
}

export function checkAgentFileIntegrity(
	cwd: string,
	resolved: Record<SenaiRole, ResolvedAgent>,
): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	for (const role of SENAI_ROLES) {
		const agent = resolved[role];
		if (!agent.filePath || !agent.frontmatter) continue; // built-ins and missing agents are covered elsewhere

		const problems: Array<{ status: DiagnosticStatus; text: string }> = [];
		const fileName = path.basename(agent.filePath, ".md");
		const content = fs.readFileSync(agent.filePath, "utf8");

		if (agent.frontmatter.name !== fileName) {
			problems.push({
				status: "error",
				text: `frontmatter name "${agent.frontmatter.name}" does not match the filename "${fileName}"`,
			});
		}

		const tools = agent.frontmatter.tools ?? [];
		const unknownTools = tools.filter((t) => !isKnownToolName(t));
		if (unknownTools.length > 0) {
			problems.push({ status: "error", text: `unknown tool name(s): ${unknownTools.join(", ")} (typo?)` });
		}

		const thinking = agent.frontmatter.thinking;
		if (thinking && !VALID_THINKING_LEVELS.has(thinking.toLowerCase())) {
			problems.push({ status: "warning", text: `unknown thinking level "${thinking}"` });
		}

		if (agent.frontmatter.model) {
			problems.push({
				status: "warning",
				text: `frontmatter pins model "${agent.frontmatter.model}" — subagent will not inherit pi's default model; remove the model field unless intentional`,
			});
		}

		const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
		if (!body) {
			problems.push({ status: "error", text: "agent body is empty — no instructions" });
		}

		if (problems.length === 0) continue;
		items.push({
			status: problems.some((p) => p.status === "error") ? "error" : "warning",
			message: `${agent.name} (${role}) at ${path.relative(cwd, agent.filePath)}`,
			details: problems.map((p) => p.text),
		});
	}

	if (items.length === 0) {
		items.push({ status: "ok", message: "All mapped agent files are internally valid." });
	}

	return { title: "Agent file integrity", items };
}