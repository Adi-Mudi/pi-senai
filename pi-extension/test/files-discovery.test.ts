import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverProjectFiles } from "../src/files-discovery.js";

describe("files-discovery", () => {
  it("discovers standard code and document folders", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "main.ts"), "export {}", "utf8");
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");

    const result = discoverProjectFiles(tmpDir, [".git/", "node_modules/"]);
    assert.ok(result.codeFolders.some((f) => f.path === "src/"));
    assert.ok(result.documentFiles.includes("docs/PRD.md"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects custom-named code folders by content", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "modules"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "modules", "a.ts"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "modules", "b.ts"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.codeFolders.some((f) => f.path === "modules/"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects custom-named document folders by content", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "planning"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "planning", "PRD.md"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "planning", "notes.md"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.documentFolders.some((f) => f.path === "planning/"));
    assert.ok(result.documentFiles.includes("planning/PRD.md"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects project root marker folders", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "backend"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "backend", "package.json"), "{}", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.codeFolders.some((f) => f.path === "backend/"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips excluded paths", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "dist", "bundle.js"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, ["dist/"]);
    assert.strictEqual(result.codeFiles.length, 0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ignores dot folders except .github", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, ".hidden"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".hidden", "secret.ts"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.strictEqual(result.codeFiles.length, 0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
