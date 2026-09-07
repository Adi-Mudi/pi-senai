import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	discoverArchitectureLibrary,
	suggestArchitectures,
	createInputsConfigFromCodebase,
} from "../architect/index.js";
import { resolveSkillPath } from "../prompt.js";
import type {
	ProjectAnswers,
	ProjectPurpose,
	ProjectScale,
	ProjectDeployment,
	ProjectRealtime,
} from "../architect/library-suggester.js";

const PURPOSE_OPTIONS = [
	"Extension / plugin for Pi",
	"Coding agent / CLI tool",
	"Web application",
	"API / backend service",
	"Library / SDK",
];

const SCALE_OPTIONS = [
	"Single user / prototype",
	"Small team (2-5)",
	"Medium team (6-20)",
	"Large org (20+)",
];

const DEPLOYMENT_OPTIONS = [
	"Cloud (AWS / GCP / Azure)",
	"On-premise",
	"Local / desktop",
	"Edge / IoT",
];

const REALTIME_OPTIONS = ["No (request/response)", "Yes (live updates, events)"];

const PURPOSE_MAP: Record<string, ProjectPurpose> = {
	"Extension / plugin for Pi": "extension",
	"Coding agent / CLI tool": "coding-agent",
	"Web application": "web-app",
	"API / backend service": "api",
	"Library / SDK": "library",
};

const SCALE_MAP: Record<string, ProjectScale> = {
	"Single user / prototype": "single-user",
	"Small team (2-5)": "small-team",
	"Medium team (6-20)": "medium-team",
	"Large org (20+)": "large-org",
};

const DEPLOYMENT_MAP: Record<string, ProjectDeployment> = {
	"Cloud (AWS / GCP / Azure)": "cloud",
	"On-premise": "on-premise",
	"Local / desktop": "local",
	"Edge / IoT": "edge",
};

const REALTIME_MAP: Record<string, ProjectRealtime> = {
	"No (request/response)": "no",
	"Yes (live updates, events)": "yes",
};

