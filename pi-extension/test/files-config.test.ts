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
} from "../src/files-config.js";
import type { FilesConfig, FilesConfigV1 } from "../src/files-config.js";

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
    assert.strictEqual(getFilesConfigPath("/fake"), path.join("/fake", ".pi/orchestra/files.json"));
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
    fs.mkdirSync(path.join(tmpDir, ".pi", "orchestra"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "orchestra", "files.json"),
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
    fs.mkdirSync(path.join(tmpDir, ".pi", "orchestra"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "orchestra", "files.json"), "not json", "utf8");
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

  it("validateFilesConfig rejects wrong version", () => {
    assert.throws(() => validateFilesConfig({ version: 1, files: [] } as any), /version/);
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
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "orchestra", "files.json")));
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
});
