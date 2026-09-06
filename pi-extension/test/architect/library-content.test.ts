import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverArchitectureLibrary } from "../../src/architect/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "../../../..");
const LIBRARY_DIR = path.join(PROJECT_ROOT, ".pi", "architecture-library");

const REQUIRED_SECTIONS = ["## When to use", "## When not to use", "## Core rules"];

const PI_EXTENSION_SUB_PATTERNS = [
	"pi-extension-orchestrator",
	"pi-extension-subagent-delegator",
	"pi-extension-memory",
	"pi-extension-tool-provider",
	"pi-extension-guard",
	"pi-extension-compactor",
	"pi-extension-theme",
	"pi-extension-provider",
	"pi-extension-mcp-bridge",
	"pi-extension-rpc",
];

const PI_OFFICIAL_SPECS = [
	"pi-extension-package-manifest",
	"pi-extension-lifecycle-events",
	"pi-extension-api-surface",
	"pi-skill-format-spec",
	"pi-agent-format-spec",
	"pi-discovery-paths",
];

const PI_AWARE_PROJECTS = ["pi-coding-agent", "pi-skill-package", "pi-rpc-host"];

function readEntry(name: string): string {
	const filePath = path.join(LIBRARY_DIR, `${name}.md`);
	if (!fs.existsSync(filePath)) {
		throw new Error(`Missing library entry: ${filePath}`);
	}
	return fs.readFileSync(filePath, "utf8");
}

function parseFrontmatter(content: string): Record<string, unknown> {
	const match = content.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) return {};
	const fm: Record<string, unknown> = {};
	for (const line of match[1].split("\n")) {
		const colonAt = line.indexOf(":");
		if (colonAt <= 0) continue;
		const key = line.slice(0, colonAt).trim();
		const value = line.slice(colonAt + 1).trim();
		if (!key) continue;
		if (Array.isArray(fm[key])) {
			(fm[key] as string[]).push(value);
		} else if (fm[key] !== undefined) {
			fm[key] = [`${fm[key]}`, value];
		} else {
			fm[key] = value;
		}
	}
	return fm;
}