export function registerSuggestArchitectCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-suggest-architect", {
		description: "Pick architecture from library via 4 questions (no input docs needed)",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;

			const library = discoverArchitectureLibrary(cwd);
			if (library.length === 0) {
				ctx.ui.notify(
					"No architecture-library entries found. Add .pi/architecture-library/*.md files first.",
					"warning",
				);
				return;
			}

			const purposeLabel = await ctx.ui.select(
				"What is the primary purpose of this project?",
				PURPOSE_OPTIONS,
			);
			if (!purposeLabel) return;

			const scaleLabel = await ctx.ui.select(
				"What is the expected scale?",
				SCALE_OPTIONS,
			);
			if (!scaleLabel) return;

			const deploymentLabel = await ctx.ui.select(
				"Where will it run?",
				DEPLOYMENT_OPTIONS,
			);
			if (!deploymentLabel) return;

			const realtimeLabel = await ctx.ui.select(
				"Does it need real-time features?",
				REALTIME_OPTIONS,
			);
			if (!realtimeLabel) return;

			const answers: ProjectAnswers = {
				purpose: PURPOSE_MAP[purposeLabel] ?? "extension",
				scale: SCALE_MAP[scaleLabel] ?? "small-team",
				deployment: DEPLOYMENT_MAP[deploymentLabel] ?? "local",
				realtime: REALTIME_MAP[realtimeLabel] ?? "no",
			};

			const suggestions = suggestArchitectures(answers, library, 3);

			const pickerOptions = suggestions.map((s) => {
				const matched = s.matchedKeywords.length > 0 ? ` — ${s.matchedKeywords.join(", ")}` : "";
				return `${s.entry.name} (score ${s.score})${matched}`;
			});
			pickerOptions.push("None fit — show me how to add one");

			const selected = await ctx.ui.select(
				`Top ${suggestions.length} architecture match${suggestions.length === 1 ? "" : "es"}:`,
				pickerOptions,
			);

			if (!selected) return;

			if (selected === pickerOptions[pickerOptions.length - 1]) {
				ctx.ui.notify(buildNewEntryGuide(), "info");
				return;
			}

			const selectedEntry = suggestions.find((s) => pickerOptions.includes(`${s.entry.name} (score ${s.score})${s.matchedKeywords.length > 0 ? ` — ${s.matchedKeywords.join(", ")}` : ""}`))?.entry;
			if (!selectedEntry) {
				ctx.ui.notify("Selected entry not found in suggestions.", "warning");
				return;
			}

			const discovery = createInputsConfigFromCodebase(cwd);

			let skill = "";
			try {
				const skillPath = resolveSkillPath("generate-architect");
				skill = fs
					.readFileSync(skillPath, "utf8")
					.replace(/^---\n[\s\S]*?\n---\n*/, "")
					.trim();
			} catch {
				skill = "";
			}

			const prompt = [
				`<pi-senai-generate-architect>`,
				``,
				`User selected architecture via /senai-suggest-architect: ${selectedEntry.name}.`,
				``,
				`Answers:`,
				`  - purpose: ${answers.purpose}`,
				`  - scale: ${answers.scale}`,
				`  - deployment: ${answers.deployment}`,
				`  - realtime: ${answers.realtime}`,
				``,
				`Auto-discovered from codebase:`,
				`  - package.json: ${discovery.discovered.packageJson ? "yes" : "no"}`,
				`  - README: ${discovery.discovered.readme ? "yes" : "no"}`,
				`  - Agents: ${discovery.discovered.agents.length}`,
				`  - Skills: ${discovery.discovered.skills.length}`,
				`  - Extensions: ${discovery.discovered.extensions.length}`,
				``,
				`Auto-discovered additional constraints:`,
				...discovery.config.additionalConstraints.map((c: string) => `  - ${c}`),
				``,
				`Selected architecture: ${selectedEntry.name} (id: ${selectedEntry.id})`,
				``,
				`Expected artifacts (same as /senai-generate-architect):`,
				`  - .pi/architect/architectural-drivers.json`,
				`  - .pi/architect/architect-profile.json`,
				`  - .pi/architect/architect-report.json`,
				`  - .pi/architect/architecture.md`,
				`  - .pi/architect/adrs/*.md`,
				`  - .pi/agents/<project>-<archId>-<role>.md`,
				`  - .pi/skills/<project>-<archId>-<stage>/SKILL.md`,
				``,
				`</pi-senai-generate-architect>`,
				``,
				skill,
			].join("\n");

			pi.sendUserMessage(prompt);
		},
	});
}

export function buildNewEntryGuide(): string {
	return [
		"No architecture in the library matches your project well.",
		"",
		"To add a new architecture:",
		"",
		"1. Open or create .pi/architecture-library/<your-name>.md",
		"",
		"2. Use this template (frontmatter + 5 sections):",
		"",
		"---",
		"name: my-new-architecture",
		"domain: <comma-separated>",
		"team-size: <small|medium|large>",
		"complexity: <low|medium|high>",
		"best-for-drivers:",
		"  - <keyword 1>",
		"  - <keyword 2>",
		"not-for-drivers:",
		"  - <keyword to exclude>",
		"source: community",
		"---",
		"",
		"# My New Architecture",
		"",
		"## When to use",
		"- ...",
		"",
		"## When not to use",
		"- ...",
		"",
		"## Core rules",
		"1. ...",
		"",
		"## Typical structure",
		"```",
		"src/",
		"  ...",
		"```",
		"",
		"## Common pitfalls",
		"- ...",
		"",
		"3. Save the file. Re-run /senai-suggest-architect; the new entry will appear in the picker.",
		"",
		"4. To share with the Senai community, open a PR at",
		"   github.com/Adi-Mudi/pi-senai/.pi/architecture-library/",
	].join("\n");
}