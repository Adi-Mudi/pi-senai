import { describe, it } from "node:test";
import assert from "node:assert";
import {
	buildRegistryBlock,
	MATCH_SCORE_THRESHOLD,
	matchSpecialist,
	rankSpecialists,
} from "../../src/brainstorm/registry.js";
import {
	BRAINSTORM_ELIGIBLE_ROLES,
	isBrainstormEligible,
	type SenaiRole,
} from "../../src/core/agents-config/suggestions.js";

/** Minimal in-memory registry for unit tests — bypasses loadBrainstormRegistry's
 *  filesystem dependency so we can test pure matching/rendering logic. */
function sampleRegistry(): import("../../src/brainstorm/registry.js").BrainstormEligibleAgent[] {
	return [
		{
			role: "scout-1",
			agentName: "scout",
			mandate: "Architecture / big-picture reconnaissance",
			tools: ["Read", "Grep", "Glob"],
			matchKeywords: ["architecture", "system", "big-picture", "overview", "component"],
		},
		{
			role: "scout-2",
			agentName: "scout",
			mandate: "Coder search / pattern lookup in the codebase",
			tools: ["Read", "Grep", "Glob"],
			matchKeywords: ["code", "file", "module", "pattern", "refactor", "deadlock", "lock", "function"],
		},
		{
			role: "scout-3",
			agentName: "scout",
			mandate: "Risk and dependency audit",
			tools: ["Read", "Grep", "Glob"],
			matchKeywords: ["risk", "dependency", "breaking", "security-impact", "vulnerability"],
		},
		{
			role: "scout-4",
			agentName: "scout",
			mandate: "PRD / documentation audit",
			tools: ["Read", "Grep", "Glob"],
			matchKeywords: ["prd", "requirement", "spec", "doc", "manual"],
		},
		{
			role: "planner",
			agentName: "planner",
			mandate: "Trade-off analysis and option comparison",
			tools: ["Read", "Grep", "Glob"],
			matchKeywords: ["trade-off", "option", "approach", "design", "compare", "choice"],
		},
		{
			role: "community-researcher",
			agentName: "web-research",
			mandate: "Read-only web research",
			tools: ["Read", "Grep", "WebSearch", "FetchURL"],
			matchKeywords: ["official", "docs", "community", "web", "external", "library"],
		},
	];
}

describe("registry — eligibility filter", () => {
	it("BRAINSTORM_ELIGIBLE_ROLES lists the 6 expected roles", () => {
		assert.strictEqual(BRAINSTORM_ELIGIBLE_ROLES.length, 6);
	});

	it("isBrainstormEligible returns true for the 6 eligible roles", () => {
		for (const role of BRAINSTORM_ELIGIBLE_ROLES) {
			assert.strictEqual(isBrainstormEligible(role), true, `${role} should be eligible`);
		}
	});

	it("isBrainstormEligible returns false for ineligible roles", () => {
		const ineligible: SenaiRole[] = [
			"implementer",
			"linter",
			"code-review",
			"security-gate",
			"readme-writer",
			"changelog-writer",
			"api-docs-writer",
			"other-docs-writer",
			"archive",
			"full-test",
			"discussion",
			"plan-overview",
		];
		for (const role of ineligible) {
			assert.strictEqual(isBrainstormEligible(role), false, `${role} should NOT be eligible`);
		}
	});
});

