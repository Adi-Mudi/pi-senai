import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../io/atomic-write.js";

export const ARCHITECT_INPUTS_CONFIG_FILE = "architect-inputs.json";

export const ARCHITECT_INPUTS_CONFIG_COMMENT =
	"Senai config: documents and constraints used to derive the project architecture. Managed by /senai-configure-architect-inputs.";

export const CURRENT_ARCHITECT_INPUTS_CONFIG_VERSION = 1;

export const ARCHITECT_DOCUMENT_TYPES = [
	"prd",
	"mrd",
	"brd",
	"rtm",
	"nfr",
	"test-plan",
	"adr",
	"readme",
	"code",
	"feasibility",
] as const;

export type ArchitectDocumentType = (typeof ARCHITECT_DOCUMENT_TYPES)[number];

export interface ArchitectDocumentInput {
	type: ArchitectDocumentType;
	path: string;
}

export interface ArchitectInputsConfig {
	version: 1;
	documents: ArchitectDocumentInput[];
	additionalConstraints: string[];
}

export function getArchitectInputsConfigPath(cwd: string): string {
	return path.join(cwd, ".pi", "senai", ARCHITECT_INPUTS_CONFIG_FILE);
}

export function loadArchitectInputsConfig(cwd: string): ArchitectInputsConfig | null {
	const configPath = getArchitectInputsConfigPath(cwd);
	try {
		const raw = fs.readFileSync(configPath, "utf8");
		const parsed = JSON.parse(raw) as ArchitectInputsConfig;
		delete (parsed as unknown as Record<string, unknown>)._comment;
		validateArchitectInputsConfig(parsed);
		return parsed;
	} catch (err: any) {
		if (err.code === "ENOENT") return null;
		throw new Error(`Invalid architect inputs config at ${configPath}: ${err.message}`);
	}
}

export function saveArchitectInputsConfig(
	cwd: string,
	config: ArchitectInputsConfig,
): void {
	atomicWriteJson(getArchitectInputsConfigPath(cwd), {
		_comment: ARCHITECT_INPUTS_CONFIG_COMMENT,
		...config,
	});
}

export function validateArchitectInputsConfig(config: ArchitectInputsConfig): void {
	if (config.version !== CURRENT_ARCHITECT_INPUTS_CONFIG_VERSION) {
		throw new Error(
			`Unsupported architect-inputs.json version: ${config.version}. Expected version: ${CURRENT_ARCHITECT_INPUTS_CONFIG_VERSION}. Run /senai-configure-architect-inputs to recreate.`,
		);
	}
	if (!Array.isArray(config.documents)) {
		throw new Error("Missing or invalid 'documents' field");
	}
	for (const doc of config.documents) {
		if (!doc || typeof doc !== "object") {
			throw new Error("Each document entry must be an object");
		}
		if (!isArchitectDocumentType(doc.type)) {
			throw new Error(`Unknown document type: ${doc.type}`);
		}
		if (typeof doc.path !== "string" || doc.path.length === 0) {
			throw new Error("Each document must have a non-empty 'path' field");
		}
	}
	if (!Array.isArray(config.additionalConstraints)) {
		throw new Error("Missing or invalid 'additionalConstraints' field");
	}
	for (const constraint of config.additionalConstraints) {
		if (typeof constraint !== "string") {
			throw new Error("'additionalConstraints' must contain only strings");
		}
	}
}

export function isArchitectDocumentType(value: string): value is ArchitectDocumentType {
	return ARCHITECT_DOCUMENT_TYPES.includes(value as ArchitectDocumentType);
}

export function getSelectedInputPaths(config: ArchitectInputsConfig): string[] {
	return config.documents.map((doc) => doc.path);
}

export function createDefaultArchitectInputsConfig(): ArchitectInputsConfig {
	return {
		version: 1,
		documents: [],
		additionalConstraints: [],
	};
}

export interface CodebaseDiscoveryResult {
	config: ArchitectInputsConfig;
	discovered: {
		packageJson: boolean;
		readme: boolean;
		agents: string[];
		skills: string[];
		extensions: string[];
	};
}

const PI_PACKAGE_PREFIXES = ["@mariozechner/pi-", "@earendil-works/pi-"];

