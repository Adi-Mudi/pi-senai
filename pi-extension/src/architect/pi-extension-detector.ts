import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitecturalDrivers } from "./drivers.js";
import type { ArchitectInputsConfig } from "./inputs-config.js";

export interface PiExtensionDetection {
	isPiExtension: boolean;
	confidence: number;
	matchedPatterns: string[];
	piSpecificSignals: PiSpecificSignal[];
}

export interface PiSpecificSignal {
	source: "drivers" | "inputsConfig" | "packageJson" | "agentFile";
	pattern: string;
	evidence: string;
}

const PI_KEYWORDS = [
	"pi extension",
	"pi-coding-agent",
	"pi-coding agent",
	"@mariozechner/pi-",
	"@earendil-works/pi-",
	"pi agent toolkit",
	"extension api",
	"extensionapi",
	"skill system",
	"subagent delegation",
	"pi tui",
	"typebox",
	"registertool",
	"registercommand",
	"registerprovider",
	"registermessage renderer",
];

const PI_NEG = [
	"sealed product",
	"no extension",
	"single tool only",
	"non distributable",
	"ide-first",
	"ide first",
	"mobile application",
	"web application only",
];

const HIGH_CONFIDENCE_SIGNALS = [
	"pi-coding-agent",
	"@mariozechner/pi-",
	"@earendil-works/pi-",
	"extensionapi",
	"registertool",
	"registercommand",
	"registerprovider",
	"subagent delegation",
	"tool_call interception",
];

export function detectPiExtension(
	cwd: string,
	drivers: ArchitecturalDrivers | null,
	inputsConfig: ArchitectInputsConfig | null,
): PiExtensionDetection {
	const matchedPatterns: string[] = [];
	const piSpecificSignals: PiSpecificSignal[] = [];

	if (drivers) {
		const driverText = buildDriverText(drivers).toLowerCase();
		for (const keyword of PI_KEYWORDS) {
			if (driverText.includes(keyword.toLowerCase())) {
				matchedPatterns.push(keyword);
			}
		}
		for (const constraint of drivers.constraints) {
			const text = `${constraint.category} ${constraint.description}`.toLowerCase();
			for (const keyword of PI_KEYWORDS) {
				if (text.includes(keyword.toLowerCase())) {
					piSpecificSignals.push({
						source: "drivers",
						pattern: keyword,
						evidence: `constraint: ${constraint.id} (${constraint.category})`,
					});
				}
			}
			for (const neg of PI_NEG) {
				if (text.includes(neg.toLowerCase())) {
					piSpecificSignals.push({
						source: "drivers",
						pattern: neg,
						evidence: `constraint: ${constraint.id} (${constraint.category})`,
					});
				}
			}
		}
		for (const concern of drivers.technicalConcerns) {
			const text = concern.description.toLowerCase();
			for (const keyword of PI_KEYWORDS) {
				if (text.includes(keyword.toLowerCase())) {
					piSpecificSignals.push({
						source: "drivers",
						pattern: keyword,
						evidence: `technicalConcern: ${concern.id}`,
					});
				}
			}
			for (const neg of PI_NEG) {
				if (text.includes(neg.toLowerCase())) {
					piSpecificSignals.push({
						source: "drivers",
						pattern: neg,
						evidence: `technicalConcern: ${concern.id}`,
					});
				}
			}
		}
	}

	if (inputsConfig) {
		const configText = JSON.stringify(inputsConfig).toLowerCase();
		for (const keyword of PI_KEYWORDS) {
			if (configText.includes(keyword.toLowerCase())) {
				matchedPatterns.push(keyword);
				piSpecificSignals.push({
					source: "inputsConfig",
					pattern: keyword,
					evidence: "architect-inputs.json",
				});
			}
		}
		for (const neg of PI_NEG) {
			if (configText.includes(neg.toLowerCase())) {
				piSpecificSignals.push({
					source: "inputsConfig",
					pattern: neg,
					evidence: "architect-inputs.json",
				});
			}
		}
	}

	const packageJsonSignals = inspectPackageJson(cwd, matchedPatterns);
	piSpecificSignals.push(...packageJsonSignals);

	const agentSignals = inspectAgentFiles(cwd, matchedPatterns);
	piSpecificSignals.push(...agentSignals);

	const negMatch = piSpecificSignals.filter((s) => PI_NEG.includes(s.pattern));
	const piMatch = piSpecificSignals.filter((s) => !PI_NEG.includes(s.pattern));
	const highConfidence = piMatch.filter((s) => HIGH_CONFIDENCE_SIGNALS.includes(s.pattern));

	let score = piMatch.length + highConfidence.length * 2 - negMatch.length * 3;
	const confidence = Math.max(0, Math.min(1, score / 5));

	return {
		isPiExtension: confidence >= 0.5,
		confidence,
		matchedPatterns: Array.from(new Set(matchedPatterns)),
		piSpecificSignals,
	};
}

