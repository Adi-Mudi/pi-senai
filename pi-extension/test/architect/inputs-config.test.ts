import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createDefaultArchitectInputsConfig,
  createInputsConfigFromCodebase,
  getArchitectInputsConfigPath,
  getSelectedInputPaths,
  isArchitectDocumentType,
  loadArchitectInputsConfig,
  saveArchitectInputsConfig,
  validateArchitectInputsConfig,
  ARCHITECT_INPUTS_CONFIG_COMMENT,
} from "../../src/architect/inputs-config.js";
import type { ArchitectInputsConfig } from "../../src/architect/inputs-config.js";

function makeConfig(overrides?: Partial<ArchitectInputsConfig>): ArchitectInputsConfig {
  return {
    version: 1,
    documents: [],
    additionalConstraints: [],
    ...overrides,
  };
}

describe("architect-inputs-config", () => {
  it("getArchitectInputsConfigPath returns correct path", () => {
    assert.strictEqual(
      getArchitectInputsConfigPath("/fake"),
      path.join("/fake", ".pi/senai/architect-inputs.json"),
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

  it("createDefaultArchitectInputsConfig returns empty config", () => {
    const config = createDefaultArchitectInputsConfig();
    assert.strictEqual(config.version, 1);
    assert.deepStrictEqual(config.documents, []);
    assert.deepStrictEqual(config.additionalConstraints, []);
  });

  it("validateArchitectInputsConfig rejects wrong version", () => {
    const config = { version: 2, documents: [], additionalConstraints: [] } as unknown as ArchitectInputsConfig;
    assert.throws(() => validateArchitectInputsConfig(config), /version: 2/);
  });

  it("validateArchitectInputsConfig rejects non-array documents", () => {
    const config = { version: 1, documents: "docs/PRD.md", additionalConstraints: [] } as unknown as ArchitectInputsConfig;
    assert.throws(() => validateArchitectInputsConfig(config), /documents/);
  });

  it("validateArchitectInputsConfig rejects a null document entry", () => {
    const config = { version: 1, documents: [null], additionalConstraints: [] } as unknown as ArchitectInputsConfig;
    assert.throws(() => validateArchitectInputsConfig(config), /object/);
  });

  it("validateArchitectInputsConfig rejects an empty document path", () => {
    const config = { version: 1, documents: [{ type: "prd", path: "" }], additionalConstraints: [] } as unknown as ArchitectInputsConfig;
    assert.throws(() => validateArchitectInputsConfig(config), /path/);
  });

  it("validateArchitectInputsConfig rejects invalid additionalConstraints", () => {
    const notArray = { version: 1, documents: [], additionalConstraints: "keep it simple" } as unknown as ArchitectInputsConfig;
    assert.throws(() => validateArchitectInputsConfig(notArray), /additionalConstraints/);
    const nonString = { version: 1, documents: [], additionalConstraints: [42] } as unknown as ArchitectInputsConfig;
    assert.throws(() => validateArchitectInputsConfig(nonString), /strings/);
  });

  it("loadArchitectInputsConfig throws on invalid JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-inputs-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "architect-inputs.json"), "{ not json", "utf8");
    assert.throws(() => loadArchitectInputsConfig(tmpDir), /Invalid architect inputs config/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save and load roundtrip preserves documents and constraints", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-inputs-"));
    const config: ArchitectInputsConfig = {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: ["Keep it simple"],
    };
    saveArchitectInputsConfig(tmpDir, config);
    assert.deepStrictEqual(loadArchitectInputsConfig(tmpDir), config);
    assert.strictEqual(isArchitectDocumentType("PRD"), false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateArchitectInputsConfig rejects a non-string document path", () => {
    const config = {
      version: 1,
      documents: [{ type: "prd", path: 42 }],
      additionalConstraints: [],
    } as unknown as ArchitectInputsConfig;
    assert.throws(() => validateArchitectInputsConfig(config), /non-empty 'path'/);
  });

  it("validateArchitectInputsConfig rejects a non-string entry inside additionalConstraints", () => {
    const config = {
      version: 1,
      documents: [],
      additionalConstraints: ["ok", 7],
    } as unknown as ArchitectInputsConfig;
    assert.throws(() => validateArchitectInputsConfig(config), /must contain only strings/);
  });

  it("loadArchitectInputsConfig throws a wrapped error for JSON array content", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-inputs-array-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "architect-inputs.json"), "[1, 2]", "utf8");
    assert.throws(() => loadArchitectInputsConfig(tmpDir), /Invalid architect inputs config/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("coverage audit gaps", () => {
  it("validateArchitectInputsConfig rejects a non-null primitive document entry", () => {
    const config = {
      version: 1,
      documents: ["doc.md"],
      additionalConstraints: [],
    } as unknown as ArchitectInputsConfig;
    assert.throws(() => validateArchitectInputsConfig(config), /Each document entry must be an object/);
  });
});

describe("config _comment instructions", () => {
  it("saveArchitectInputsConfig writes a _comment instruction as the first key", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-inputs-cfg-"));
    saveArchitectInputsConfig(tmpDir, makeConfig());
    const parsed = JSON.parse(fs.readFileSync(getArchitectInputsConfigPath(tmpDir), "utf8"));
    assert.strictEqual(Object.keys(parsed)[0], "_comment");
    assert.strictEqual(parsed._comment, ARCHITECT_INPUTS_CONFIG_COMMENT);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectInputsConfig strips _comment so the round-trip shape is unchanged", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-inputs-cfg-"));
    const config = makeConfig({
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: ["keep it simple"],
    });
    saveArchitectInputsConfig(tmpDir, config);
    const loaded = loadArchitectInputsConfig(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(loaded, "_comment"), false);
    assert.deepStrictEqual(loaded, config);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("createInputsConfigFromCodebase", () => {
  it("returns empty config when project has no recognized files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-empty-"));
    const result = createInputsConfigFromCodebase(tmpDir);
    assert.strictEqual(result.discovered.packageJson, false);
    assert.strictEqual(result.discovered.readme, false);
    assert.deepStrictEqual(result.discovered.agents, []);
    assert.deepStrictEqual(result.discovered.skills, []);
    assert.deepStrictEqual(result.discovered.extensions, []);
    assert.strictEqual(result.config.documents.length, 0);
    assert.strictEqual(result.config.additionalConstraints.length, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures package.json description, keywords, and Pi peer deps", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-pkg-"));
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "@scope/test",
        version: "1.0.0",
        description: "A test extension",
        keywords: ["pi-package", "extension"],
        peerDependencies: {
          "@mariozechner/pi-coding-agent": "*",
          "@sinclair/typebox": "*",
        },
      }),
    );
    const result = createInputsConfigFromCodebase(tmpDir);
    assert.strictEqual(result.discovered.packageJson, true);
    assert.ok(
      result.config.additionalConstraints.some((c) => c.includes("A test extension")),
      "missing description constraint",
    );
    assert.ok(
      result.config.additionalConstraints.some((c) => c.includes("pi-package")),
      "missing keyword constraint",
    );
    assert.ok(
      result.config.additionalConstraints.some((c) => c.includes("@mariozechner/pi-coding-agent")),
      "missing Pi peer dep constraint",
    );
    assert.strictEqual(
      result.config.additionalConstraints.some((c) => c.includes("@sinclair/typebox")),
      false,
      "non-Pi peer dep should be excluded",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures README first heading", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-readme-"));
    fs.writeFileSync(
      path.join(tmpDir, "README.md"),
      "# My Awesome Extension\n\nSome description here.\n",
    );
    const result = createInputsConfigFromCodebase(tmpDir);
    assert.strictEqual(result.discovered.readme, true);
    assert.ok(
      result.config.additionalConstraints.some((c) => c.includes("My Awesome Extension")),
      "missing README heading constraint",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures agents, skills, and extensions as documents", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-files-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "agents"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".pi", "skills", "my-skill"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".pi", "extensions"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "agents", "planner.md"), "---\nname: planner\ndescription: test\n---\n");
    fs.writeFileSync(path.join(tmpDir, ".pi", "skills", "my-skill", "SKILL.md"), "# My Skill\n");
    fs.writeFileSync(path.join(tmpDir, ".pi", "extensions", "index.ts"), "export default function () {}");
    const result = createInputsConfigFromCodebase(tmpDir);
    assert.deepStrictEqual(result.discovered.agents, [path.join(".pi", "agents", "planner.md")]);
    assert.deepStrictEqual(result.discovered.skills, [path.join(".pi", "skills", "my-skill", "SKILL.md")]);
    assert.deepStrictEqual(result.discovered.extensions, [path.join(".pi", "extensions", "index.ts")]);
    assert.strictEqual(result.config.documents.length, 3);
    for (const doc of result.config.documents) {
      assert.strictEqual(doc.type, "code");
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
