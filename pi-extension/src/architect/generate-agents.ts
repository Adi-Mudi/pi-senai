// Generates project-specific agent files in .pi/agents/ from a selected architecture.
// Also auto-maps architecture-bound Senai roles in agents.json to the generated names.

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "../io/atomic-write.js";
import { loadAgentConfig, resolveAgentName, saveAgentConfig } from "../agents/config.js";
import { DEFAULT_AGENTS, type SenaiRole } from "../agents/suggestions.js";
import { extractArchitectureRules, slugify } from "./helpers.js";
import { ARCHITECT_ROLES, ARCHITECT_ROLE_STAGE, ARCHITECTURE_AGENT_MAPPING } from "./cleanup.js";
import type { ArchitectProfile } from "./profile.js";
import type { ArchitectureLibraryEntry } from "./library-scan.js";

export function generateAgentFiles(
	cwd: string,
	profile: ArchitectProfile,
	architecture: ArchitectureLibraryEntry,
): string[] {
	const agentsDir = path.join(cwd, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });

	const created: string[] = [];
	const rules = extractArchitectureRules(architecture.content);
	const archId = architecture.id || slugify(architecture.name);

	for (const role of ARCHITECT_ROLES) {
		const agentName = `${profile.projectSlug}-${archId}-${role}`;
		const filePath = path.join(agentsDir, `${agentName}.md`);

		const content = buildAgentMarkdown(agentName, role, profile, architecture, rules, archId);
		atomicWriteFile(filePath, content, "utf8");
		created.push(filePath);
	}

	return created;
}

/** Auto-map architecture-bound roles in agents.json to the generated agents.
 *  Remaps roles still on built-in defaults or pointing at previously generated
 *  agents for this project (stale after an architecture change). Never touches
 *  other custom mappings. Creates agents.json if missing. Returns mapped roles. */
export function autoMapArchitectureAgents(
	cwd: string,
	profile: ArchitectProfile,
	archId: string,
): SenaiRole[] {
	const config = loadAgentConfig(cwd) ?? { version: 1, agents: {} };
	const agents = { ...config.agents } as Record<string, string>;
	const mapped: SenaiRole[] = [];
	for (const { role, suffix } of ARCHITECTURE_AGENT_MAPPING) {
		const expected = `${profile.projectSlug}-${archId}-${suffix}`;
		const current = resolveAgentName(config, role);
		const isDefault = current === DEFAULT_AGENTS[role];
		// Stale = looks generated for this project but the agent file is gone
		// (e.g. removed by removeStaleArchitectureArtifacts on a re-run). A user's
		// own slug-prefixed agent file on disk is never treated as stale.
		const agentFileExists = fs.existsSync(path.join(cwd, ".pi", "agents", `${current}.md`));
		const isStaleGenerated = current.startsWith(`${profile.projectSlug}-`) && !agentFileExists;
		if (!isDefault && !isStaleGenerated) continue;
		if (agents[role] === expected) continue;
		agents[role] = expected;
		mapped.push(role);
	}
	if (mapped.length > 0) {
		saveAgentConfig(cwd, { ...config, agents });
	}
	return mapped;
}