function inspectPackageJson(cwd: string, matchedPatterns: string[]): PiSpecificSignal[] {
	const signals: PiSpecificSignal[] = [];
	const pkgPath = path.join(cwd, "package.json");
	if (!fs.existsSync(pkgPath)) return signals;

	try {
		const raw = fs.readFileSync(pkgPath, "utf8");
		const pkg = JSON.parse(raw) as Record<string, unknown>;
		const deps = {
			...(pkg.dependencies as Record<string, string> | undefined),
			...(pkg.devDependencies as Record<string, string> | undefined),
			...(pkg.peerDependencies as Record<string, string> | undefined),
		};
		for (const dep of Object.keys(deps)) {
			if (
				dep.startsWith("@mariozechner/pi-") ||
				dep.startsWith("@earendil-works/pi-") ||
				dep === "@sinclair/typebox" ||
				dep === "typebox"
			) {
				matchedPatterns.push(dep);
				signals.push({
					source: "packageJson",
					pattern: dep,
					evidence: `package.json dependency`,
				});
			}
		}
		const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : [];
		if (keywords.includes("pi-package") || keywords.includes("pi-extension")) {
			matchedPatterns.push("pi-package");
			signals.push({
				source: "packageJson",
				pattern: "pi-package",
				evidence: "package.json keywords",
			});
		}
		const piManifest = pkg.pi as Record<string, unknown> | undefined;
		if (piManifest && typeof piManifest === "object") {
			matchedPatterns.push("pi manifest");
			signals.push({
				source: "packageJson",
				pattern: "pi manifest",
				evidence: "package.json pi key",
			});
		}
	} catch {
		// Malformed package.json; skip silently.
	}
	return signals;
}

function inspectAgentFiles(cwd: string, matchedPatterns: string[]): PiSpecificSignal[] {
	const signals: PiSpecificSignal[] = [];
	const agentsDirs = [
		path.join(cwd, ".pi", "agents"),
		path.join(cwd, "extensions"),
	];
	for (const dir of agentsDirs) {
		if (!fs.existsSync(dir)) continue;
		try {
			const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".ts"));
			if (files.length > 0) {
				matchedPatterns.push("agent files");
				signals.push({
					source: "agentFile",
					pattern: "agent files",
					evidence: `${dir} (${files.length} files)`,
				});
				break;
			}
		} catch {
			// Skip read errors.
		}
	}
	return signals;
}

function buildDriverText(drivers: ArchitecturalDrivers): string {
	const parts: string[] = [];
	for (const fr of drivers.functionalRequirements) parts.push(fr.description);
	for (const qa of drivers.qualityAttributes) {
		parts.push(qa.category);
		parts.push(qa.description);
		if (qa.target) parts.push(qa.target);
	}
	for (const c of drivers.constraints) {
		parts.push(c.category);
		parts.push(c.description);
	}
	for (const tc of drivers.technicalConcerns) parts.push(tc.description);
	return parts.join(" ");
}