function readFirstHeadingFromReadme(cwd: string): string | null {
	for (const candidate of ["README.md", "readme.md", "Readme.md"]) {
		const filePath = path.join(cwd, candidate);
		if (!fs.existsSync(filePath)) continue;
		try {
			const content = fs.readFileSync(filePath, "utf8");
			for (const line of content.split("\n")) {
				const match = line.match(/^#{1,3}\s+(.+?)\s*$/);
				if (match) return match[1].trim();
			}
			return null;
		} catch {
			return null;
		}
	}
	return null;
}

function listAgentFiles(cwd: string): string[] {
	const dir = path.join(cwd, ".pi", "agents");
	if (!fs.existsSync(dir)) return [];
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".md"))
			.map((f) => path.join(".pi", "agents", f));
	} catch {
		return [];
	}
}

function listSkillFiles(cwd: string): string[] {
	const dir = path.join(cwd, ".pi", "skills");
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			if (fs.existsSync(path.join(dir, entry.name, "SKILL.md"))) {
				out.push(path.join(".pi", "skills", entry.name, "SKILL.md"));
			}
		}
	} catch {
		// Skip read errors.
	}
	return out;
}

function listExtensionFiles(cwd: string): string[] {
	const candidates = [path.join(cwd, ".pi", "extensions"), path.join(cwd, "extensions")];
	const out: string[] = [];
	for (const dir of candidates) {
		if (!fs.existsSync(dir)) continue;
		try {
			for (const entry of fs.readdirSync(dir)) {
				if (entry.endsWith(".ts") || entry.endsWith(".js")) {
					out.push(path.relative(cwd, path.join(dir, entry)));
				}
			}
		} catch {
			// Skip read errors.
		}
	}
	return out;
}

export function createInputsConfigFromCodebase(cwd: string): CodebaseDiscoveryResult {
	const constraints: string[] = [];
	const documents: ArchitectDocumentInput[] = [];
	let packageJsonFound = false;

	const pkgPath = path.join(cwd, "package.json");
	if (fs.existsSync(pkgPath)) {
		packageJsonFound = true;
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
			if (typeof pkg.description === "string" && pkg.description.trim()) {
				constraints.push(`package description: ${pkg.description.trim()}`);
			}
			if (Array.isArray(pkg.keywords)) {
				for (const keyword of pkg.keywords) {
					if (typeof keyword === "string" && keyword.trim()) {
						constraints.push(`keyword: ${keyword.trim()}`);
					}
				}
			}
			const peerDeps = pkg.peerDependencies as Record<string, string> | undefined;
			if (peerDeps && typeof peerDeps === "object") {
				for (const dep of Object.keys(peerDeps)) {
					if (PI_PACKAGE_PREFIXES.some((prefix) => dep.startsWith(prefix))) {
						constraints.push(`Pi package declared: ${dep}`);
					}
				}
			}
			const deps = pkg.dependencies as Record<string, string> | undefined;
			if (deps && typeof deps === "object") {
				for (const dep of Object.keys(deps)) {
					if (PI_PACKAGE_PREFIXES.some((prefix) => dep.startsWith(prefix))) {
						constraints.push(`Pi dependency: ${dep}`);
					}
				}
			}
		} catch {
			// Malformed package.json; skip silently.
		}
	}

	const readmeHeading = readFirstHeadingFromReadme(cwd);
	if (readmeHeading) {
		constraints.push(`README first heading: ${readmeHeading}`);
	}

	const agents = listAgentFiles(cwd);
	for (const agentPath of agents) {
		documents.push({ type: "code", path: agentPath });
	}
	const skills = listSkillFiles(cwd);
	for (const skillPath of skills) {
		documents.push({ type: "code", path: skillPath });
	}
	const extensions = listExtensionFiles(cwd);
	for (const extPath of extensions) {
		documents.push({ type: "code", path: extPath });
	}

	const config: ArchitectInputsConfig = {
		version: 1,
		documents,
		additionalConstraints: constraints,
	};

	return {
		config,
		discovered: {
			packageJson: packageJsonFound,
			readme: readmeHeading !== null,
			agents,
			skills,
			extensions,
		},
	};
}