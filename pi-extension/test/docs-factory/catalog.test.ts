import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DOC_STUB_MARKER,
  DOC_TYPES,
  getDocType,
  isDocStub,
  renderTemplateStub,
  type DocTypeId,
} from "../../src/docs-factory/catalog.js";
import { generateDocsStructure } from "../../src/docs-factory/selection.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-catalog-"));
}

describe("doc catalog", () => {
  it("every entry has a template containing its required sections, a cap, and a default path", () => {
    for (const [id, spec] of Object.entries(DOC_TYPES) as Array<[DocTypeId, (typeof DOC_TYPES)[DocTypeId]]>) {
      assert.strictEqual(spec.id, id);
      assert.ok(spec.defaultPath.length > 0, `${id}: defaultPath`);
      assert.ok(spec.maxLines > 0, `${id}: maxLines`);
      assert.ok(spec.basedOn.length > 0, `${id}: basedOn`);
      assert.ok(spec.template.startsWith(DOC_STUB_MARKER), `${id}: template starts with the stub marker`);
      for (const section of spec.requiredSections) {
        assert.ok(spec.template.includes(section), `${id}: template contains ${section}`);
      }
    }
  });

  it("renderTemplateStub returns a stub; isDocStub detects stubs only", () => {
    const stub = renderTemplateStub("readme");
    assert.ok(stub.startsWith(DOC_STUB_MARKER));
    assert.ok(isDocStub(stub));
    assert.ok(isDocStub(`\n  ${stub}`));
    assert.ok(!isDocStub("# Real README\n\nHand-written content.\n"));
  });

  it("getDocType throws for an unknown id", () => {
    assert.strictEqual(getDocType("readme").defaultPath, "README.md");
    assert.throws(() => getDocType("nope" as DocTypeId), /Unknown doc type/);
  });

  it("every template's own line count is within its maxLines cap", () => {
    for (const [id, spec] of Object.entries(DOC_TYPES) as Array<[DocTypeId, (typeof DOC_TYPES)[DocTypeId]]>) {
      const stub = renderTemplateStub(id);
      const lineCount = stub.split("\n").length;
      assert.ok(
        lineCount <= spec.maxLines,
        `${id}: stub is ${lineCount} lines, over its ${spec.maxLines}-line cap`,
      );
    }
  });

  it("folder-owning types have a defaultPath ending with '/', single-file types do not", () => {
    const folderTypes: DocTypeId[] = ["adr", "api-reference", "how-to", "tutorial", "explanation"];
    const fileTypes: DocTypeId[] = ["readme", "changelog", "architecture", "contributing"];
    for (const id of folderTypes) {
      assert.ok(DOC_TYPES[id].defaultPath.endsWith("/"), `${id}: expected a folder path`);
    }
    for (const id of fileTypes) {
      assert.ok(!DOC_TYPES[id].defaultPath.endsWith("/"), `${id}: expected a file path`);
    }
  });

  it("isDocStub rejects a mid-file marker and an empty string", () => {
    assert.ok(!isDocStub(`# Real\n\n${DOC_STUB_MARKER}\n`), "marker mid-file is not a stub");
    assert.ok(!isDocStub(""), "empty string is not a stub");
  });
});

describe("generateDocsStructure", () => {
  it("creates stubs and the manifest for selected types only", () => {
    const cwd = makeTmp();
    const result = generateDocsStructure(cwd);

    assert.deepStrictEqual(result.created, ["README.md"]);
    assert.deepStrictEqual(result.kept, []);
    const readme = fs.readFileSync(path.join(cwd, "README.md"), "utf8");
    assert.ok(isDocStub(readme));
    // No unselected docs folders are created.
    assert.ok(!fs.existsSync(path.join(cwd, "docs")));

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
    assert.strictEqual(manifest.version, 1);
    assert.deepStrictEqual(
      manifest.targets.map((t: { path: string }) => t.path),
      ["README.md"],
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("creates docs/ subfolders only for selected types", () => {
    const cwd = makeTmp();
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ name: "demo", version: "1.0.0", main: "dist/index.js" }),
      "utf8",
    );
    const result = generateDocsStructure(cwd);

    assert.ok(result.created.includes("docs/reference/README.md"));
    assert.ok(fs.existsSync(path.join(cwd, "docs", "reference")));
    assert.ok(!fs.existsSync(path.join(cwd, "docs", "how-to")));
    assert.ok(!fs.existsSync(path.join(cwd, "docs", "tutorials")));
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("never overwrites a non-stub doc, overwrites a stale stub", () => {
    const cwd = makeTmp();
    fs.writeFileSync(path.join(cwd, "README.md"), "# My real README\n", "utf8");
    const first = generateDocsStructure(cwd);
    assert.deepStrictEqual(first.kept, ["README.md"]);
    assert.strictEqual(fs.readFileSync(path.join(cwd, "README.md"), "utf8"), "# My real README\n");

    // A stub left behind is safe to regenerate.
    fs.writeFileSync(path.join(cwd, "README.md"), renderTemplateStub("readme"), "utf8");
    const second = generateDocsStructure(cwd);
    assert.deepStrictEqual(second.created, ["README.md"]);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
