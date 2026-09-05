import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";
import {
	loadAgentConfig,
	resolveAgentName,
	saveAgentConfig,
} from "../agents/config.js";
import { DEFAULT_AGENTS, type SenaiRole } from "../agents/suggestions.js";
import {
	discoverTechnologyResources,
	GENERATED_ROLES,
	getProjectSlug,
	matchTechnologies,
	planAgentGeneration,
	previewRegeneration,
	writeGeneratedAgents,
} from "../agents/generator.js";
import { loadArchitectReport, slugify, type ArchitectReport } from "../architect.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";

export function registerAgentGeneratorCommand(pi: ExtensionAPI) {
	const command = {
		description: "Generate project-specific sub-agents for the non-architecture Senai roles",
		handler: async (_args: string, ctx: ExtensionContext) => {
			// agents.json is optional here: this command creates/updates it.
			// Roles without a mapping resolve to built-in defaults.
			const config = loadAgentConfig(ctx.cwd) ?? { version: 1, agents: {} };

			// Target roles still on built-in defaults (fresh generation). Custom
			// agents and custom mappings are never touched.
			const fresh = GENERATED_ROLES.filter(
				(def) => resolveAgentName(config, def.role as SenaiRole) === DEFAULT_AGENTS[def.role as SenaiRole],
			);

			// Roles mapped to their expected generated name are previously
			// generated team agents: regenerate candidates. A missing file means a
			// stale mapping — the file is recreated, never stranded.
			const slug = getProjectSlug(ctx.cwd);
			const freshRoles = new Set(fresh.map((def) => def.role));
			const regen = GENERATED_ROLES.filter(
				(def) =>
					!freshRoles.has(def.role) &&
					resolveAgentName(config, def.role as SenaiRole) === `${slug}-${def.role}`,
			);

			const targets = [...fresh, ...regen];

			if (targets.length === 0) {
				ctx.ui.notify(
					"All non-architecture roles already have custom agents. Nothing to generate.",
					"info",
				);
				return;
			}

			// Project context: reuse the architect report when it exists, otherwise
			// ask the basic questions (basic mode).
			let report: ArchitectReport | null = null;
			try {
				report = loadArchitectReport(ctx.cwd);
			} catch {
				report = null;
			}

			let stackHints: string[] = [];
			if (report) {
				stackHints = [...report.techStack, ...report.constraints];
			} else {
				const projectType = await runSimplePicker(ctx, {
					title: "Project type?",
					items: [
						{ id: "automation / scripts", label: "automation / scripts" },
						{ id: "web application", label: "web application" },
						{ id: "cli tool", label: "cli tool" },
						{ id: "library / package", label: "library / package" },
						{ id: "other", label: "other" },
					],
				});
				const language = await ctx.ui.input("Primary language? (e.g., python, typescript, apps script)");
				const framework = await ctx.ui.input(
					"Framework or platform? (e.g., fastapi, react, google sheets) — optional, press Enter to skip",
				);
				stackHints = [projectType, language, framework].filter(
					(hint): hint is string => typeof hint === "string" && hint.trim() !== "",
				);
			}

			const resources = discoverTechnologyResources(ctx.cwd);
			const matched = matchTechnologies(stackHints, resources);
			if (matched.length === 0) {
				ctx.ui.notify(
					"No technology resources found. Check resources/technologies/ in the extension.",
					"error",
				);
				return;
			}

			// When only the generic fallback matches, the user chooses: fetch real
			// documentation, use generic explicitly, or cancel. Generic is never a
			// silent default.
			const onlyGeneric = matched.every((r) => r.id === "generic");
			if (onlyGeneric) {
				const hintText = stackHints.length > 0 ? ` (${stackHints.join(", ")})` : "";
				const choice = await runSimplePicker(ctx, {
					title: `No technology resource matches this project${hintText}. What do you want to do?`,
					items: [
						{ id: "fetch", label: "Fetch from official docs (recommended)" },
						{ id: "generic", label: "Use generic resource" },
						{ id: "cancel", label: "Cancel" },
					],
				});
				if (!choice || choice === "cancel") {
					ctx.ui.notify("Agent generation cancelled.", "info");
					return;
				}
				if (choice === "fetch") {
					let techHint = stackHints.join(" ").trim();
					if (!techHint) {
						const answer = await ctx.ui.input(
							"Which technology should I fetch? (e.g., rust, django, react)",
						);
						techHint = (answer ?? "").trim();
						if (!techHint) {
							ctx.ui.notify("No technology given. Agent generation cancelled.", "info");
							return;
						}
					}
					const techId = slugify(techHint);
					const resourcePath = `.pi/technologies/${techId}.md`;
					const prompt = [
						`<pi-senai-fetch-technology>`,
						``,
						`Create a technology resource file for: ${techHint}`,
						``,
						`Steps:`,
						`1. Search the web for the OFFICIAL documentation of ${techHint} (official docs site, official guides, official API reference). Do not use blogs or unofficial sources.`,
						`2. Fetch 2-4 official pages.`,
						`3. Write ${resourcePath} following the template at resources/technologies/_template.md:`,
						`   - YAML frontmatter: id: ${techId}, name: <human-readable name>, keywords: [<lowercase keywords including "${techId}">]`,
						`   - Sections: ## Core rules, ## Testing patterns, ## Tooling and limits, ## Common mistakes`,
						`   - Cite the official source URL for every section, like (source: https://...)`,
						`   - Craft only: patterns, limits, testing, common mistakes. No generic advice.`,
						`   - End with a "_Last updated: <date>_" line.`,
						`4. Do NOT guess limits or quotas. If the official docs do not state something, leave it out.`,
						``,
						`After writing the file, tell the user: "Technology resource created at ${resourcePath}. Re-run /senai-generate-sub-agents to generate your team."`,
						``,
						`</pi-senai-fetch-technology>`,
					].join("\n");
					pi.sendUserMessage(prompt);
					return;
				}
				// "Use generic resource" falls through with the generic match.
			}

			const plans = planAgentGeneration(ctx.cwd, targets, matched, report);
			const resourceList = matched.map((r) => r.name).join(", ");

			// Preview the exact write set before asking: fresh agents are created,
			// previously generated agents are classified by manifest hash so the
			// user sees what will be overwritten, kept, or skipped.
			const regenNames = new Set(regen.map((def) => `${slug}-${def.role}`));
			const freshPlans = plans.filter((p) => !regenNames.has(p.agentName));
			const regenPlans = plans.filter((p) => regenNames.has(p.agentName));
			const preview = previewRegeneration(ctx.cwd, regenPlans.map((p) => p.agentName));

			const confirmLines = [`Technology resources: ${resourceList}`, ""];
			if (freshPlans.length > 0) {
				confirmLines.push(
					`New agents to create and map in agents.json (${freshPlans.length}):`,
					...freshPlans.map((p) => `  - ${p.role} → ${p.agentName}`),
					"",
				);
			}
			if (preview.overwrite.length > 0) {
				confirmLines.push(
					`Regenerate in place — proven untouched since generation (${preview.overwrite.length}):`,
					...preview.overwrite.map((rel) => `  - ${rel}`),
					"",
				);
			}
			if (preview.recreate.length > 0) {
				confirmLines.push(
					`Recreate — file missing but mapping exists (${preview.recreate.length}):`,
					...preview.recreate.map((rel) => `  - ${rel}`),
					"",
				);
			}
			if (preview.keptDrifted.length > 0) {
				confirmLines.push(
					`Kept — you edited these after generation, they are NOT overwritten (${preview.keptDrifted.length}):`,
					...preview.keptDrifted.map((rel) => `  - ${rel}`),
					"",
				);
			}
			if (preview.unknown.length > 0) {
				confirmLines.push(
					`Skipped — existing file of unknown origin, never touched (${preview.unknown.length}):`,
					...preview.unknown.map((rel) => `  - ${rel}`),
					"",
				);
			}
			confirmLines.push("Existing custom agents and mappings are not touched. Proceed?");
			const proceed = await runSimpleConfirm(ctx, "Generate sub-agents", confirmLines.join("\n"));
			if (!proceed) {
				ctx.ui.notify("Agent generation cancelled.", "info");
				return;
			}

			const result = writeGeneratedAgents(ctx.cwd, plans, { regenerate: true });

			// Auto-map roles whose files were actually written. Regenerated roles
			// already carry the same mapping, so re-saving it is a harmless no-op.
			const writtenNames = new Set(
				[...result.created, ...result.regenerated].map((rel) => path.basename(rel, ".md")),
			);
			const mapped = plans.filter((p) => writtenNames.has(p.agentName));
			if (mapped.length > 0) {
				const agents = { ...config.agents } as Record<string, string>;
				for (const p of mapped) {
					agents[p.role] = p.agentName;
				}
				saveAgentConfig(ctx.cwd, { ...config, agents });
			}

			const lines = [`Generated ${result.created.length} agent(s) using: ${resourceList}.`];
			if (result.regenerated.length > 0) {
				lines.push(`Regenerated ${result.regenerated.length} agent(s) in place (proven untouched).`);
			}
			if (result.keptDrifted.length > 0) {
				lines.push(
					`Kept ${result.keptDrifted.length} agent(s) you edited after generation: ${result.keptDrifted.join(", ")}`,
				);
			}
			if (result.skipped.length > 0) {
				lines.push(
					`Skipped ${result.skipped.length} existing file(s) of unknown origin: ${result.skipped.join(", ")}`,
				);
			}
			if (mapped.length > 0) {
				lines.push(`Mapped ${mapped.length} role(s) in agents.json.`);
			}
			lines.push("Next: run /senai-doctor to verify the setup.");
			ctx.ui.notify(lines.join("\n"), "info");
		},
	};
	pi.registerCommand("senai-generate-sub-agents", command);
}
