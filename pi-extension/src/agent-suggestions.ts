import type { DiscoveredAgent } from "./agent-discovery.js";

export const ORCHESTRA_ROLES = [
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

export type OrchestraRole = (typeof ORCHESTRA_ROLES)[number];

export const DEFAULT_AGENTS: Record<OrchestraRole, string> = {
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

export function suggestAgentForRole(
  role: OrchestraRole,
  agents: DiscoveredAgent[],
): string | undefined {
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
): Partial<Record<OrchestraRole, string>> {
  const map: Partial<Record<OrchestraRole, string>> = {};
  for (const role of ORCHESTRA_ROLES) {
    const suggestion = suggestAgentForRole(role, agents);
    if (suggestion) map[role] = suggestion;
  }
  return map;
}