describe("registry — matchSpecialist", () => {
	const registry = sampleRegistry();

	it("returns null for empty topic", () => {
		assert.strictEqual(matchSpecialist(registry, ""), null);
	});

	it("returns null for empty registry", () => {
		assert.strictEqual(matchSpecialist([], "anything"), null);
	});

	it("returns null when no agent matches above threshold", () => {
		// "random text" contains no keywords from any role
		assert.strictEqual(matchSpecialist(registry, "random text"), null);
	});

	it("matches scout-2 for a deadlock topic", () => {
		const match = matchSpecialist(registry, "deadlock in lock module");
		assert.ok(match, "expected a match");
		assert.strictEqual(match!.role, "scout-2");
	});

	it("matches scout-1 for an architecture topic", () => {
		const match = matchSpecialist(registry, "what is the overall architecture?");
		assert.ok(match);
		assert.strictEqual(match!.role, "scout-1");
	});

	it("matches planner for a trade-off topic", () => {
		const match = matchSpecialist(registry, "compare options for the retry approach");
		assert.ok(match);
		assert.strictEqual(match!.role, "planner");
	});

	it("matches community-researcher for an official-doc topic", () => {
		const match = matchSpecialist(registry, "what does the official docs say about asyncio?");
		assert.ok(match);
		assert.strictEqual(match!.role, "community-researcher");
	});

	it("matches scout-3 for a risk topic", () => {
		const match = matchSpecialist(registry, "audit dependency risk for the upgrade");
		assert.ok(match);
		assert.strictEqual(match!.role, "scout-3");
	});

	it("matches scout-4 for a PRD topic", () => {
		const match = matchSpecialist(registry, "audit the prd requirements");
		assert.ok(match);
		assert.strictEqual(match!.role, "scout-4");
	});

	it("case-insensitive matching", () => {
		const match = matchSpecialist(registry, "DEADLOCK in LOCK MODULE");
		assert.ok(match);
		assert.strictEqual(match!.role, "scout-2");
	});

	it("threshold is 1 by default (matches single keyword hits)", () => {
		assert.strictEqual(MATCH_SCORE_THRESHOLD, 1);
	});

	it("single-keyword match wins over multi-keyword partial match on different roles", () => {
		// "function" only matches scout-2 — should win
		const match = matchSpecialist(registry, "the foo function is broken");
		assert.ok(match);
		assert.strictEqual(match!.role, "scout-2");
	});
});

describe("registry — rankSpecialists", () => {
	const registry = sampleRegistry();

	it("returns empty list for empty topic", () => {
		assert.deepStrictEqual(rankSpecialists(registry, ""), []);
	});

	it("returns empty list for empty registry", () => {
		assert.deepStrictEqual(rankSpecialists([], "deadlock"), []);
	});

	it("returns top-N by score", () => {
		// "code pattern" hits scout-2 twice → highest score
		const ranked = rankSpecialists(registry, "code pattern in module", 3);
		assert.ok(ranked.length > 0);
		assert.strictEqual(ranked[0].role, "scout-2", "scout-2 should rank first for code pattern topic");
	});

	it("respects the limit", () => {
		const ranked = rankSpecialists(registry, "code module pattern deadlock", 1);
		assert.strictEqual(ranked.length, 1);
	});
});

describe("registry — buildRegistryBlock", () => {
	it("renders an empty registry with a fallback note", () => {
		const block = buildRegistryBlock([]);
		assert.ok(block.includes("Brainstorm-eligible agents"));
		assert.ok(block.includes("no brainstorm-eligible agents configured"));
	});

	it("renders a markdown table for a populated registry", () => {
		const block = buildRegistryBlock(sampleRegistry());
		assert.ok(block.includes("| Role | Agent | Mandate | Match keywords |"));
		assert.ok(block.includes("| scout-1 |"));
		assert.ok(block.includes("| scout-2 |"));
		assert.ok(block.includes("| planner |"));
		assert.ok(block.includes("| community-researcher |"));
	});

	it("includes the dispatch contract (subagent invocation form)", () => {
		const block = buildRegistryBlock(sampleRegistry());
		assert.ok(block.includes("subagent({ agent:"));
		assert.ok(block.includes("Max 3 dispatches"));
	});

	it("suggests a match when topic matches a registered agent", () => {
		const block = buildRegistryBlock(sampleRegistry(), "deadlock in lock module");
		assert.ok(block.includes("Suggested match for"));
		assert.ok(block.includes("scout-2"));
	});

	it("tells the user when no specialist matched", () => {
		const block = buildRegistryBlock(sampleRegistry(), "completely random gibberish");
		assert.ok(block.includes('No specialist matched'));
	});

	it("omits the suggestion line when no topic is given", () => {
		const block = buildRegistryBlock(sampleRegistry(), "");
		assert.ok(!block.includes("Suggested match for"));
	});

	it("mandate text is short and descriptive per role", () => {
		const block = buildRegistryBlock(sampleRegistry());
		assert.ok(block.includes("Architecture / big-picture"));
		assert.ok(block.includes("Coder search"));
		assert.ok(block.includes("Risk and dependency"));
		assert.ok(block.includes("Trade-off"));
		assert.ok(block.includes("web research"));
	});
});
