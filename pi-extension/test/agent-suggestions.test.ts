import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildSuggestionMap,
  DEFAULT_AGENTS,
  DOCUMENT_ROLES,
  PICKER_ROLES,
  ROLE_GUIDANCE,
  ROLE_LABELS,
  SENAI_ROLES,
  SEQUENCE_ROLES,
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

  it("returns undefined for an empty agents array", () => {
    assert.strictEqual(suggestAgentForRole("planner", []), undefined);
    assert.strictEqual(suggestAgentForRole("implementer", []), undefined);
  });

  it("matches keywords case-insensitively", () => {
    const agents = [agent("GAS-CODER", "SECURITY AUDIT")];
    assert.strictEqual(suggestAgentForRole("implementer", agents), "GAS-CODER");
    assert.strictEqual(suggestAgentForRole("security-gate", agents), "GAS-CODER");
  });

  it("suggests scout-2 via the big keyword", () => {
    const agents = [agent("gas-scout-big", "Big picture code scout")];
    assert.strictEqual(suggestAgentForRole("scout-2", agents), "gas-scout-big");
  });

  it("suggests scout-3 via the dependency keyword", () => {
    const agents = [agent("gas-scout-deps", "Dependency audit scout")];
    assert.strictEqual(suggestAgentForRole("scout-3", agents), "gas-scout-deps");
  });

  it("suggests scout-4 via the doc keyword", () => {
    const agents = [agent("gas-scout-docs", "Documentation coverage scout")];
    assert.strictEqual(suggestAgentForRole("scout-4", agents), "gas-scout-docs");
  });

  it("suggests implementer via the worker keyword", () => {
    const agents = [agent("senai-worker", "Worker for heavy lifting")];
    assert.strictEqual(suggestAgentForRole("implementer", agents), "senai-worker");
  });

  it("does not suggest api-docs-writer when only the api keyword is present", () => {
    const agents = [agent("api-helper", "API integration helper")];
    assert.strictEqual(suggestAgentForRole("api-docs-writer", agents), undefined);
  });

  it("does not suggest security-gate without the audit keyword", () => {
    const agents = [agent("security-scanner", "Security scanning agent")];
    assert.strictEqual(suggestAgentForRole("security-gate", agents), undefined);
  });

  it("an x-planner agent without architecture falls through to the keyword pass", () => {
    const agents = [agent("x-planner", "Task planner")];
    assert.strictEqual(suggestAgentForRole("planner", agents), "x-planner");
  });

  it("an architecture planner beats an earlier x-planner without architecture", () => {
    const agents = [
      agent("x-planner", "Task planner"),
      agent("proj-arch-planner", "Architecture-aware planner"),
    ];
    assert.strictEqual(suggestAgentForRole("planner", agents), "proj-arch-planner");
  });

  it("never suggests linter, other-docs-writer, or archive", () => {
    // Pin: these roles can never be auto-suggested, regardless of the agents.
    const agents = [
      agent("linter-bot", "Linter and archive helper with all the docs"),
      agent("docs-writer", "Writes other docs and archives stuff"),
    ];
    assert.strictEqual(suggestAgentForRole("linter", agents), undefined);
    assert.strictEqual(suggestAgentForRole("other-docs-writer", agents), undefined);
    assert.strictEqual(suggestAgentForRole("archive", agents), undefined);
  });

  it("returns the first matching agent in the array", () => {
    const agents = [agent("first-coder", "Coder one"), agent("second-coder", "Coder two")];
    assert.strictEqual(suggestAgentForRole("implementer", agents), "first-coder");
  });

  it("buildSuggestionMap omits unmatched roles", () => {
    const agents = [agent("gas-coder", "Coder")];
    const map = buildSuggestionMap(agents);
    assert.strictEqual(map.implementer, "gas-coder");
    assert.strictEqual(map.linter, undefined);
    assert.ok(!("linter" in map));
    assert.ok(!("archive" in map));
  });
});


describe("ROLE_GUIDANCE", () => {
  it("covers every document role", () => {
    for (const role of DOCUMENT_ROLES) {
      assert.ok(ROLE_GUIDANCE[role], `missing guidance for ${role}`);
    }
  });

  it("scout-1 is design-defined and scout-3 is optional", () => {
    assert.strictEqual(ROLE_GUIDANCE["scout-1"], "design-defined");
    assert.strictEqual(ROLE_GUIDANCE["scout-3"], "optional");
  });
});


describe("ROLE_GUIDANCE data integrity", () => {
  it("contains only valid guidance values", () => {
    const valid = new Set(["design-defined", "recommended", "optional"]);
    for (const [role, guidance] of Object.entries(ROLE_GUIDANCE)) {
      assert.ok(valid.has(guidance), `invalid guidance "${guidance}" for ${role}`);
    }
  });

  it("has no entries outside DOCUMENT_ROLES", () => {
    for (const role of Object.keys(ROLE_GUIDANCE)) {
      assert.ok(
        (DOCUMENT_ROLES as readonly string[]).includes(role),
        `dead guidance entry for ${role} (not a document role)`,
      );
    }
  });
});


describe("PICKER_ROLES", () => {
  it("is DOCUMENT_ROLES minus the four sequence roles", () => {
    assert.deepStrictEqual(
      PICKER_ROLES,
      DOCUMENT_ROLES.filter((r) => !SEQUENCE_ROLES.includes(r)),
    );
    assert.strictEqual(PICKER_ROLES.length, DOCUMENT_ROLES.length - 4);
  });

  it("contains no sequence roles and keeps every scout and reviewer", () => {
    for (const role of SEQUENCE_ROLES) {
      assert.ok(!PICKER_ROLES.includes(role), `${role} must be hidden`);
    }
    const visible = [
      "scout-1",
      "scout-2",
      "scout-3",
      "scout-4",
      "reviewer-correctness",
      "reviewer-security",
      "reviewer-tests",
    ] as const;
    for (const role of visible) {
      assert.ok(PICKER_ROLES.includes(role), `${role} must stay visible`);
    }
  });
});

describe("coverage audit gaps", () => {
  function agent(name: string, description = ""): DiscoveredAgent {
    return { name, description, source: "project" };
  }

  it("suggests scout-4 via the spec keyword in the description", () => {
    const agents = [agent("gas-spec-checker", "Spec compliance scout")];
    assert.strictEqual(suggestAgentForRole("scout-4", agents), "gas-spec-checker");
  });

  it("reviewer-security falls through to the keyword pass instead of the architecture reviewer preference", () => {
    const agents = [
      agent("gas-security-reviewer", "Security reviewer"),
      agent("proj-arch-reviewer-correctness", "reviews correctness against architecture rules"),
    ];
    // reviewer-correctness gets the preference: the generated architecture
    // reviewer wins even though a matching agent appears earlier in the list.
    assert.strictEqual(suggestAgentForRole("reviewer-correctness", agents), "proj-arch-reviewer-correctness");
    // reviewer-security is not in the preference branch, so the keyword pass
    // returns the first keyword match instead.
    assert.strictEqual(suggestAgentForRole("reviewer-security", agents), "gas-security-reviewer");
  });
});
