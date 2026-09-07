import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "../agents/discovery.js";
import { buildSuggestionMap, DEFAULT_AGENTS, ROLE_LABELS, SENAI_ROLES, type SenaiRole } from "../core/agents-config/suggestions.js";
import { loadAgentConfig, saveAgentConfig, validateMappedAgents } from "../core/agents-config/config.js";
import { runRolePicker, type RolePickerItem } from "../ui/role-picker.js";
import { runSimplePicker, type SimplePickerItem } from "../ui/simple-picker.js";

export function registerAgentCommands(pi: ExtensionAPI) {
	pi.registerCommand("senai-agents", {
		description: "Show current agent mapping and validation status",
		handler: async (_args, ctx) => {
			const config = loadAgentConfig(ctx.cwd);
			if (!config) {
				ctx.ui.notify(
					"No agent configuration found. Run /senai-generate-sub-agents or /senai-configure-agents to create it.",
					"warning",
				);
				return;
			}

			const errors = validateMappedAgents(ctx.cwd, config);
			const lines = ["Pi Senai Agent Registry", ""];
			for (const role of SENAI_ROLES) {
				const agentName = config.agents[role] ?? DEFAULT_AGENTS[role];
				lines.push(`  ${ROLE_LABELS[role]} (${role}) → ${agentName}`);
			}

			if (errors.length > 0) {
				lines.push("", "Errors:", ...errors.map((e) => `  ❌ ${e}`));
				ctx.ui.notify(lines.join("\n"), "error");
			} else {
				lines.push("", "All mapped agents are available.");
				ctx.ui.notify(lines.join("\n"), "info");
			}
		},
	});

	pi.registerCommand("senai-configure-agents", {
		description: "Interactively configure subagents for this project",
		handler: async (_args, ctx) => {
			const agents = discoverAgents(ctx.cwd);
			const suggestions = buildSuggestionMap(agents);
			const existing = loadAgentConfig(ctx.cwd);
			const mapping: Partial<Record<SenaiRole, string>> = {};

			const effectiveAgent = (role: SenaiRole): string =>
				mapping[role] ?? existing?.agents?.[role] ?? suggestions[role] ?? DEFAULT_AGENTS[role];

			let lastSelectedId: string | undefined;
			let editing = true;
			while (editing) {
				const items: RolePickerItem[] = SENAI_ROLES.map((role) => {
					const effective = effectiveAgent(role);
					const suggested = suggestions[role];
					const isCustom = Boolean(mapping[role] ?? existing?.agents?.[role]);
					return {
						id: role,
						label: ROLE_LABELS[role],
						agent: effective,
						summary:
							suggested && suggested !== effective
								? `suggested: ${suggested}`
								: isCustom
									? "custom"
									: "default",
						assigned: isCustom,
					};
				});

				const action = await runRolePicker(ctx, {
					title: "Configure agents",
					subtitle: " Enter edits one role • Finish saves all • Back cancels. Unedited roles keep their current or suggested agent.",
					items,
					initialSelectedId: lastSelectedId,
					showBack: true,
				});

				if (action.kind === "back") {
					ctx.ui.notify("Agent configuration cancelled — no changes saved.", "info");
					return;
				}
				if (action.kind !== "role") {
					editing = false;
					break;
				}

				const role = action.role as SenaiRole;
				lastSelectedId = role;
				const suggested = suggestions[role] ?? DEFAULT_AGENTS[role];
				const current = effectiveAgent(role);

				const pickerItems: SimplePickerItem[] = [];
				pickerItems.push({ id: "keep", label: `Keep current: ${current}` });
				if (suggested !== current) {
					pickerItems.push({ id: "accept", label: `Accept suggestion: ${suggested}` });
				}
				pickerItems.push({ id: "choose", label: "Choose different" });
				pickerItems.push({ id: "default", label: `Use default: ${DEFAULT_AGENTS[role]}` });

				const choice = await runSimplePicker(ctx, {
					title: `Configure agent for ${ROLE_LABELS[role]} (${role})`,
					items: pickerItems,
				});

				if (choice === "keep") {
					mapping[role] = current;
				} else if (choice === "accept") {
					mapping[role] = suggested;
				} else if (choice === "choose") {
					const agentItems: SimplePickerItem[] = agents.map((a) => ({
						id: a.name,
						label: `${a.name} (${a.source})`,
					}));
					const selected = await runSimplePicker(ctx, {
						title: `Select agent for ${ROLE_LABELS[role]} (${role})`,
						items: agentItems,
					});
					mapping[role] = selected ?? DEFAULT_AGENTS[role];
				} else if (choice === "default") {
					mapping[role] = DEFAULT_AGENTS[role];
				}
				// undefined (esc): no change, back to the list.
			}

			const finalMapping: Partial<Record<SenaiRole, string>> = {};
			for (const role of SENAI_ROLES) {
				finalMapping[role] = effectiveAgent(role);
			}

			const config = { version: 1, agents: finalMapping };
			saveAgentConfig(ctx.cwd, config);
			ctx.ui.notify("Agent configuration saved to .pi/senai/agents.json", "info");
		},
	});
}
