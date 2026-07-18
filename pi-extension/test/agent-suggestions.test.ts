import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildSuggestionMap,
  DEFAULT_AGENTS,
  ROLE_LABELS,
  SENAI_ROLES,
  suggestAgentForRole,
} from "../src/agent-suggestions.js";
import type { DiscoveredAgent } from "../src/agent-discovery.js";

describe("agent-suggestions", () => {
  function agent(name: string, description = ""): DiscoveredAgent {
    return { name, description, source: "project" };
  }

  it("suggests discussion agent", () => {
    const agents = [agent("senai-discussion", "Discussion agent")];
    assert.strictEqual(suggestAgentForRole("discussion", agents), "senai-discussion");
  });

  it("suggests planner agent", () => {
    const agents = [agent("gas-planner", "Planner agent")];
    assert.strictEqual(suggestAgentForRole("planner", agents), "gas-planner");
    assert.strictEqual(suggestAgentForRole("plan-overview", agents), "gas-planner");
  });

  it("prefers generated architecture planner for planner, plan-overview, and scout-1", () => {
    const agents = [
      agent("gas-planner", "Planner agent"),
      agent("inventory-app-modular-monolith-planner", "plans architecture-aware implementation"),
    ];
    assert.strictEqual(suggestAgentForRole("planner", agents), "inventory-app-modular-monolith-planner");
    assert.strictEqual(suggestAgentForRole("plan-overview", agents), "inventory-app-modular-monolith-planner");
    assert.strictEqual(suggestAgentForRole("scout-1", agents), "inventory-app-modular-monolith-planner");
  });

  it("suggests architecture scouts for scout-1 and scout-2", () => {
    const agents = [agent("gas-scout-architecture", "Architecture scout")];
    assert.strictEqual(suggestAgentForRole("scout-1", agents), "gas-scout-architecture");
    assert.strictEqual(suggestAgentForRole("scout-2", agents), "gas-scout-architecture");
  });

  it("suggests risk scout for scout-3", () => {
    const agents = [agent("gas-scout-risk", "Risk and dependency scout")];
    assert.strictEqual(suggestAgentForRole("scout-3", agents), "gas-scout-risk");
  });

  it("suggests requirement scout for scout-4", () => {
    const agents = [agent("gas-scout-requirements", "Requirements documentation scout")];
    assert.strictEqual(suggestAgentForRole("scout-4", agents), "gas-scout-requirements");
  });

  it("suggests reviewer agents for correctness and security roles", () => {
    const agents = [agent("gas-code-reviewer", "Code reviewer for correctness and security")];
    assert.strictEqual(suggestAgentForRole("reviewer-correctness", agents), "gas-code-reviewer");
    assert.strictEqual(suggestAgentForRole("reviewer-security", agents), "gas-code-reviewer");
  });

  it("prefers generated architecture reviewer-correctness when available", () => {
    const agents = [
      agent("gas-code-reviewer", "Code reviewer for correctness and security"),
      agent("inventory-app-modular-monolith-reviewer-correctness", "reviews correctness against architecture rules"),
    ];
    assert.strictEqual(suggestAgentForRole("reviewer-correctness", agents), "inventory-app-modular-monolith-reviewer-correctness");
  });

  it("prefers generated architecture reviewer-correctness for code-review", () => {
    const agents = [
      agent("gas-code-reviewer", "Code reviewer for correctness and security"),
      agent("inventory-app-modular-monolith-reviewer-correctness", "reviews correctness against architecture rules"),
    ];
    assert.strictEqual(suggestAgentForRole("code-review", agents), "inventory-app-modular-monolith-reviewer-correctness");
  });

  it("suggests tester agent for test roles", () => {
    const agents = [agent("gas-tester", "Automated tester")];
    assert.strictEqual(suggestAgentForRole("reviewer-tests", agents), "gas-tester");
    assert.strictEqual(suggestAgentForRole("test-skeleton", agents), "gas-tester");
    assert.strictEqual(suggestAgentForRole("full-test", agents), "gas-tester");
  });

  it("suggests coder agent for implementer", () => {
    const agents = [agent("gas-coder", "Implementation coder")];
    assert.strictEqual(suggestAgentForRole("implementer", agents), "gas-coder");
  });

  it("suggests readme and changelog writers", () => {
    const agents = [
      agent("readme-writer", "Writes README files"),
      agent("changelog-writer", "Writes CHANGELOG files"),
    ];
    assert.strictEqual(suggestAgentForRole("readme-writer", agents), "readme-writer");
    assert.strictEqual(suggestAgentForRole("changelog-writer", agents), "changelog-writer");
  });

  it("suggests api docs writer", () => {
    const agents = [agent("api-docs-writer", "Writes API documentation")];
    assert.strictEqual(suggestAgentForRole("api-docs-writer", agents), "api-docs-writer");
  });

  it("suggests security auditor for security-gate", () => {
    const agents = [agent("security-auditor", "Security audit agent")];
    assert.strictEqual(suggestAgentForRole("security-gate", agents), "security-auditor");
  });

  it("returns undefined when no agent matches", () => {
    const agents = [agent("unrelated", "Does unrelated work")];
    assert.strictEqual(suggestAgentForRole("implementer", agents), undefined);
  });

  it("buildSuggestionMap returns a map with all matched roles", () => {
    const agents = [
      agent("senai-discussion", "Discussion"),
      agent("gas-coder", "Coder"),
    ];
    const map = buildSuggestionMap(agents);
    assert.strictEqual(map.discussion, "senai-discussion");
    assert.strictEqual(map.implementer, "gas-coder");
  });

  it("DEFAULT_AGENTS covers every role", () => {
    for (const role of SENAI_ROLES) {
      assert.ok(DEFAULT_AGENTS[role], `Missing default agent for ${role}`);
    }
  });

  it("buildSuggestionMap returns an empty object for an empty agent list", () => {
    assert.deepStrictEqual(buildSuggestionMap([]), {});
  });

  it("suggests by description text when the name has no keyword", () => {
    const agents = [agent("alpha", "Security audit specialist")];
    assert.strictEqual(suggestAgentForRole("security-gate", agents), "alpha");
  });

  it("ROLE_LABELS covers every role", () => {
    for (const role of SENAI_ROLES) {
      assert.ok(ROLE_LABELS[role] && ROLE_LABELS[role].length > 0, `Missing label for ${role}`);
    }
  });
});
