import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadDrivers } from "../architect/drivers.js";
import {
	areDriversStale,
	detectPiExtension,
} from "../architect/index.js";
import { loadArchitectInputsConfig, getSelectedInputPaths } from "../architect/inputs-config.js";
import { resolveSkillPath } from "../prompt.js";
import { runSimpleConfirm } from "../ui/simple-picker.js";

export function registerArchitectCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-generate-architect", {
		description: "Generate a project-specific architecture agent and skills",
		handler: async (_args, ctx) => {
			const inputsConfig = loadArchitectInputsConfig(ctx.cwd);
			if (!inputsConfig) {
				let detection;
				try {
					detection = detectPiExtension(ctx.cwd, null, null);
				} catch {
					detection = null;
				}
				if (detection?.isPiExtension) {
					ctx.ui.notify(
						"No architect-inputs.json found, but this looks like a Pi extension project.\n\nRecommended: run /senai-suggest-architect — it picks the right architecture from the library by asking 4 project questions, no input docs required.\n\nOther options:\n  /senai-configure-architect-inputs — pick documents manually (existing flow)",
						"info",
					);
				} else {
					ctx.ui.notify(
						"No architect inputs configured. Run /senai-configure-architect-inputs first.",
						"warning",
					);
				}
				return;
			}

			const skillPath = resolveSkillPath("generate-architect");
			let skill = "";
			try {
				skill = fs.readFileSync(skillPath, "utf8").replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
			} catch {
				skill = defaultArchitectSkill();
			}

			const selectedPaths = getSelectedInputPaths(inputsConfig);
			const drivers = loadDrivers(ctx.cwd);
			const stale = areDriversStale(ctx.cwd, inputsConfig);
			let changeNote = "";
			if (stale) {
				if (drivers) {
					const proceed = await runSimpleConfirm(
						ctx,
						"Architecture inputs changed",
						"Input documents are newer than the generated architecture. Re-run the full architecture factory?",
					);
					if (!proceed) {
						ctx.ui.notify("Architecture generation cancelled. Update inputs or re-run when ready.", "info");
						return;
					}
				}
				changeNote =
					"Input documents have changed. Regenerate architectural drivers, profile, report, architecture.md, ADRs, agents, and skills from scratch.";
			}

			const prompt = [
				`<pi-senai-generate-architect>`,
				``,
				`Generate a project-specific architecture agent and skills.`,
				``,
				`Configured input documents:`,
				...selectedPaths.map((p) => `  - ${p}`),
				``,
				`Additional constraints:`,
				...inputsConfig.additionalConstraints.map((r) => `  - ${r}`),
				` `,
				drivers
					? `Existing architectural drivers are available at .pi/architect/architectural-drivers.json. Re-run the full flow only if the user asks for it or the inputs changed.`
					: `No architectural drivers found. Run the full architect flow.`,
				``,
				`Expected artifacts:`,
				`  - .pi/architect/architectural-drivers.json`,
				`  - .pi/architect/architect-profile.json`,
				`  - .pi/architect/architect-report.json`,
				`  - .pi/architect/architecture.md`,
				`  - .pi/architect/adrs/*.md`,
				`  - .pi/agents/<project>-<architecture-id>-<role>.md`,
				`  - .pi/skills/<project>-<architecture-id>-<stage>/SKILL.md`,
				changeNote ? `Note: ${changeNote}` : "",
				``,
				`</pi-senai-generate-architect>`,
				``,
				skill,
			].join("\n");

			pi.sendUserMessage(prompt);
		},
	});
}

export function defaultArchitectSkill(): string {
	return [
		`# Architect Generation`,
		``,
		`Follow the sequence in Doc/architect-sequence.md.`,
		``,
		`1. Read .pi/senai/architect-inputs.json.`,
		`2. For each configured document, spawn an architect-document-ingest subagent to extract architectural drivers. Run up to 4 subagents in parallel.`,
		`3. Each subagent must write its output to .IDE_Plans/architect-map/<sanitized-path>.json and nowhere else.`,
		`4. Call the senai_merge_architect_drivers tool to merge map outputs into .pi/architect/architectural-drivers.json.`,
		`5. Check for missing critical drivers. Use AskUserQuestion to fill gaps.`,
		`6. Save the updated profile to .pi/architect/architect-profile.json. Use the architecture id (not the long name) as selectedArchitecture.`,
		`7. Read .pi/architecture-library/ and select the best architecture.`,
		`8. Write .pi/architect/architect-report.json with selectedArchitecture (the architecture id), confidence, missingResources, reasoning, skillProfile, developmentOrder, feasibility, feasibilityReasoning, techStack, atomicFunctions, systemOverview, components, interfaces, dataFlow, dataModel, deployment, qualityAttributeMapping, adrs, and constraints.`,
		`9. Evaluate feasibility. If not-feasible, stop and notify the user. If risky, ask before proceeding.`,
		`10. If missingResources is not empty, stop and ask the user whether to search the web for resources.`,
		`11. Call the senai_finalize_architecture tool to generate .pi/architect/architecture.md, .pi/architect/adrs/*.md, .pi/agents/<project>-<architecture-id>-<role>.md, and .pi/skills/<project>-<architecture-id>-<stage>/SKILL.md.`,
		`12. Notify the user of the results.`,

	].join("\n");
}
