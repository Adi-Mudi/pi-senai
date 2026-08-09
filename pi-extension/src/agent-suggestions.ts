import type { DiscoveredAgent } from "./agent-discovery.js";

export const SENAI_ROLES = [
  "scout-1",
  "scout-2",
  "scout-3",
  "scout-4",
  "discussion",
  "planner",
  "plan-overview",
  "reviewer-correctness",
  "reviewer-security",
  "reviewer-tests",
  "test-skeleton",
  "implementer",
  "linter",
  "code-review",
  "full-test",
  "readme-writer",
  "changelog-writer",
  "api-docs-writer",
  "other-docs-writer",
  "security-gate",
  "archive",
] as const;

export type SenaiRole = (typeof SENAI_ROLES)[number];

/** Roles whose job is reading project documents. Only these appear in the
 *  agents-files picker and in doctor's assignment suggestions. The remaining
 *  roles consume stage artifacts (plan, scout reports, code) and normally
 *  need no document assignments. The config format still accepts every role
 *  for advanced hand-editing. */
export const DOCUMENT_ROLES: SenaiRole[] = [
  "scout-1",
  "scout-2",
  "scout-3",
  "scout-4",
  "discussion",
  "planner",
  "reviewer-correctness",
  "reviewer-security",
  "reviewer-tests",
  "code-review",
  "security-gate",
];

export const DEFAULT_AGENTS: Record<SenaiRole, string> = {
  "scout-1": "scout",
  "scout-2": "scout",
  "scout-3": "scout",
  "scout-4": "scout",
  discussion: "planner",
  planner: "planner",
  "plan-overview": "planner",
  "reviewer-correctness": "reviewer",
  "reviewer-security": "reviewer",
  "reviewer-tests": "reviewer",
  "test-skeleton": "worker",
  implementer: "worker",
  linter: "worker",
  "code-review": "reviewer",
  "full-test": "worker",
  "readme-writer": "worker",
  "changelog-writer": "worker",
  "api-docs-writer": "worker",
  "other-docs-writer": "worker",
  "security-gate": "security-auditor",
  archive: "worker",
};

export const ROLE_LABELS: Record<SenaiRole, string> = {
  "scout-1": "Scout 1 — Architecture / big-picture",
  "scout-2": "Scout 2 — Coder Search",
  "scout-3": "Scout 3 — Code Risk / dependency audit",
  "scout-4": "Scout 4 — PRD / documentation audit",
  discussion: "Discussion",
  planner: "Planner",
  "plan-overview": "Plan overview",
  "reviewer-correctness": "Reviewer — Correctness",
  "reviewer-security": "Reviewer — Security",
  "reviewer-tests": "Reviewer — Tests",
  "test-skeleton": "Test skeleton",
  implementer: "Implementer",
  linter: "Linter",
  "code-review": "Code review",
  "full-test": "Full test",
  "readme-writer": "README writer",
  "changelog-writer": "Changelog writer",
  "api-docs-writer": "API docs writer",
  "other-docs-writer": "Other docs writer",
  "security-gate": "Security gate",
  archive: "Archive",
};

/** Guidance tag shown per role in the agents-files picker (user-approved
 *  wording and colors): scout-1 is fixed by the architecture factory,
 *  scout-3 is optional, everything else should be configured. */
export type RoleGuidance = "design-defined" | "recommended" | "optional";

export const ROLE_GUIDANCE: Partial<Record<SenaiRole, RoleGuidance>> = {
  "scout-1": "design-defined",
  "scout-2": "recommended",
  "scout-3": "optional",
  "scout-4": "recommended",
  discussion: "recommended",
  planner: "recommended",
  "reviewer-correctness": "recommended",
  "reviewer-security": "recommended",
  "reviewer-tests": "recommended",
  "code-review": "recommended",
  "security-gate": "recommended",
};

/** Sequence-orchestrated roles hidden from the agents-files picker (user
 *  decision): their primary input is stage artifacts and Senai runs them
 *  automatically. They stay in DOCUMENT_ROLES — assignments remain valid in
 *  JSON and doctor keeps suggesting documents for them. */
export const SEQUENCE_ROLES: SenaiRole[] = [
  "discussion",
  "planner",
  "code-review",
  "security-gate",
];

/** Roles actually shown in the agents-files picker: document roles minus the
 *  hidden sequence roles. */
export const PICKER_ROLES: SenaiRole[] = DOCUMENT_ROLES.filter(
  (role) => !SEQUENCE_ROLES.includes(role),
);

export function suggestAgentForRole(
  role: SenaiRole,
  agents: DiscoveredAgent[],
): string | undefined {
  // First pass: prefer project-specific generated architecture agents.
  for (const agent of agents) {
    const agentText = (agent.name + " " + agent.description).toLowerCase();
    if (
      (role === "planner" || role === "plan-overview" || role === "scout-1") &&
      agent.name.endsWith("-planner") &&
      agentText.includes("architecture")
    ) {
      return agent.name;
    }
    if (
      (role === "reviewer-correctness" || role === "code-review") &&
      agent.name.endsWith("-reviewer-correctness") &&
      agentText.includes("architecture")
    ) {
      return agent.name;
    }
  }

  for (const agent of agents) {
    const agentText = (agent.name + " " + agent.description).toLowerCase();

    if (role === "discussion" && agentText.includes("discussion")) return agent.name;

    if (role === "planner" && agentText.includes("planner")) return agent.name;
    if (role === "plan-overview" && agentText.includes("planner")) return agent.name;

    if (
      (role === "scout-1" || role === "scout-2") &&
      agentText.includes("scout") &&
      (agentText.includes("architecture") || agentText.includes("big") || agentText.includes("overview"))
    ) {
      return agent.name;
    }

    if (
      role === "scout-3" &&
      agentText.includes("scout") &&
      (agentText.includes("risk") || agentText.includes("dependency"))
    ) {
      return agent.name;
    }

    if (
      role === "scout-4" &&
      agentText.includes("scout") &&
      (agentText.includes("requirement") || agentText.includes("doc") || agentText.includes("spec"))
    ) {
      return agent.name;
    }

    if (
      (role === "reviewer-correctness" || role === "reviewer-security") &&
      agentText.includes("reviewer") &&
      (agentText.includes("correctness") || agentText.includes("code") || agentText.includes("security"))
    ) {
      return agent.name;
    }

    if (role === "reviewer-tests" && (agentText.includes("tester") || agentText.includes("test"))) {
      return agent.name;
    }

    if (
      (role === "test-skeleton" || role === "full-test") &&
      (agentText.includes("tester") || agentText.includes("test"))
    ) {
      return agent.name;
    }

    if (
      role === "implementer" &&
      (agentText.includes("coder") || agentText.includes("implement") || agentText.includes("worker"))
    ) {
      return agent.name;
    }

    if (role === "readme-writer" && agentText.includes("readme")) return agent.name;
    if (role === "changelog-writer" && agentText.includes("changelog")) return agent.name;
    if (role === "api-docs-writer" && agentText.includes("api") && agentText.includes("doc")) {
      return agent.name;
    }

    if (role === "security-gate" && agentText.includes("security") && agentText.includes("audit")) {
      return agent.name;
    }
  }
  return undefined;
}

export function buildSuggestionMap(
  agents: DiscoveredAgent[],
): Partial<Record<SenaiRole, string>> {
  const map: Partial<Record<SenaiRole, string>> = {};
  for (const role of SENAI_ROLES) {
    const suggestion = suggestAgentForRole(role, agents);
    if (suggestion) map[role] = suggestion;
  }
  return map;
}