describe("architecture library content", () => {
	it("contains at least 35 entries", () => {
		const entries = discoverArchitectureLibrary(PROJECT_ROOT);
		assert.ok(
			entries.length >= 35,
			`expected >= 35 library entries, got ${entries.length}`,
		);
	});

	it("contains all 10 Pi extension sub-pattern entries", () => {
		for (const name of PI_EXTENSION_SUB_PATTERNS) {
			const content = readEntry(name);
			const fm = parseFrontmatter(content);
			assert.strictEqual(fm.name, name, `${name} frontmatter name mismatch`);
			assert.strictEqual(fm.domain, "pi-extension", `${name} domain should be pi-extension`);
			assert.strictEqual(fm.source, "official-pi-pattern", `${name} source should be official-pi-pattern`);
			for (const section of REQUIRED_SECTIONS) {
				assert.ok(
					content.includes(section),
					`${name} is missing required section "${section}"`,
				);
			}
		}
	});

	it("contains all 6 Pi official spec entries", () => {
		for (const name of PI_OFFICIAL_SPECS) {
			const content = readEntry(name);
			const fm = parseFrontmatter(content);
			assert.strictEqual(fm.name, name, `${name} frontmatter name mismatch`);
			assert.ok(
				String(fm.domain).startsWith("pi-extension-spec"),
				`${name} domain should start with pi-extension-spec`,
			);
			assert.strictEqual(fm.source, "official-pi-spec", `${name} source should be official-pi-spec`);
			assert.ok(
				content.includes("## ") && content.includes("\n## "),
				`${name} should contain at least two sections`,
			);
		}
	});

	it("contains all 3 Pi-aware project architecture entries", () => {
		for (const name of PI_AWARE_PROJECTS) {
			const content = readEntry(name);
			const fm = parseFrontmatter(content);
			assert.strictEqual(fm.name, name, `${name} frontmatter name mismatch`);
			assert.ok(
				String(fm.domain).startsWith("pi-extension-project"),
				`${name} domain should start with pi-extension-project`,
			);
			assert.strictEqual(
				fm.source,
				"official-pi-project",
				`${name} source should be official-pi-project`,
			);
			for (const section of REQUIRED_SECTIONS) {
				assert.ok(
					content.includes(section),
					`${name} is missing required section "${section}"`,
				);
			}
		}
	});

	it("every entry has name + domain + source frontmatter fields", () => {
		const entries = discoverArchitectureLibrary(PROJECT_ROOT);
		for (const entry of entries) {
			assert.ok(entry.name.length > 0, `entry missing name: ${entry.filePath}`);
			assert.ok(entry.domain.length > 0, `entry missing domain: ${entry.filePath}`);
			assert.ok(
				entry.bestForDrivers.length > 0,
				`entry missing best-for-drivers: ${entry.filePath}`,
			);
			assert.ok(
				entry.notForDrivers.length > 0,
				`entry missing not-for-drivers: ${entry.filePath}`,
			);
		}
	});

	it("pi-architecture.md is enriched with full Pi spec sections", () => {
		const content = readEntry("pi-architecture");
		const requiredEnrichedSections = [
			"## Mandatory imports",
			"## Peer dependencies rule",
			"## Lifecycle event catalog",
			"## ExtensionAPI surface",
			"## Package manifest schema",
			"## Discovery paths",
			"## Skill format",
			"## Agent format",
		];
		for (const section of requiredEnrichedSections) {
			assert.ok(
				content.includes(section),
				`pi-architecture.md missing enriched section "${section}"`,
			);
		}
	});

	it("every Pi extension entry references at least one Pi-specific concept", () => {
		const entries = discoverArchitectureLibrary(PROJECT_ROOT);
		const piEntries = entries.filter((e) => e.domain.some((d) => d.startsWith("pi-extension")));
		assert.ok(piEntries.length >= 19, `expected >= 19 pi-extension entries, got ${piEntries.length}`);
		for (const entry of piEntries) {
			const body = entry.content.toLowerCase();
			const hasConcept =
				body.includes("extension") ||
				body.includes("pi.") ||
				body.includes("pi-") ||
				body.includes("peerdependencies") ||
				body.includes("frontmatter") ||
				body.includes("register") ||
				body.includes("extensionapi");
			assert.ok(hasConcept, `pi entry ${entry.name} has no Pi-specific concept in body`);
		}
	});

	it("all 4 extension skeleton template directories exist with required files", () => {
		const templatesDir = path.join(PROJECT_ROOT, "resources", "extension-templates");
		const templates: Record<string, string[]> = {
			"extension-skeleton": ["package.json", "src/index.ts", "tsconfig.json", "README.md", ".gitignore"],
			"skill-skeleton": ["SKILL.md"],
			"agent-skeleton": ["AGENT.md"],
			"package-skeleton": ["package.json"],
		};
		for (const [dir, files] of Object.entries(templates)) {
			const fullDir = path.join(templatesDir, dir);
			assert.ok(fs.existsSync(fullDir), `missing template dir: ${dir}`);
			for (const file of files) {
				const fullPath = path.join(fullDir, file);
				assert.ok(fs.existsSync(fullPath), `missing file: ${dir}/${file}`);
			}
		}
	});

	it("extension-skeleton package.json has peerDependencies + pi manifest", () => {
		const pkgPath = path.join(PROJECT_ROOT, "resources/extension-templates/extension-skeleton/package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
		const peer = pkg.peerDependencies as Record<string, string>;
		assert.ok(peer["@mariozechner/pi-coding-agent"], "missing pi-coding-agent peer dep");
		assert.ok(peer["@sinclair/typebox"], "missing typebox peer dep");
		const piManifest = pkg.pi as Record<string, unknown>;
		assert.ok(Array.isArray(piManifest.extensions), "missing pi.extensions array");
		const keywords = pkg.keywords as string[];
		assert.ok(keywords.includes("pi-package"), "missing pi-package keyword");
	});

	it("skill-skeleton SKILL.md has required frontmatter", () => {
		const skillPath = path.join(PROJECT_ROOT, "resources/extension-templates/skill-skeleton/SKILL.md");
		const content = fs.readFileSync(skillPath, "utf8");
		assert.ok(content.startsWith("---"), "skill must start with YAML frontmatter");
		assert.ok(content.includes("name:"), "skill frontmatter must include name");
		assert.ok(content.includes("description:"), "skill frontmatter must include description");
	});

	it("agent-skeleton AGENT.md has required frontmatter", () => {
		const agentPath = path.join(PROJECT_ROOT, "resources/extension-templates/agent-skeleton/AGENT.md");
		const content = fs.readFileSync(agentPath, "utf8");
		assert.ok(content.startsWith("---"), "agent must start with YAML frontmatter");
		assert.ok(content.includes("name:"), "agent frontmatter must include name");
		assert.ok(content.includes("description:"), "agent frontmatter must include description");
		assert.ok(content.includes("tools:"), "agent frontmatter must include tools");
	});
});