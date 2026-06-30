import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getFilesConfigPath,
  loadFilesConfig,
  saveFilesConfig,
  validateFilesConfig,
} from "../src/files-config.js";
import type { FilesConfig } from "../src/files-config.js";

describe("files-config", () => {
  it("getFilesConfigPath returns correct path", () => {
    assert.strictEqual(getFilesConfigPath("/fake"), path.join("/fake", ".pi/orchestra/files.json"));
  });

  it("loadFilesConfig returns null when missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    assert.strictEqual(loadFilesConfig(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadFilesConfig reads valid config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    const config: FilesConfig = { version: 1, files: ["README.md", "Doc/"] };
    saveFilesConfig(tmpDir, config);
    const loaded = loadFilesConfig(tmpDir);
    assert.deepStrictEqual(loaded, config);
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
    assert.doesNotThrow(() => validateFilesConfig({ version: 1, files: [] }));
    assert.doesNotThrow(() =>
      validateFilesConfig({ version: 1, files: ["README.md", "Doc/"] }),
    );
  });

  it("validateFilesConfig rejects missing version", () => {
    assert.throws(() => validateFilesConfig({ files: [] } as any), /version/);
  });

  it("validateFilesConfig rejects invalid files field", () => {
    assert.throws(() => validateFilesConfig({ version: 1, files: "x" } as any), /files/);
  });

  it("validateFilesConfig rejects non-string entries", () => {
    assert.throws(() => validateFilesConfig({ version: 1, files: [1] } as any), /strings/);
  });

  it("saveFilesConfig creates directories if needed", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-cfg-"));
    saveFilesConfig(tmpDir, { version: 1, files: ["x"] });
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "orchestra", "files.json")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
