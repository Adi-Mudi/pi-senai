import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createDefaultArchitectInputsConfig,
  getArchitectInputsConfigPath,
  getSelectedInputPaths,
  isArchitectDocumentType,
  isArchitectSkillLevel,
  loadArchitectInputsConfig,
  saveArchitectInputsConfig,
  validateArchitectInputsConfig,
} from "../src/architect-inputs-config.js";
import type { ArchitectInputsConfig } from "../src/architect-inputs-config.js";

function makeConfig(overrides?: Partial<ArchitectInputsConfig>): ArchitectInputsConfig {
  return {
    version: 1,
    documents: [],
    freeFormRequirements: [],
    skillLevel: "intermediate",
    ...overrides,
  };
}

describe("architect-inputs-config", () => {
  it("getArchitectInputsConfigPath returns correct path", () => {
    assert.strictEqual(
      getArchitectInputsConfigPath("/fake"),
      path.join("/fake", ".pi/orchestra/architect-inputs.json"),
    );
  });

  it("loadArchitectInputsConfig returns null when missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-inputs-"));
    assert.strictEqual(loadArchitectInputsConfig(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectInputsConfig reads valid config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-inputs-"));
    const config = makeConfig({
      documents: [
        { type: "prd", path: "docs/PRD.md" },
        { type: "nfr", path: "docs/NFR.md" },
      ],
      skillLevel: "beginner",
    });
    saveArchitectInputsConfig(tmpDir, config);
    const loaded = loadArchitectInputsConfig(tmpDir);
    assert.deepStrictEqual(loaded, config);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateArchitectInputsConfig rejects unknown document type", () => {
    assert.throws(
      () =>
        validateArchitectInputsConfig(
          makeConfig({ documents: [{ type: "unknown" as any, path: "x.md" }] }),
        ),
      /Unknown document type/,
    );
  });

  it("validateArchitectInputsConfig rejects invalid skill level", () => {
    assert.throws(
      () => validateArchitectInputsConfig(makeConfig({ skillLevel: "expert" as any })),
      /Invalid skillLevel/,
    );
  });

  it("getSelectedInputPaths returns only configured paths", () => {
    const config = makeConfig({
      documents: [
        { type: "prd", path: "docs/PRD.md" },
        { type: "readme", path: "README.md" },
      ],
    });
    assert.deepStrictEqual(getSelectedInputPaths(config), ["docs/PRD.md", "README.md"]);
  });

  it("isArchitectDocumentType validates known types", () => {
    assert.strictEqual(isArchitectDocumentType("prd"), true);
    assert.strictEqual(isArchitectDocumentType("invalid"), false);
  });

  it("isArchitectSkillLevel validates known levels", () => {
    assert.strictEqual(isArchitectSkillLevel("beginner"), true);
    assert.strictEqual(isArchitectSkillLevel("expert"), false);
  });

  it("createDefaultArchitectInputsConfig returns empty config", () => {
    const config = createDefaultArchitectInputsConfig();
    assert.strictEqual(config.version, 1);
    assert.deepStrictEqual(config.documents, []);
    assert.strictEqual(config.skillLevel, "intermediate");
  });
});
