import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { suggestTruthDocuments, roleDocumentNeed } from "../../src/core/agents-config/document-suggestions.js";
import { SENAI_ROLES } from "../../src/core/agents-config/suggestions.js";
import { saveArchitectInputsConfig } from "../../src/architect/inputs-config.js";
import { saveFilesConfig } from "../../src/core/agents-config/files-config.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-suggest-"));
}

function writeDoc(cwd: string, relPath: string): void {
  const full = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "# doc", "utf8");
}

function withInputs(cwd: string, docs: Array<{ type: string; path: string }>): void {
  saveArchitectInputsConfig(cwd, {
    version: 1,
    documents: docs.map((d) => ({ type: d.type as any, path: d.path })),
    additionalConstraints: [],
  });
  for (const d of docs) writeDoc(cwd, d.path);
}

function withInputDocuments(cwd: string, paths: string[]): void {
  saveFilesConfig(cwd, { version: 2, codePaths: [], inputDocuments: paths, testPaths: [], excludedPaths: [] });
}

describe("document-suggestions", () => {
  it("suggests a typed prd document for scout-4, discussion, and planner", () => {
    const tmpDir = makeTmpDir();
    withInputs(tmpDir, [{ type: "prd", path: "docs/PRD.md" }]);

    const suggestions = suggestTruthDocuments(tmpDir);
    const roles = suggestions.filter((s) => s.path === "docs/PRD.md").map((s) => s.role);
    assert.deepStrictEqual(roles, ["scout-4", "discussion", "planner"]);
    assert.ok(suggestions[0].reason.includes("requirements"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suggests a typed rtm document for reviewer-correctness and code-review", () => {
    const tmpDir = makeTmpDir();
    withInputs(tmpDir, [{ type: "rtm", path: "docs/RTM.md" }]);

    const roles = suggestTruthDocuments(tmpDir).map((s) => s.role);
    assert.deepStrictEqual(roles, ["reviewer-correctness", "code-review"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suggests a typed test-plan for reviewer-tests", () => {
    const tmpDir = makeTmpDir();
    withInputs(tmpDir, [{ type: "test-plan", path: "docs/TEST_PLAN.md" }]);

    const suggestions = suggestTruthDocuments(tmpDir);
    assert.deepStrictEqual(suggestions.map((s) => s.role), ["reviewer-tests"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suggests a typed nfr document for reviewer-security and security-gate", () => {
    const tmpDir = makeTmpDir();
    withInputs(tmpDir, [{ type: "nfr", path: "docs/NFR.md" }]);

    const roles = suggestTruthDocuments(tmpDir).map((s) => s.role);
    assert.deepStrictEqual(roles, ["reviewer-security", "security-gate"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suggests a typed adr document for scout-1", () => {
    const tmpDir = makeTmpDir();
    withInputs(tmpDir, [{ type: "adr", path: "docs/ADR-001.md" }]);

    const suggestions = suggestTruthDocuments(tmpDir);
    assert.deepStrictEqual(suggestions.map((s) => s.role), ["scout-1"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to filename keywords when no types are available", () => {
    const tmpDir = makeTmpDir();
    writeDoc(tmpDir, "docs/security-policy.md");
    withInputDocuments(tmpDir, ["docs/security-policy.md"]);

    const suggestions = suggestTruthDocuments(tmpDir);
    const roles = suggestions.filter((s) => s.path === "docs/security-policy.md").map((s) => s.role);
    assert.deepStrictEqual(roles, ["reviewer-security", "security-gate"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("typed matches win over keyword matches", () => {
    const tmpDir = makeTmpDir();
    withInputs(tmpDir, [{ type: "prd", path: "docs/requirements.md" }]);
    writeDoc(tmpDir, "docs/prd-old.md");
    withInputDocuments(tmpDir, ["docs/prd-old.md"]);

    const planner = suggestTruthDocuments(tmpDir).find((s) => s.role === "planner");
    assert.strictEqual(planner?.path, "docs/requirements.md", "user-classified type beats filename keyword");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("never suggests documents for the code-reading scouts", () => {
    const tmpDir = makeTmpDir();
    withInputs(tmpDir, [
      { type: "prd", path: "docs/PRD.md" },
      { type: "rtm", path: "docs/RTM.md" },
      { type: "test-plan", path: "docs/TEST_PLAN.md" },
      { type: "nfr", path: "docs/NFR.md" },
      { type: "adr", path: "docs/ADR.md" },
    ]);

    const roles = suggestTruthDocuments(tmpDir).map((s) => s.role);
    assert.ok(!roles.includes("scout-2"));
    assert.ok(!roles.includes("scout-3"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty list when there are no candidates", () => {
    const tmpDir = makeTmpDir();
    assert.deepStrictEqual(suggestTruthDocuments(tmpDir), []);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("excludes input documents that do not exist on disk", () => {
    const tmpDir = makeTmpDir();
    withInputDocuments(tmpDir, ["docs/missing-prd.md"]);

    assert.deepStrictEqual(suggestTruthDocuments(tmpDir), []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty list without throwing when both configs are corrupted", () => {
    const tmpDir = makeTmpDir();
    for (const rel of [".pi/senai/architect-inputs.json", ".pi/senai/files.json"]) {
      const full = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "{ not valid", "utf8");
    }

    assert.deepStrictEqual(suggestTruthDocuments(tmpDir), []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips folder paths in inputDocuments", () => {
    const tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, "docs", "prd-folder"), { recursive: true });
    withInputDocuments(tmpDir, ["docs/prd-folder/"]);

    assert.deepStrictEqual(suggestTruthDocuments(tmpDir), []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("deduplicates a document that appears in both sources", () => {
    const tmpDir = makeTmpDir();
    withInputs(tmpDir, [{ type: "prd", path: "docs/PRD.md" }]);
    withInputDocuments(tmpDir, ["docs/PRD.md"]);

    const planner = suggestTruthDocuments(tmpDir).filter((s) => s.role === "planner");
    assert.strictEqual(planner.length, 1, "same document must not be suggested twice");
    assert.strictEqual(planner[0].path, "docs/PRD.md");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suggests a keyword-overlapping document for every matching rule group", () => {
    const tmpDir = makeTmpDir();
    writeDoc(tmpDir, "docs/security-test-plan.md");
    withInputDocuments(tmpDir, ["docs/security-test-plan.md"]);

    const roles = suggestTruthDocuments(tmpDir).map((s) => s.role);
    assert.ok(roles.includes("reviewer-tests"), "test keyword matches reviewer-tests");
    assert.ok(roles.includes("reviewer-security"), "security keyword matches reviewer-security");
    assert.ok(roles.includes("security-gate"), "security keyword matches security-gate");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ignores architect-input types that have no matching rule", () => {
    const tmpDir = makeTmpDir();
    withInputs(tmpDir, [
      { type: "readme", path: "docs/README.md" },
      { type: "code", path: "docs/CODE.md" },
    ]);

    assert.deepStrictEqual(suggestTruthDocuments(tmpDir), []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("matches keywords against the basename only", () => {
    const tmpDir = makeTmpDir();
    writeDoc(tmpDir, "tests/plan.md");
    withInputDocuments(tmpDir, ["tests/plan.md"]);

    assert.deepStrictEqual(suggestTruthDocuments(tmpDir), [], "folder name must not trigger the test keyword");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("matches keywords case-insensitively", () => {
    const tmpDir = makeTmpDir();
    writeDoc(tmpDir, "docs/TEST-PLAN.md");
    withInputDocuments(tmpDir, ["docs/TEST-PLAN.md"]);

    const roles = suggestTruthDocuments(tmpDir).map((s) => s.role);
    assert.deepStrictEqual(roles, ["reviewer-tests"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("roleDocumentNeed returns the plain document-type name per role", () => {
    assert.strictEqual(roleDocumentNeed("reviewer-correctness"), "RTM / traceability document");
    assert.strictEqual(roleDocumentNeed("reviewer-security"), "NFR / security requirements");
    assert.strictEqual(roleDocumentNeed("scout-4"), "PRD / requirements document");
  });

  it("roleDocumentNeed returns the architecture need for scout-1", () => {
    assert.strictEqual(roleDocumentNeed("scout-1"), "architecture / design document");
  });

  it("roleDocumentNeed returns undefined for the code-reading scouts", () => {
    assert.strictEqual(roleDocumentNeed("scout-2"), undefined);
    assert.strictEqual(roleDocumentNeed("scout-3"), undefined);
  });

  it("roleDocumentNeed returns the rule need for every remaining rule role", () => {
    assert.strictEqual(roleDocumentNeed("discussion"), "PRD / requirements document");
    assert.strictEqual(roleDocumentNeed("planner"), "PRD / requirements document");
    assert.strictEqual(roleDocumentNeed("code-review"), "RTM / traceability document");
    assert.strictEqual(roleDocumentNeed("reviewer-tests"), "test plan document");
    assert.strictEqual(roleDocumentNeed("security-gate"), "NFR / security requirements");
  });

  it("roleDocumentNeed returns undefined for artifact and other non-rule roles", () => {
    for (const role of ["plan-overview", "test-skeleton", "implementer", "linter", "full-test", "readme-writer", "changelog-writer", "api-docs-writer", "other-docs-writer"] as const) {
      assert.strictEqual(roleDocumentNeed(role), undefined, `${role} must have no document need`);
    }
  });

  it("roleDocumentNeed covers every SENAI_ROLES entry consistently", () => {
    const ruleRoles = new Set(["scout-1", "scout-4", "discussion", "planner", "reviewer-correctness", "code-review", "reviewer-tests", "reviewer-security", "security-gate"]);
    for (const role of SENAI_ROLES) {
      const need = roleDocumentNeed(role);
      if (ruleRoles.has(role)) {
        assert.ok(typeof need === "string" && need.length > 0, `${role} must have a needs text`);
      } else {
        assert.strictEqual(need, undefined, `${role} must have no needs text`);
      }
    }
  });
});

describe("coverage audit gaps", () => {
  it("filters out a typed architect-input candidate whose file no longer exists on disk", () => {
    const tmpDir = makeTmpDir();
    // The document is classified but never written to disk; the final
    // existsSync filter in collectCandidates must drop it.
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: [],
    });

    assert.deepStrictEqual(suggestTruthDocuments(tmpDir), []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
