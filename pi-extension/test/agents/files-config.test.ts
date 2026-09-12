import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getFilesConfigPath,
  loadFilesConfig,
  migrateFilesConfig,
  saveFilesConfig,
  validateFilesConfig,
  FILES_CONFIG_COMMENT,
} from "../../src/core/agents-config/files-config.js";
import type { FilesConfig, FilesConfigV1 } from "../../src/core/agents-config/files-config.js";

function makeV2Config(overrides?: Partial<FilesConfig>): FilesConfig {
  return {
    version: 2,
    codePaths: [],
    inputDocuments: [],
    testPaths: [],
    excludedPaths: [],
    ...overrides,
  };
}

describe("files-config", () => {
  it("getFilesConfigPath returns correct path", () => {
    assert.strictEqual(getFilesConfigPath("/fake"), path.join("/fake", ".pi/senai/files.json"));
  });

  it("loadFilesConfig returns null when missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    assert.strictEqual(loadFilesConfig(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadFilesConfig reads valid v2 config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    const config: FilesConfig = makeV2Config({
      codePaths: ["src/"],
      inputDocuments: ["docs/PRD.md"],
      testPaths: ["tests/"],
    });
    saveFilesConfig(tmpDir, config);
    const loaded = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(loaded, config);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadFilesConfig migrates v1 config automatically", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "senai", "files.json"),
      JSON.stringify({ version: 1, files: ["src/"] }),
      "utf8",
    );
    const loaded = loadFilesConfig(tmpDir);
    assert.strictEqual(loaded?.version, 2);
    assert.deepStrictEqual(loaded?.codePaths, ["src/"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadFilesConfig throws on invalid JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "files.json"), "not json", "utf8");
    assert.throws(() => loadFilesConfig(tmpDir), /Invalid files config/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateFilesConfig accepts valid config", () => {
    assert.doesNotThrow(() => validateFilesConfig(makeV2Config()));
    assert.doesNotThrow(() =>
      validateFilesConfig(
        makeV2Config({ codePaths: ["src/"], inputDocuments: ["README.md"] }),
      ),
    );
  });

  it("validateFilesConfig rejects unsupported version", () => {
    assert.throws(
      () => validateFilesConfig({ version: 3, files: [] } as any),
      /Unsupported files\.json version: 3\. Expected version: 2/,
    );
  });

  it("validateFilesConfig rejects invalid codePaths", () => {
    assert.throws(() => validateFilesConfig(makeV2Config({ codePaths: "x" } as any)), /codePaths/);
  });

  it("validateFilesConfig rejects non-string entries", () => {
    assert.throws(
      () => validateFilesConfig(makeV2Config({ inputDocuments: [1] } as any)),
      /strings/,
    );
  });

  it("saveFilesConfig creates directories if needed", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    saveFilesConfig(tmpDir, makeV2Config({ codePaths: ["x"] }));
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "senai", "files.json")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrateFilesConfig categorizes v1 paths", () => {
    const v1: FilesConfigV1 = { version: 1, files: ["src/", "docs/PRD.md", "tests/", "README.md"] };
    const v2 = migrateFilesConfig(v1);
    assert.strictEqual(v2.version, 2);
    assert.deepStrictEqual(v2.codePaths, ["src/"]);
    assert.deepStrictEqual(v2.testPaths, ["tests/"]);
    assert.ok(v2.inputDocuments.includes("docs/PRD.md"));
    assert.ok(v2.inputDocuments.includes("README.md"));
    assert.ok(v2.excludedPaths.length > 0);
  });

  // Edge cases
  it("migrateFilesConfig handles empty v1 files array", () => {
    const v1: FilesConfigV1 = { version: 1, files: [] };
    const v2 = migrateFilesConfig(v1);
    assert.strictEqual(v2.version, 2);
    assert.deepStrictEqual(v2.codePaths, []);
    assert.deepStrictEqual(v2.inputDocuments, []);
    assert.deepStrictEqual(v2.testPaths, []);
  });

  it("migrateFilesConfig categorizes test files, not just folders", () => {
    const v1: FilesConfigV1 = { version: 1, files: ["src/main.test.ts", "plan.md"] };
    const v2 = migrateFilesConfig(v1);
    assert.deepStrictEqual(v2.testPaths, ["src/main.test.ts"]);
    assert.ok(v2.inputDocuments.includes("plan.md"));
  });

  it("validateFilesConfig rejects missing category arrays", () => {
    assert.throws(
      () => validateFilesConfig({ version: 2 } as any),
      /codePaths/,
    );
  });

  it("loadFilesConfig throws on unsupported version 3", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "senai", "files.json"),
      JSON.stringify({ version: 3, codePaths: [], inputDocuments: [], testPaths: [], excludedPaths: [] }),
      "utf8",
    );
    assert.throws(() => loadFilesConfig(tmpDir), /Unsupported files\.json version: 3/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrateFilesConfig puts spec folders into testPaths", () => {
    const v1: FilesConfigV1 = { version: 1, files: ["spec/", "src/"] };
    const v2 = migrateFilesConfig(v1);
    assert.deepStrictEqual(v2.testPaths, ["spec/"]);
    assert.deepStrictEqual(v2.codePaths, ["src/"]);
  });

  it("validateFilesConfig rejects non-string entries in excludedPaths", () => {
    assert.throws(
      () => validateFilesConfig(makeV2Config({ excludedPaths: [42] } as any)),
      /strings/,
    );
  });

  it("validateFilesConfig rejects non-array testPaths", () => {
    assert.throws(
      () => validateFilesConfig(makeV2Config({ testPaths: "x" } as any)),
      /testPaths/,
    );
  });

  it("loadFilesConfig throws wrapped error for non-object JSON content", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    const configPath = path.join(tmpDir, ".pi", "senai", "files.json");

    fs.writeFileSync(configPath, "42", "utf8");
    assert.throws(() => loadFilesConfig(tmpDir), /Invalid files config/);

    fs.writeFileSync(configPath, "null", "utf8");
    assert.throws(() => loadFilesConfig(tmpDir), /Invalid files config/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadFilesConfig wraps the error when files.json path is a directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai", "files.json"), { recursive: true });
    // EISDIR is not ENOENT, so the raw error must be wrapped, not returned as null.
    assert.throws(() => loadFilesConfig(tmpDir), /Invalid files config/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrateFilesConfig routes uppercase DOCS/ files into inputDocuments", () => {
    const v1: FilesConfigV1 = { version: 1, files: ["DOCS/PRD.md"] };
    const v2 = migrateFilesConfig(v1);
    assert.deepStrictEqual(v2.inputDocuments, ["DOCS/PRD.md"]);
    assert.deepStrictEqual(v2.codePaths, []);
    assert.deepStrictEqual(v2.testPaths, []);
  });

  it("migrateFilesConfig does not treat latest/ as a test folder", () => {
    const v1: FilesConfigV1 = { version: 1, files: ["latest/"] };
    const v2 = migrateFilesConfig(v1);
    assert.deepStrictEqual(v2.testPaths, []);
    assert.deepStrictEqual(v2.codePaths, ["latest/"]);
  });

  it("migrateFilesConfig routes test files by name into testPaths", () => {
    const v1: FilesConfigV1 = { version: 1, files: ["src/foo.test.ts", "tests/"] };
    const v2 = migrateFilesConfig(v1);
    assert.deepStrictEqual(v2.testPaths, ["tests/", "src/foo.test.ts"].sort());
  });

  it("migrateFilesConfig uses the exact default excludedPaths list", () => {
    const v1: FilesConfigV1 = { version: 1, files: [] };
    const v2 = migrateFilesConfig(v1);
    assert.deepStrictEqual(v2.excludedPaths, [
      ".git/",
      "node_modules/",
      "__pycache__/",
      ".venv/",
      "venv/",
      "dist/",
      "build/",
      "target/",
      ".pi/",
      ".idea/",
      ".vscode/",
    ]);
  });

  it("saveFilesConfig twice with different content: second write wins", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    saveFilesConfig(tmpDir, makeV2Config({ codePaths: ["first/"] }));
    saveFilesConfig(tmpDir, makeV2Config({ codePaths: ["second/"] }));
    const loaded = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(loaded?.codePaths, ["second/"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("roundtrips a unicode path unchanged", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    saveFilesConfig(tmpDir, makeV2Config({ inputDocuments: ["文档/設計.md"] }));
    const loaded = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(loaded?.inputDocuments, ["文档/設計.md"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("coverage audit gaps", () => {
  it("migrateFilesConfig routes singular doc/ files into inputDocuments", () => {
    const v1: FilesConfigV1 = { version: 1, files: ["doc/plan.md"] };
    const v2 = migrateFilesConfig(v1);
    assert.deepStrictEqual(v2.inputDocuments, ["doc/plan.md"]);
    assert.deepStrictEqual(v2.codePaths, []);
    assert.deepStrictEqual(v2.testPaths, []);
  });

  it("loadFilesConfig wraps a malformed v1 config without files as invalid", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "senai", "files.json"),
      JSON.stringify({ version: 1 }),
      "utf8",
    );
    // migrateFilesConfig iterates the missing files array and throws; the raw
    // error must be wrapped as "Invalid files config", not returned as null.
    assert.throws(() => loadFilesConfig(tmpDir), /Invalid files config/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("config _comment instructions", () => {
  it("saveFilesConfig writes a _comment instruction as the first key", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    saveFilesConfig(tmpDir, makeV2Config());
    const parsed = JSON.parse(fs.readFileSync(getFilesConfigPath(tmpDir), "utf8"));
    assert.strictEqual(Object.keys(parsed)[0], "_comment");
    assert.strictEqual(parsed._comment, FILES_CONFIG_COMMENT);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadFilesConfig strips _comment so the round-trip shape is unchanged", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    const config = makeV2Config({ codePaths: ["src/"], inputDocuments: ["docs/PRD.md"] });
    saveFilesConfig(tmpDir, config);
    const loaded = loadFilesConfig(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(loaded, "_comment"), false);
    assert.deepStrictEqual(loaded, config);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
