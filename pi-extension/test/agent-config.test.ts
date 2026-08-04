import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getConfigPath,
  loadAgentConfig,
  resolveAgentName,
  saveAgentConfig,
  validateAgentConfig,
  validateMappedAgents,
  CONFIG_COMMENT,
} from "../src/agent-config.js";
import type { AgentConfig } from "../src/agent-config.js";
import { DEFAULT_AGENTS } from "../src/agent-suggestions.js";

describe("agent-config", () => {
  it("getConfigPath returns .pi/senai/agents.json under cwd", () => {
    const cwd = "/fake/project";
    assert.strictEqual(getConfigPath(cwd), path.join(cwd, ".pi/senai/agents.json"));
  });

  it("loadAgentConfig returns null when config is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    const config = loadAgentConfig(tmpDir);
    assert.strictEqual(config, null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadAgentConfig reads valid config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    const config: AgentConfig = {
      version: 1,
      agents: { discussion: "senai-discussion", implementer: "gas-coder" },
    };
    saveAgentConfig(tmpDir, config);

    const loaded = loadAgentConfig(tmpDir);
    assert.deepStrictEqual(loaded, config);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadAgentConfig throws on invalid JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "not json", "utf8");

    assert.throws(() => loadAgentConfig(tmpDir), /Invalid agent config/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateAgentConfig rejects unknown roles", () => {
    const config: AgentConfig = {
      version: 1,
      agents: { "unknown-role": "some-agent" } as any,
    };
    assert.throws(() => validateAgentConfig(config), /Unknown role/);
  });

  it("validateAgentConfig rejects missing version", () => {
    const config = { agents: {} } as any;
    assert.throws(() => validateAgentConfig(config), /version/);
  });

  it("resolveAgentName uses custom mapping when available", () => {
    const config: AgentConfig = { version: 1, agents: { implementer: "gas-coder" } };
    assert.strictEqual(resolveAgentName(config, "implementer"), "gas-coder");
  });

  it("resolveAgentName falls back to default", () => {
    assert.strictEqual(resolveAgentName(null, "implementer"), "worker");
    assert.strictEqual(resolveAgentName({ version: 1, agents: {} }, "implementer"), "worker");
  });

  it("validateMappedAgents returns empty when all agents exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "agents", "gas-coder.md"),
      "---\nname: gas-coder\ndescription: Coder\n---\n",
      "utf8",
    );

    const config: AgentConfig = { version: 1, agents: { implementer: "gas-coder" } };
    const errors = validateMappedAgents(tmpDir, config);
    assert.deepStrictEqual(errors, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateMappedAgents reports missing custom agents", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    const config: AgentConfig = { version: 1, agents: { implementer: "missing-agent" } };
    const errors = validateMappedAgents(tmpDir, config);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes("missing-agent"));
    assert.ok(errors[0].includes("implementer"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateMappedAgents allows built-in agents without files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    const config: AgentConfig = { version: 1, agents: { implementer: "worker", planner: "planner" } };
    const errors = validateMappedAgents(tmpDir, config);
    assert.deepStrictEqual(errors, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateAgentConfig throws on missing agents field", () => {
    const config = { version: 1, agents: null } as unknown as AgentConfig;
    assert.throws(() => validateAgentConfig(config), /agents/);
  });

  it("validateAgentConfig throws on non-numeric version", () => {
    const config = { version: "1", agents: {} } as unknown as AgentConfig;
    assert.throws(() => validateAgentConfig(config), /version/);
  });

  it("validateMappedAgents ignores roles mapped to an empty string", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    const config: AgentConfig = { version: 1, agents: { implementer: "" } };
    const errors = validateMappedAgents(tmpDir, config);
    assert.deepStrictEqual(errors, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveAgentConfig and loadAgentConfig roundtrip preserves the mapping", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    const config: AgentConfig = {
      version: 1,
      agents: { planner: "my-planner", implementer: "worker", "scout-1": "my-scout" },
    };
    saveAgentConfig(tmpDir, config);
    const loaded = loadAgentConfig(tmpDir);
    assert.deepStrictEqual(loaded, config);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolveAgentName with null config returns the default for every role", () => {
    assert.strictEqual(resolveAgentName(null, "scout-1"), "scout");
    assert.strictEqual(resolveAgentName(null, "implementer"), "worker");
    assert.strictEqual(resolveAgentName(null, "security-gate"), "security-auditor");
  });

  it("loadAgentConfig wraps the error when the file content is JSON null", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "null", "utf8");

    // Pin: the raw TypeError from validating null is wrapped, not re-thrown as-is.
    assert.throws(() => loadAgentConfig(tmpDir), /Invalid agent config/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadAgentConfig wraps unknown role errors and mentions the role", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "senai", "agents.json"),
      JSON.stringify({ version: 1, agents: { "not-a-role": "some-agent" } }),
      "utf8",
    );

    assert.throws(() => loadAgentConfig(tmpDir), /Invalid agent config/);
    assert.throws(() => loadAgentConfig(tmpDir), /not-a-role/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateAgentConfig rejects a string agents field", () => {
    const config = { version: 1, agents: "x" } as unknown as AgentConfig;
    assert.throws(() => validateAgentConfig(config), /agents/);
  });

  it("validateAgentConfig rejects an array agents field", () => {
    const config = { version: 1, agents: [] } as unknown as AgentConfig;
    assert.throws(() => validateAgentConfig(config), /agents/);
  });

  it("validateAgentConfig rejects a non-string role value", () => {
    const config = { version: 1, agents: { planner: 123 } } as unknown as AgentConfig;
    assert.throws(() => validateAgentConfig(config), /agents\.planner must be a string/);
  });

  it("resolveAgentName falls back to the default when a role maps to an empty string", () => {
    const config: AgentConfig = { version: 1, agents: { planner: "" } };
    assert.strictEqual(resolveAgentName(config, "planner"), DEFAULT_AGENTS.planner);
  });
});

describe("coverage audit gaps", () => {
  it("loadAgentConfig wraps a non-ENOENT read failure as an invalid config error", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    // A directory at the config path makes readFileSync fail with EISDIR,
    // which must be wrapped instead of returning null (the ENOENT branch).
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai", "agents.json"), { recursive: true });

    assert.throws(() => loadAgentConfig(tmpDir), /Invalid agent config/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("config _comment instructions", () => {
  it("saveAgentConfig writes a _comment instruction as the first key", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    const parsed = JSON.parse(fs.readFileSync(getConfigPath(tmpDir), "utf8"));
    assert.strictEqual(Object.keys(parsed)[0], "_comment");
    assert.strictEqual(parsed._comment, CONFIG_COMMENT);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadAgentConfig strips _comment so the round-trip shape is unchanged", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));
    const config: AgentConfig = { version: 1, agents: { planner: "my-planner" } };
    saveAgentConfig(tmpDir, config);
    const loaded = loadAgentConfig(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(loaded, "_comment"), false);
    assert.deepStrictEqual(loaded, config);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
