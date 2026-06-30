import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getAgentsFilesConfigPath,
  loadAgentsFilesConfig,
  saveAgentsFilesConfig,
  validateAgentsFilesConfig,
} from "../src/agents-files-config.js";
import type { AgentsFilesConfig } from "../src/agents-files-config.js";

describe("agents-files-config", () => {
  it("getAgentsFilesConfigPath returns correct path", () => {
    assert.strictEqual(
      getAgentsFilesConfigPath("/fake"),
      path.join("/fake", ".pi/orchestra/agents_files.json"),
    );
  });

  it("loadAgentsFilesConfig returns null when missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-files-cfg-"));
    assert.strictEqual(loadAgentsFilesConfig(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadAgentsFilesConfig reads valid config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-files-cfg-"));
    const config: AgentsFilesConfig = {
      version: 1,
      documents: { planner: { primary: "Doc/planner.md", reads: ["Doc/plan.md"] } },
    };
    saveAgentsFilesConfig(tmpDir, config);
    const loaded = loadAgentsFilesConfig(tmpDir);
    assert.deepStrictEqual(loaded, config);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadAgentsFilesConfig throws on invalid JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-files-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "orchestra"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "orchestra", "agents_files.json"),
      "not json",
      "utf8",
    );
    assert.throws(() => loadAgentsFilesConfig(tmpDir), /Invalid agents_files config/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateAgentsFilesConfig accepts valid config", () => {
    assert.doesNotThrow(() => validateAgentsFilesConfig({ version: 1, documents: {} }));
    assert.doesNotThrow(() =>
      validateAgentsFilesConfig({
        version: 1,
        documents: { planner: { primary: "Doc/planner.md", reads: ["Doc/plan.md"] } },
      }),
    );
  });

  it("validateAgentsFilesConfig rejects missing version", () => {
    assert.throws(() => validateAgentsFilesConfig({ documents: {} } as any), /version/);
  });

  it("validateAgentsFilesConfig rejects missing documents", () => {
    assert.throws(() => validateAgentsFilesConfig({ version: 1 } as any), /documents/);
  });

  it("validateAgentsFilesConfig rejects unknown roles", () => {
    const config = { version: 1, documents: { unknown: { primary: "x.md" } } } as any;
    assert.throws(() => validateAgentsFilesConfig(config), /Unknown role/);
  });

  it("validateAgentsFilesConfig rejects invalid primary", () => {
    const config = { version: 1, documents: { planner: { primary: 123 } } } as any;
    assert.throws(() => validateAgentsFilesConfig(config), /primary/);
  });

  it("validateAgentsFilesConfig rejects invalid reads type", () => {
    const config = { version: 1, documents: { planner: { reads: "x" } } } as any;
    assert.throws(() => validateAgentsFilesConfig(config), /reads/);
  });

  it("validateAgentsFilesConfig rejects non-string reads entries", () => {
    const config = { version: 1, documents: { planner: { reads: [1] } } } as any;
    assert.throws(() => validateAgentsFilesConfig(config), /strings/);
  });

  it("saveAgentsFilesConfig creates directories if needed", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-files-cfg-"));
    saveAgentsFilesConfig(tmpDir, { version: 1, documents: {} });
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "orchestra", "agents_files.json")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
