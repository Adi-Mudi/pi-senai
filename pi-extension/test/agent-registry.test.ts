import { describe, it } from "node:test";
import assert from "node:assert";
import { buildAgentRegistryBlock } from "../src/agent-registry.js";
import type { AgentConfig } from "../src/agent-config.js";

describe("agent-registry", () => {
  it("includes all orchestra roles", () => {
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
    assert.ok(block.includes("scout-1 (default) → scout"));
    assert.ok(block.includes("implementer (default) → worker"));
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
    assert.ok(block.includes("scout-1 → custom-scout"));
    assert.ok(block.includes("implementer → gas-coder"));
    assert.ok(block.includes("scout-2 (default) → scout"));
  });

  it("includes fallback instruction", () => {
    const block = buildAgentRegistryBlock(null);
    assert.ok(block.includes("If a role is not listed above, use the default agent name."));
  });
});
