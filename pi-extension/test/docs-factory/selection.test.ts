import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildDocSelectionBlock, buildDocWritePlan, generateDocsStructure, MAX_BATCH, selectDocumentWriters } from "../../src/docs-factory/selection.js";
import { DOC_TYPES } from "../../src/docs-factory/catalog.js";
import { saveArchitectProfile } from "../../src/architect/index.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-selection-"));
}

function writePkg(cwd: string, pkg: Record<string, unknown>): void {
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify(pkg), "utf8");
}

describe("selectDocumentWriters", () => {
  it("empty project selects only readme-writer", () => {
    const cwd = makeTmp();
    assert.deepStrictEqual(selectDocumentWriters(cwd).writers, ["readme-writer"]);
  });

  it("package.json with version only adds changelog-writer, not api-docs-writer", () => {
    const cwd = makeTmp();
    writePkg(cwd, { name: "demo", version: "1.0.0" });
    const { writers } = selectDocumentWriters(cwd);
    assert.ok(writers.includes("changelog-writer"));
    assert.ok(!writers.includes("api-docs-writer"));
    assert.ok(!writers.includes("other-docs-writer"));
  });

  it("package.json with main/exports adds api-docs-writer", () => {
    const cwd = makeTmp();
    writePkg(cwd, { name: "demo", main: "dist/index.js" });
    assert.ok(selectDocumentWriters(cwd).writers.includes("api-docs-writer"));

    const cwd2 = makeTmp();
    writePkg(cwd2, { name: "demo", exports: { ".": "./dist/index.js" } });
    assert.ok(selectDocumentWriters(cwd2).writers.includes("api-docs-writer"));
  });

  it("CHANGELOG.md without package.json adds changelog-writer", () => {
    const cwd = makeTmp();
    fs.writeFileSync(path.join(cwd, "CHANGELOG.md"), "# Changelog\n", "utf8");
    assert.ok(selectDocumentWriters(cwd).writers.includes("changelog-writer"));
  });

  it("CONTRIBUTING.md or .github/ adds other-docs-writer", () => {
    const cwd = makeTmp();
    fs.writeFileSync(path.join(cwd, "CONTRIBUTING.md"), "# Contributing\n", "utf8");
    assert.ok(selectDocumentWriters(cwd).writers.includes("other-docs-writer"));

    const cwd2 = makeTmp();
    fs.mkdirSync(path.join(cwd2, ".github"));
    assert.ok(selectDocumentWriters(cwd2).writers.includes("other-docs-writer"));
  });

  it("corrupt package.json is ignored", () => {
    const cwd = makeTmp();
    fs.writeFileSync(path.join(cwd, "package.json"), "{not json", "utf8");
    assert.deepStrictEqual(selectDocumentWriters(cwd).writers, ["readme-writer"]);
  });
});

describe("buildDocSelectionBlock", () => {
  it("lists the selected writers with targets, templates, caps, and batches", () => {
    const cwd = makeTmp();
    writePkg(cwd, { name: "demo", version: "1.0.0", main: "dist/index.js" });
    const block = buildDocSelectionBlock(cwd);
    assert.ok(block.includes("## Document writers for this run"));
    assert.ok(block.includes("- readme-writer → README.md (template: readme, max 150 lines)"));
    assert.ok(block.includes("- changelog-writer → CHANGELOG.md (template: changelog"));
    assert.ok(block.includes("- api-docs-writer → docs/reference/README.md (template: api-reference"));
    assert.ok(!block.includes("- other-docs-writer"));
    assert.ok(block.includes("### Batches"));
    assert.ok(block.includes("Batch 1:"));
    assert.ok(block.includes("Spawn ONLY these tasks"));
  });
});

describe("buildDocWritePlan", () => {
  it("empty project: one readme task in one batch", () => {
    const cwd = makeTmp();
    const plan = buildDocWritePlan(cwd);
    assert.strictEqual(plan.tasks.length, 1);
    assert.strictEqual(plan.tasks[0].writer, "readme-writer");
    assert.strictEqual(plan.tasks[0].targetPath, "README.md");
    assert.strictEqual(plan.tasks[0].docType, "readme");
    assert.strictEqual(plan.tasks[0].maxLines, DOC_TYPES.readme.maxLines);
    assert.strictEqual(plan.batches.length, 1);
  });

  it("versioned package with public API: readme, changelog, api tasks in stable order", () => {
    const cwd = makeTmp();
    writePkg(cwd, { name: "demo", version: "1.0.0", main: "dist/index.js" });
    const plan = buildDocWritePlan(cwd);
    assert.deepStrictEqual(
      plan.tasks.map((t) => t.docType),
      ["readme", "changelog", "api-reference"],
    );
    const apiTask = plan.tasks.find((t) => t.docType === "api-reference");
    assert.strictEqual(apiTask?.targetPath, "docs/reference/README.md");
    assert.strictEqual(apiTask?.maxLines, DOC_TYPES["api-reference"].maxLines);
    for (const batch of plan.batches) {
      assert.ok(batch.length <= MAX_BATCH, "no batch exceeds MAX_BATCH");
    }
  });

  it("every task references a catalog doc type with a matching cap", () => {
    const cwd = makeTmp();
    writePkg(cwd, { name: "demo", version: "1.0.0", main: "dist/index.js" });
    fs.writeFileSync(path.join(cwd, "CONTRIBUTING.md"), "# Contributing\n", "utf8");
    const plan = buildDocWritePlan(cwd);
    assert.ok(plan.tasks.length === 4);
    for (const task of plan.tasks) {
      assert.ok(DOC_TYPES[task.docType], `unknown doc type ${task.docType}`);
      assert.strictEqual(task.maxLines, DOC_TYPES[task.docType].maxLines);
    }
    const contributing = plan.tasks.find((t) => t.writer === "other-docs-writer");
    assert.strictEqual(contributing?.targetPath, "CONTRIBUTING.md");
  });

  it("an architect profile adds the architecture overview task", () => {
    const cwd = makeTmp();
    assert.ok(!buildDocWritePlan(cwd).tasks.some((t) => t.docType === "architecture"));

    saveArchitectProfile(cwd, {
      projectName: "Demo",
      projectSlug: "demo",
      selectedArchitecture: "gas-monolith",
    } as Parameters<typeof saveArchitectProfile>[1]);
    const plan = buildDocWritePlan(cwd);
    const arch = plan.tasks.find((t) => t.docType === "architecture");
    assert.ok(arch, "architecture task expected");
    assert.strictEqual(arch.targetPath, DOC_TYPES.architecture.defaultPath);
    assert.strictEqual(arch.writer, "other-docs-writer");
  });
});