function buildAgentMarkdown(
	agentName: string,
	role: string,
	profile: ArchitectProfile,
	architecture: ArchitectureLibraryEntry,
	rules: string[],
	archId: string,
): string {
	const roleDescription: Record<string, string> = {
		planner: "plans architecture-aware implementation",
		implementer: "implements code following the selected architecture",
		"reviewer-correctness": "reviews correctness against architecture rules",
		"reviewer-security": "reviews security concerns for this architecture",
		"reviewer-tests": "reviews test coverage for this architecture",
	};

	// Reviewers report only — they keep `write` for their review artifact but
	// lose `edit` so they cannot modify source files.
	const roleTools: Record<string, string> = {
		planner: "read, write, edit, bash",
		implementer: "read, write, edit, bash",
		"reviewer-correctness": "read, write, bash",
		"reviewer-security": "read, write, bash",
		"reviewer-tests": "read, write, bash",
	};

	const lines = [
		"---",
		`name: ${agentName}`,
		`description: ${roleDescription[role] ?? role} for ${profile.projectName} using ${architecture.name}`,
		`tools: ${roleTools[role] ?? "read, write, edit, bash"}`,
		`skills: ${profile.projectSlug}-${archId}-${ARCHITECT_ROLE_STAGE[role] ?? "plan"}`,
		"session-mode: lineage-only",
		"auto-exit: true",
		"spawning: false",
		"---",
		"",
		`# ${agentName}`,
		"",
		`You are the ${role} for the ${profile.projectName} project.`,
		"",
		`Architecture: ${architecture.name}`,
		"",
		"## Architecture rules",
		"",
	];

	if (rules.length > 0) {
		for (const rule of rules) {
			lines.push(`- ${rule}`);
		}
	} else {
		lines.push(`- Follow the ${architecture.name} architecture.`);
	}

	lines.push("");
	lines.push("## Project context");
	lines.push("");
	lines.push(`- Functional requirements: ${profile.drivers.functionalRequirements.length} extracted`);
	lines.push(`- Quality attributes: ${profile.drivers.qualityAttributes.length} extracted`);
	lines.push(`- Constraints: ${profile.drivers.constraints.length} extracted`);
	lines.push(`- Technical concerns: ${profile.drivers.technicalConcerns.length} extracted`);

	if (profile.additionalConstraints.length > 0) {
		lines.push("");
		lines.push("## Additional constraints");
		lines.push("");
		for (const constraint of profile.additionalConstraints) {
			lines.push(`- ${constraint}`);
		}
	}

	lines.push("");
	lines.push("## Architecture documents");
	lines.push("");
	lines.push(
		"Before making decisions, read the full architecture description at `.pi/architect/architecture.md` and the relevant ADRs in `.pi/architect/adrs/`.",
	);

	if (architecture.id === "pi-architecture") {
		lines.push("");
		lines.push("## Pi Extension Tool Constraints");
		lines.push("");
		lines.push("This agent is part of a Pi extension project. Tool usage must obey:");
		lines.push("");
		lines.push(`- **Allowed**: ${roleTools[role] ?? "read, write, edit, bash"}`);
		lines.push("- **Required**: every tool call uses `ctx.cwd` instead of `process.cwd()`.");
		lines.push("- **Required**: long-running handlers pass `ctx.signal` to nested async work.");
		lines.push("- **Required**: tools register with TypeBox schemas; never raw object params.");
		lines.push(
			"- **Forbidden**: direct `fs.writeFileSync` outside `io/atomic-write.ts` (use the extension's atomic writer).",
		);
		lines.push("- **Forbidden**: importing from a higher layer (`commands/` may not import from `core/`, etc.).");
		lines.push(
			"- **Reference**: https://pi.dev/docs/latest/skills for skill format, https://pi.dev/packages/pi-package-template for package layout.",
		);
	}

	lines.push("");
	lines.push("## Forbidden patterns");
	lines.push("");
	for (const forbidden of architecture.notForDrivers) {
		lines.push(`- ${forbidden}`);
	}

	// Per-role testing discipline (Plan v2.0). Reviewers act in the plan stage;
	// the code-review role reuses reviewer-correctness per ARCHITECTURE_AGENT_MAPPING
	// so the anti-pattern scan lives there too. Implementer is the only writer in
	// the implement stage; its discipline block is what makes the tests worth
	// writing in the first place. planner and reviewer-security are unchanged.
	const roleDiscipline: Record<string, string[]> = {
		implementer: [
			"## Testing discipline",
			"",
			"Run the affected test files after every commit-sized change. The full suite must stay green; a new failure must be fixed before the next change. Never `skip` / `xfail` a failing test without a `// TODO(reason): re-enable in <ticket>` comment.",
			"",
			"Tests must follow:",
			"- AAA structure (Arrange, Act, Assert separated by blank lines or comments).",
			"- The project's naming convention. One convention only.",
			"- Equivalence partitioning (one representative per input class).",
			"- Boundary value analysis (boundary, just-below, just-above for every numeric / length / range contract).",
			"- Table-driven / parameterized cases for repeated logic.",
			"- At least one property-based test per pure function (Hypothesis, fast-check, jqwik, proptest, FsCheck).",
			"- FIRST quality: Fast (milliseconds), Independent, Repeatable, Self-validating, Timely.",
			"",
			"Coverage target on changed files: 80% line + branch. Security-critical paths (auth, payment, secrets): 100%. Report coverage at the end of the implement stage.",
			"",
			"Anti-patterns to refuse to write: God Test, zero-assertion test, mystery guest, over-mocking (>3 doubles), testing private methods, mirror-logic assertions.",
		],
		"reviewer-tests": [
			"## Review checklist",
			"",
			"Review the plan's test strategy and the implement-stage test artifacts. Write a blocking issue to the review artifact if any item fails.",
			"1. `<plan>` ends with a `## Verification` section listing specific commands or named test cases (not \"tests pass\").",
			"2. High-risk areas (auth, money, data loss, concurrency) name explicit test cases.",
			"3. Input validation tests are listed (empty, null, max-length, invalid encoding).",
			"4. Boundary and edge cases are listed for every numeric / length / range contract.",
			"5. The test framework name and test path are named.",
			"6. No public contract is left untested.",
			"7. Property-based tests are mentioned for pure functions.",
			"8. The implement-stage tests cover the `## Verification` steps.",
			"9. Coverage on changed files is at least 80% (line + branch).",
			"10. The full suite was green at the end of the implement stage.",
		],
		"reviewer-correctness": [
			"## Anti-pattern scan",
			"",
			"When reviewing code (Plan review OR implement-stage code-review), scan the changed tests for these smells and write each finding to the review artifact with file:line and the smell name:",
			"- **God Test** — one test exercises more than one unrelated behavior.",
			"- **Zero-assertion test** — test runs but contains no `assert*` / `expect*` / equivalent.",
			"- **Mystery Guest** — test depends on data from a file, env var, or fixture that is not visible inside the test.",
			"- **Over-Mocking** — test uses more than three test doubles.",
			"- **Private-method testing** — test reaches into non-public API of the system under test.",
			"- **Mirror-logic assertion** — assertion duplicates the production expression (asserts `add(a,b) === a+b`).",
			"- **No AAA structure** — Arrange / Act / Assert not separated.",
			"- **Flaky timing** — test uses `sleep`, `setTimeout`, or fixed waits instead of condition polling.",
			"",
			"Severity: these are blocking when the smell appears in a critical-path test (auth, payment, data loss). They are non-blocking elsewhere but must still be listed.",
		],
	};

	const discipline = roleDiscipline[role];
	if (discipline) {
		lines.push("");
		for (const line of discipline) {
			lines.push(line);
		}
	}

	lines.push("");
	lines.push("## Completion contract");
	lines.push("");
	lines.push("- Write your deliverable to the artifact path given in your task. The file on disk is the deliverable.");
	lines.push(
		"- Your FINAL message must be at most 10 lines: outcome + artifact path(s). Never paste the deliverable content into the final message.",
	);

	return lines.join("\n");
}
