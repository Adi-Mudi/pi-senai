import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverProjectFiles, formatSuggestion, isExcluded, looksLikeTestPath, safeReadDir } from "../src/files-discovery.js";

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

  // Edge cases
  it("returns empty result for empty project", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    const result = discoverProjectFiles(tmpDir, []);
    assert.deepStrictEqual(result.codeFolders, []);
    assert.deepStrictEqual(result.codeFiles, []);
    assert.deepStrictEqual(result.documentFiles, []);
    assert.deepStrictEqual(result.testFolders, []);
    assert.deepStrictEqual(result.testFiles, []);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty result when all paths are excluded", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "main.ts"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, ["src/"]);
    assert.deepStrictEqual(result.codeFolders, []);
    assert.deepStrictEqual(result.codeFiles, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies mixed folders by majority content", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "mixed"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "mixed", "a.ts"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "mixed", "b.ts"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "mixed", "c.md"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.codeFolders.some((f) => f.path === "mixed/"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers deeply nested documents", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "docs", "nested"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "nested", "note.md"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.documentFiles.includes("docs/nested/note.md"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("safeReadDir returns entries for existing directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "", "utf8");

    const entries = safeReadDir(tmpDir);
    assert.ok(entries.some((e) => e.name === "a.txt"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("safeReadDir returns empty array for missing directory", () => {
    const entries = safeReadDir("/definitely/not/a/real/dir");
    assert.deepStrictEqual(entries, []);
  });

  it("isExcluded matches exact path or prefix", () => {
    assert.strictEqual(isExcluded("dist/", ["dist/"]), true);
    assert.strictEqual(isExcluded("dist/bundle.js", ["dist/"]), true);
    assert.strictEqual(isExcluded("src/main.ts", ["dist/"]), false);
  });

  it("formatSuggestion combines label and reason", () => {
    assert.strictEqual(formatSuggestion("src/", "common code folder"), "src/ (common code folder)");
  });

  it("classifies a root-level code file into codeFiles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "disc-root-code-"));
    fs.writeFileSync(path.join(tmpDir, "app.py"), "print('hi')", "utf8");
    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.codeFiles.includes("app.py"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies a root-level test file into testFiles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "disc-root-test-"));
    fs.writeFileSync(path.join(tmpDir, "foo.test.ts"), "// test", "utf8");
    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.testFiles.includes("foo.test.ts"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies a root-level document into documentFiles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "disc-root-doc-"));
    fs.writeFileSync(path.join(tmpDir, "NOTES.md"), "# notes", "utf8");
    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.documentFiles.includes("NOTES.md"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies a standard tests/ folder into testFolders", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "tests", "a.test.ts"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(
      result.testFolders.some((f) => f.path === "tests/" && f.reason === "test folder"),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies a delimited test folder name into testFolders", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    // "unit-tests" is not in TEST_FOLDER_NAMES but matches the delimiter-aware TEST_PATTERNS.
    fs.mkdirSync(path.join(tmpDir, "unit-tests"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "unit-tests", "a.ts"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.testFolders.some((f) => f.path === "unit-tests/"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not classify names that merely contain test as a substring", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    // "latest" and "contest" contain "test" but must not match.
    fs.mkdirSync(path.join(tmpDir, "latest"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "latest", "a.log"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "contest.md"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.deepStrictEqual(result.testFolders, []);
    assert.deepStrictEqual(result.testFiles, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans .github but pins it as unclassified; other dotfolders are skipped", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".github", "workflows", "ci.yml"), "on: push", "utf8");
    fs.mkdirSync(path.join(tmpDir, ".hidden"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".hidden", "secret.ts"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    // .github is whitelisted into classifyFolder, but no name set or content
    // heuristic matches a lone .yml workflow file, so it lands nowhere.
    assert.ok(!result.codeFolders.some((f) => f.path === ".github/"));
    assert.ok(!result.documentFolders.some((f) => f.path === ".github/"));
    assert.ok(!result.testFolders.some((f) => f.path === ".github/"));
    assert.ok(!result.codeFiles.some((f) => f.includes("ci.yml")));
    // .hidden is skipped entirely at the root loop.
    assert.ok(!result.codeFiles.some((f) => f.includes("secret.ts")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("leaves a folder with exactly 50% code files unclassified", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "half"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "half", "a.ts"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "half", "b.md"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    // Strict > 0.5 boundary: 1/2 is not enough for code or document.
    assert.deepStrictEqual(result.codeFolders, []);
    assert.deepStrictEqual(result.documentFolders, []);
    assert.deepStrictEqual(result.testFolders, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("leaves a folder with only .log and extensionless files unclassified", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "stuff"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "stuff", "app.log"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "stuff", "data"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.deepStrictEqual(result.codeFolders, []);
    assert.deepStrictEqual(result.documentFolders, []);
    assert.deepStrictEqual(result.testFolders, []);
    assert.deepStrictEqual(result.codeFiles, []);
    assert.deepStrictEqual(result.documentFiles, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("honors excludedPaths while collecting document files recursively", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "docs", "nested"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "top.md"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "docs", "nested", "note.md"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, ["docs/nested/"]);
    assert.ok(result.documentFiles.includes("docs/top.md"));
    assert.ok(!result.documentFiles.includes("docs/nested/note.md"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects a code folder from files nested two levels deep", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "deepmod", "sub1", "sub2"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "deepmod", "sub1", "sub2", "file.ts"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.codeFolders.some((f) => f.path === "deepmod/"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies an extensionless README file at root into documentFiles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.writeFileSync(path.join(tmpDir, "README"), "# hi", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.documentFiles.includes("README"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies a root file with an uppercase extension as code", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.writeFileSync(path.join(tmpDir, "APP.TS"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.deepStrictEqual(result.codeFiles, ["APP.TS"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("safeReadDir returns empty array when the path is a file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    const filePath = path.join(tmpDir, "a.txt");
    fs.writeFileSync(filePath, "", "utf8");

    // ENOTDIR is swallowed, same as ENOENT.
    assert.deepStrictEqual(safeReadDir(filePath), []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("isExcluded is always false with an empty exclusion list", () => {
    assert.strictEqual(isExcluded("dist/", []), false);
    assert.strictEqual(isExcluded("anything.ts", []), false);
  });

  it("isExcluded respects path boundaries", () => {
    assert.strictEqual(isExcluded("distfoo.ts", ["dist"]), false);
    assert.strictEqual(isExcluded("dist/foo.ts", ["dist"]), true);
    assert.strictEqual(isExcluded("dist", ["dist"]), true);
    assert.strictEqual(isExcluded("dist/foo.ts", ["dist/"]), true);
  });

  it("discovers unicode document filenames", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "設計.md"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.documentFiles.includes("docs/設計.md"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drops a symlink to a directory: treated as a file, then unclassified", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "realdir"), { recursive: true });
    // Keep realdir itself unclassifiable so only the symlink behavior is pinned.
    fs.writeFileSync(path.join(tmpDir, "realdir", "a.log"), "", "utf8");
    fs.symlinkSync(path.join(tmpDir, "realdir"), path.join(tmpDir, "linkdir"));

    const result = discoverProjectFiles(tmpDir, []);
    // Dirent.isDirectory() is false for symlinks, so the link is classified as
    // a file named "linkdir" with no extension and falls through everywhere.
    assert.ok(!result.codeFolders.some((f) => f.path === "linkdir/"));
    assert.ok(!result.codeFolders.some((f) => f.path === "realdir/"));
    assert.ok(!result.codeFiles.includes("linkdir"));
    assert.deepStrictEqual(result.codeFiles, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sorts all result arrays alphabetically", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.writeFileSync(path.join(tmpDir, "zeta.ts"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "alpha.ts"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "mid.ts"), "", "utf8");
    fs.mkdirSync(path.join(tmpDir, "zfold"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "zfold", "z.ts"), "", "utf8");
    fs.mkdirSync(path.join(tmpDir, "afold"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "afold", "a.ts"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.deepStrictEqual(result.codeFiles, ["alpha.ts", "mid.ts", "zeta.ts"]);
    assert.deepStrictEqual(
      result.codeFolders.map((f) => f.path),
      ["afold/", "zfold/"],
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("coverage audit gaps", () => {
  it("looksLikeTestPath matches test segments and rejects mere substrings", () => {
    assert.strictEqual(looksLikeTestPath("TESTING/"), true);
    assert.strictEqual(looksLikeTestPath("foo.specs"), true);
    assert.strictEqual(looksLikeTestPath("src/test.ts"), true);
    assert.strictEqual(looksLikeTestPath("unit/__tests__/a.ts"), true);
    assert.strictEqual(looksLikeTestPath("latest"), false);
    assert.strictEqual(looksLikeTestPath("contest.md"), false);
    assert.strictEqual(looksLikeTestPath("protest"), false);
    assert.strictEqual(looksLikeTestPath("testutils.ts"), false);
    assert.strictEqual(looksLikeTestPath("special.ts"), false);
  });

  it("classifies an extensionless CHANGELOG file at root into documentFiles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.writeFileSync(path.join(tmpDir, "CHANGELOG"), "# changes", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.documentFiles.includes("CHANGELOG"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("excludes non-document files inside a document folder from documentFiles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "guide.md"), "", "utf8");
    fs.writeFileSync(path.join(tmpDir, "docs", "image.png"), "", "utf8");

    const result = discoverProjectFiles(tmpDir, []);
    assert.ok(result.documentFiles.includes("docs/guide.md"));
    assert.ok(!result.documentFiles.includes("docs/image.png"));
    assert.deepStrictEqual(result.codeFiles, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("honors excludedPaths while content-classifying a custom-named folder", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-"));
    fs.mkdirSync(path.join(tmpDir, "pack", "vendor"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "pack", "vendor", "a.ts"), "", "utf8");

    // Control: without the exclusion, the nested .ts file makes pack/ a code folder.
    const withAll = discoverProjectFiles(tmpDir, []);
    assert.ok(withAll.codeFolders.some((f) => f.path === "pack/"));

    // With pack/vendor/ excluded, no child files remain to classify pack/ by.
    const result = discoverProjectFiles(tmpDir, ["pack/vendor/"]);
    assert.ok(!result.codeFolders.some((f) => f.path === "pack/"));
    assert.ok(!result.codeFiles.some((f) => f.includes("a.ts")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