describe("doc-selection coverage round", () => {
  /** Project with all selection signals on: 5 tasks (readme, changelog,
   *  api-reference, contributing, architecture). */
  function setupFullProject(cwd: string): void {
    writePkg(cwd, { name: "demo", version: "1.0.0", main: "dist/index.js" });
    fs.writeFileSync(path.join(cwd, "CONTRIBUTING.md"), "# Contributing\n", "utf8");
    saveArchitectProfile(cwd, {
      projectName: "Demo",
      projectSlug: "demo",
      selectedArchitecture: "gas-monolith",
    } as Parameters<typeof saveArchitectProfile>[1]);
  }

  it("full 5-task project batches into 4 + 1", () => {
    const cwd = makeTmp();
    setupFullProject(cwd);
    const plan = buildDocWritePlan(cwd);
    assert.strictEqual(plan.tasks.length, 5);
    assert.strictEqual(plan.batches.length, 2);
    assert.strictEqual(plan.batches[0].length, MAX_BATCH);
    assert.strictEqual(plan.batches[1].length, 1, "fifth task spills into batch 2");
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("block shows Batch 2 and the architecture line with max 250 for a full project", () => {
    const cwd = makeTmp();
    setupFullProject(cwd);
    const block = buildDocSelectionBlock(cwd);
    assert.ok(block.includes("Batch 1:"));
    assert.ok(block.includes("Batch 2:"));
    assert.ok(
      block.includes("- other-docs-writer → docs/explanation/architecture.md (template: architecture, max 250 lines)"),
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("corrupt architect-profile.json adds no architecture task and never throws", () => {
    const cwd = makeTmp();
    // loadArchitectProfile throws on corrupt JSON; buildDocWritePlan catches it.
    fs.mkdirSync(path.join(cwd, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".pi", "architect", "architect-profile.json"), "{not json", "utf8");
    const plan = buildDocWritePlan(cwd);
    assert.ok(!plan.tasks.some((t) => t.docType === "architecture"));
    assert.deepStrictEqual(plan.tasks.map((t) => t.docType), ["readme"]);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("pkg.types and string exports add api-docs-writer; numeric version does not add changelog-writer", () => {
    const cwdTypes = makeTmp();
    writePkg(cwdTypes, { name: "demo", types: "dist/index.d.ts" });
    assert.ok(selectDocumentWriters(cwdTypes).writers.includes("api-docs-writer"));
    fs.rmSync(cwdTypes, { recursive: true, force: true });

    const cwdExports = makeTmp();
    writePkg(cwdExports, { name: "demo", exports: "./dist/index.js" });
    assert.ok(selectDocumentWriters(cwdExports).writers.includes("api-docs-writer"));
    fs.rmSync(cwdExports, { recursive: true, force: true });

    const cwdNumeric = makeTmp();
    writePkg(cwdNumeric, { name: "demo", version: 1.5 });
    assert.ok(!selectDocumentWriters(cwdNumeric).writers.includes("changelog-writer"));
    fs.rmSync(cwdNumeric, { recursive: true, force: true });
  });

  it("generateDocsStructure manifest carries docType/maxLines per target and is stable across runs", () => {
    const cwd = makeTmp();
    writePkg(cwd, { name: "demo", version: "1.0.0", main: "dist/index.js" });
    const first = generateDocsStructure(cwd);
    const manifest = JSON.parse(fs.readFileSync(first.manifestPath, "utf8"));
    assert.strictEqual(manifest.version, 1);
    for (const target of manifest.targets) {
      assert.strictEqual(typeof target.docType, "string");
      assert.ok(target.docType.length > 0, "docType present");
      assert.strictEqual(typeof target.maxLines, "number");
      assert.strictEqual(target.maxLines, DOC_TYPES[target.docType as keyof typeof DOC_TYPES].maxLines);
    }
    const manifestBytes = fs.readFileSync(first.manifestPath, "utf8");

    // Second run over the same project: identical manifest bytes, and the
    // stubs are rewritten (created), nothing kept.
    const second = generateDocsStructure(cwd);
    assert.strictEqual(fs.readFileSync(second.manifestPath, "utf8"), manifestBytes);
    assert.deepStrictEqual(second.created, first.created);
    assert.deepStrictEqual(second.kept, first.kept);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
