import { describe, it } from "node:test";
import assert from "node:assert";
import { buildAgentRegistryBlock } from "../../src/agent-registry.js";
import { SENAI_ROLES, DEFAULT_AGENTS } from "../../src/agent-suggestions.js";
import type { AgentConfig } from "../../src/agent-config.js";

describe("agent-registry", () => {
  it("includes all senai roles", () => {
    const block = buildAgentRegistryBlock(null);
    assert.ok(block.includes("## Agent Registry"));
    assert.ok(block.includes("scout-1"));
    assert.ok(block.includes("scout-2"));
    assert.ok(block.includes("scout-3"));
    assert.ok(block.includes("scout-4"));
    assert.ok(block.includes("discussion"));
    assert.ok(block.includes("planner"));
    assert.ok(block.includes("implementer"));
    assert.ok(block.includes("security-gate"));
    assert.ok(block.includes("archive"));
  });

  it("uses default agents when config is null", () => {
    const block = buildAgentRegistryBlock(null);
    assert.ok(block.includes("Scout 1 — Architecture / big-picture (scout-1) (default) → scout"));
    assert.ok(block.includes("Implementer (implementer) (default) → worker"));
  });

  it("uses custom agents from config", () => {
    const config: AgentConfig = {
      version: 1,
      agents: {
        "scout-1": "custom-scout",
        implementer: "gas-coder",
      },
    };
    const block = buildAgentRegistryBlock(config);
    assert.ok(block.includes("Scout 1 — Architecture / big-picture (scout-1) → custom-scout"));
    assert.ok(block.includes("Implementer (implementer) → gas-coder"));
    assert.ok(block.includes("Scout 2 — Coder Search (scout-2) (default) → scout"));
  });

  it("includes fallback instruction", () => {
    const block = buildAgentRegistryBlock(null);
    assert.ok(block.includes("If a role is not listed above, use the default agent name."));
  });

  it("lists one line per senai role", () => {
    const block = buildAgentRegistryBlock(null);
    const roleLines = block.split("\n").filter((line) => line.startsWith("- "));
    assert.strictEqual(roleLines.length, SENAI_ROLES.length);
  });

  it("falls back to the default agent when a role is mapped to an empty string", () => {
    const config: AgentConfig = { version: 1, agents: { planner: "" } };
    const block = buildAgentRegistryBlock(config);
    const line = block.split("\n").find((l) => l.startsWith("- Planner (planner)"));
    assert.strictEqual(line, `- Planner (planner) (default) → ${DEFAULT_AGENTS.planner}`);
  });

  it("includes the model inheritance rule", () => {
    const block = buildAgentRegistryBlock(null);
    assert.ok(block.includes("NEVER pass the `model` parameter to `subagent()`"));
    assert.ok(block.includes("inherit pi's configured default model"));
  });

  it("model rule appears for custom configs too", () => {
    const config: AgentConfig = { version: 1, agents: { planner: "gas-planner" } };
    const block = buildAgentRegistryBlock(config);
    assert.ok(block.includes("NEVER pass the `model` parameter to `subagent()`"));
  });

  it("includes the spawn rules", () => {
    const block = buildAgentRegistryBlock(null);
    assert.ok(block.includes("ALWAYS pass the `agent` parameter"));
    assert.ok(block.includes("do NOT poll"));
    assert.ok(block.includes("verify its artifact file exists"));
    assert.ok(block.includes("`subagent_interrupt`"));
    assert.ok(block.includes("Never leave two agents of the same role running"));
    assert.ok(block.includes("NEVER do a subagent's job yourself"));
  });

  it("spawn rules appear for custom configs too", () => {
    const config: AgentConfig = { version: 1, agents: { planner: "gas-planner" } };
    const block = buildAgentRegistryBlock(config);
    assert.ok(block.includes("ALWAYS pass the `agent` parameter"));
  });

  it("shows no default markers when every role is custom-mapped", () => {
    const config: AgentConfig = {
      version: 1,
      agents: Object.fromEntries(SENAI_ROLES.map((r) => [r, `custom-${r}`])),
    };
    const block = buildAgentRegistryBlock(config);
    assert.ok(!block.includes("(default)"));
    assert.ok(block.includes("Spawn rules"));
  });

  it("model rule and spawn rules each appear exactly once", () => {
    const block = buildAgentRegistryBlock(null);
    assert.strictEqual(block.split("Model rule").length - 1, 1);
    assert.strictEqual(block.split("Spawn rules").length - 1, 1);
  });
});
