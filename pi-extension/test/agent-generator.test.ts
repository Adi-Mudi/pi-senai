import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  GENERATED_ROLES,
  GENERATOR_VERSION,
  discoverTechnologyResources,
  getProjectSlug,
  matchTechnologies,
  parseKeywords,
  planAgentGeneration,
  previewRegeneration,
  writeGeneratedAgents,
} from "../src/agent-generator.js";
import { addToGeneratedManifest, loadGeneratedManifest, saveArchitectReport, slugify, writeGeneratedManifest } from "../src/architect.js";
import { runSenaiDiagnostic } from "../src/doctor.js";
import { saveAgentConfig } from "../src/agent-config.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeReport() {
  return {
    selectedArchitecture: "gas-monolith",
    confidence: "high" as const,
    missingResources: [],
    reasoning: "Test.",
    skillProfile: { recommendedAgents: [], forbiddenPatterns: [] },
    developmentOrder: [],
    feasibility: "feasible" as const,
    feasibilityReasoning: "Clear.",
    techStack: ["Google Apps Script", "Google Sheets"],
    atomicFunctions: ["sendSignalEmail()"],
    systemOverview: "",
    components: [],
    interfaces: [],
    dataFlow: "",
    dataModel: "",
    deployment: "",
    qualityAttributeMapping: [],
    adrs: [],
    constraints: ["Platform is limited to Google Sheets and Google Apps Script."],
  };
}

describe("agent-generator", () => {
  it("discovers bundled resources including generic", () => {
    const tmpDir = makeTmpDir("agent-gen-disc-");
    const resources = discoverTechnologyResources(tmpDir);
    const ids = resources.map((r) => r.id);
    assert.ok(ids.includes("generic"));
    assert.ok(ids.includes("google-apps-script"));
    assert.ok(ids.includes("python"));
    assert.ok(!ids.includes("_template"), "template file must be skipped");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("project resources override bundled ones by id", () => {
    const tmpDir = makeTmpDir("agent-gen-override-");
    const dir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "python.md"),
      "---\nid: python\nname: Python (project override)\nkeywords: [python]\n---\n\nProject-specific python craft.",
      "utf8",
    );
    const resources = discoverTechnologyResources(tmpDir);
    const python = resources.find((r) => r.id === "python");
    assert.strictEqual(python?.source, "project");
    assert.ok(python?.body.includes("Project-specific python craft"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("matches technologies by keywords against stack hints", () => {
    const tmpDir = makeTmpDir("agent-gen-match-");
    const resources = discoverTechnologyResources(tmpDir);
    const gas = matchTechnologies(["Google Apps Script", "Google Sheets"], resources);
    assert.strictEqual(gas[0]?.id, "google-apps-script");
    const py = matchTechnologies(["python", "pytest"], resources);
    assert.strictEqual(py[0]?.id, "python");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to generic when nothing matches", () => {
    const tmpDir = makeTmpDir("agent-gen-generic-");
    const resources = discoverTechnologyResources(tmpDir);
    const matched = matchTechnologies(["cobol", "fortran"], resources);
    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].id, "generic");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("planAgentGeneration builds complete agent files with project context", () => {
    const tmpDir = makeTmpDir("agent-gen-plan-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "nifty-weightage-trend" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const matched = matchTechnologies(["google apps script"], resources);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 2), matched, makeReport());

    assert.strictEqual(plans.length, 2);
    const scout = plans[0];
    assert.strictEqual(scout.agentName, "nifty-weightage-trend-scout-2");
    assert.ok(scout.content.includes("name: nifty-weightage-trend-scout-2"));
    assert.ok(scout.content.includes("description:"));
    assert.ok(scout.content.includes("tools: read"));
    assert.ok(scout.content.includes("## Your mandate"));
    assert.ok(scout.content.includes("Google Apps Script"), "should include matched resource craft");
    assert.ok(scout.content.includes("sendSignalEmail()"), "should include report atomic functions");
    assert.ok(scout.content.includes("Platform is limited"), "should include report constraints");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writeGeneratedAgents creates files and never overwrites", () => {
    const tmpDir = makeTmpDir("agent-gen-write-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 2), resources, null);

    const first = writeGeneratedAgents(tmpDir, plans);
    assert.strictEqual(first.created.length, 2);
    assert.strictEqual(first.skipped.length, 0);

    // Change one plan's content and write again — the file must not be overwritten.
    plans[0].content = "hand-edited marker should not win";
    const second = writeGeneratedAgents(tmpDir, plans);
    assert.strictEqual(second.created.length, 0);
    assert.strictEqual(second.skipped.length, 2);
    const onDisk = fs.readFileSync(path.join(tmpDir, ".pi", "agents", `${plans[0].agentName}.md`), "utf8");
    assert.ok(!onDisk.includes("hand-edited marker"), "existing file must not be overwritten");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("report context is optional — agents still build without it", () => {
    const tmpDir = makeTmpDir("agent-gen-noreport-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 1), resources, null);
    assert.ok(plans[0].content.includes("## Your mandate"));
    assert.ok(!plans[0].content.includes("## Project context"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveArchitectReport integration is not required for plan building", () => {
    const tmpDir = makeTmpDir("agent-gen-savereport-");
    saveArchitectReport(tmpDir, makeReport());
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "architect", "architect-report.json")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses the folder name as slug when no package.json exists", () => {
    const tmpDir = makeTmpDir("agent-gen-slug-");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 1), resources, null);
    assert.strictEqual(plans[0].agentName, `${slugify(path.basename(tmpDir))}-scout-2`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to the folder name when package.json has no name field", () => {
    const tmpDir = makeTmpDir("agent-gen-noname-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 1), resources, null);
    assert.strictEqual(plans[0].agentName, `${slugify(path.basename(tmpDir))}-scout-2`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips resource files with an empty body", () => {
    const tmpDir = makeTmpDir("agent-gen-empty-");
    const dir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "empty.md"), "---\nid: empty-body\nname: Empty\nkeywords: [empty]\n---\n", "utf8");
    fs.writeFileSync(path.join(dir, "good.md"), "---\nid: good\nname: Good\nkeywords: [good]\n---\n\nGood body.", "utf8");
    const projectResources = discoverTechnologyResources(tmpDir).filter((r) => r.source === "project");
    assert.deepStrictEqual(projectResources.map((r) => r.id), ["good"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a resource with empty keywords never matches and falls back to generic", () => {
    const tmpDir = makeTmpDir("agent-gen-nokey-");
    const dir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "nokey.md"), "---\nid: nokey\nname: NoKey\nkeywords: []\n---\n\nNoKey body.", "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const matched = matchTechnologies(["nokey"], resources);
    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].id, "generic");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("orders multiple matches by keyword score", () => {
    const tmpDir = makeTmpDir("agent-gen-order-");
    const resources = discoverTechnologyResources(tmpDir);
    const matched = matchTechnologies(["apps script", "google sheets", "python"], resources);
    assert.strictEqual(matched[0].id, "google-apps-script");
    assert.strictEqual(matched[1].id, "python");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("assembles the project-override resource body into the agent", () => {
    const tmpDir = makeTmpDir("agent-gen-override-body-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const dir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "python.md"),
      "---\nid: python\nname: Python (override)\nkeywords: [python]\n---\n\nPROJECT_OVERRIDE_CRAFT_MARKER",
      "utf8",
    );
    const resources = discoverTechnologyResources(tmpDir);
    const matched = matchTechnologies(["python"], resources);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 1), matched, null);
    assert.ok(plans[0].content.includes("PROJECT_OVERRIDE_CRAFT_MARKER"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("addToGeneratedManifest creates a manifest when missing", () => {
    const tmpDir = makeTmpDir("agent-gen-addman-");
    const file = path.join(tmpDir, "a.txt");
    fs.writeFileSync(file, "content a", "utf8");
    const manifest = addToGeneratedManifest(tmpDir, [file]);
    assert.strictEqual(manifest.version, 1);
    assert.ok(manifest.files["a.txt"]);
    assert.ok(manifest.generatedAt);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("addToGeneratedManifest preserves existing entries while updating one file", () => {
    const tmpDir = makeTmpDir("agent-gen-mergeman-");
    const fileA = path.join(tmpDir, "a.txt");
    const fileB = path.join(tmpDir, "b.txt");
    fs.writeFileSync(fileA, "content a", "utf8");
    fs.writeFileSync(fileB, "content b", "utf8");
    writeGeneratedManifest(tmpDir, [fileA, fileB]);

    fs.writeFileSync(fileB, "content b changed", "utf8");
    const manifest = addToGeneratedManifest(tmpDir, [fileB]);

    assert.deepStrictEqual(Object.keys(manifest.files).sort(), ["a.txt", "b.txt"]);
    const reloaded = loadGeneratedManifest(tmpDir);
    assert.ok(reloaded);
    assert.strictEqual(manifest.files["a.txt"], reloaded!.files["a.txt"], "untouched entry keeps its hash");
    assert.notStrictEqual(manifest.files["b.txt"], reloaded!.files["a.txt"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writeGeneratedAgents adds created files to the manifest", () => {
    const tmpDir = makeTmpDir("agent-gen-manifest-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 2), resources, null);
    const result = writeGeneratedAgents(tmpDir, plans);
    assert.strictEqual(result.created.length, 2);

    const manifest = loadGeneratedManifest(tmpDir);
    assert.ok(manifest, "manifest should exist after generation");
    for (const rel of result.created) {
      assert.ok(manifest!.files[rel], `manifest should contain ${rel}`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GENERATED_ROLES contains exactly the 14 non-architecture roles", () => {
    const roles = GENERATED_ROLES.map((r) => r.role);
    assert.strictEqual(roles.length, 14);
    const architectureBound = [
      "scout-1",
      "planner",
      "implementer",
      "reviewer-correctness",
      "reviewer-security",
      "reviewer-tests",
      "code-review",
    ];
    for (const role of architectureBound) {
      assert.ok(!roles.includes(role), `${role} must not be generated by the sub-agent generator`);
    }
  });

  it("falls back to the filename when a resource has no id frontmatter", () => {
    const tmpDir = makeTmpDir("agent-gen-noid-");
    const dir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "cobol.md"),
      "---\nname: COBOL\nkeywords: [cobol]\n---\n\nCOBOL body.",
      "utf8",
    );

    const projectResources = discoverTechnologyResources(tmpDir).filter((r) => r.source === "project");
    assert.strictEqual(projectResources.length, 1);
    assert.strictEqual(projectResources[0].id, "cobol");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to the id when a resource has no name frontmatter", () => {
    const tmpDir = makeTmpDir("agent-gen-noname-");
    const dir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "fortran.md"),
      "---\nid: fortran\nkeywords: [fortran]\n---\n\nFortran body.",
      "utf8",
    );

    const projectResources = discoverTechnologyResources(tmpDir).filter((r) => r.source === "project");
    assert.strictEqual(projectResources.length, 1);
    assert.strictEqual(projectResources[0].name, "fortran");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips a resource with corrupted frontmatter and still loads the rest", () => {
    const tmpDir = makeTmpDir("agent-gen-corrupt-");
    const dir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.md"), "---\nid: [unclosed\n---\nbody", "utf8");
    fs.writeFileSync(
      path.join(dir, "good.md"),
      "---\nid: good\nname: Good\nkeywords: [good]\n---\n\nGood body.",
      "utf8",
    );

    const projectResources = discoverTechnologyResources(tmpDir).filter((r) => r.source === "project");
    assert.deepStrictEqual(projectResources.map((r) => r.id), ["good"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ignores non-markdown files in the technologies dir", () => {
    const tmpDir = makeTmpDir("agent-gen-nontxt-");
    const dir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "notes.txt"), "id: notes\n\nNot a resource.", "utf8");

    const projectResources = discoverTechnologyResources(tmpDir).filter((r) => r.source === "project");
    assert.deepStrictEqual(projectResources, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses comma-string keywords into an array", () => {
    const tmpDir = makeTmpDir("agent-gen-keywords-");
    const dir = path.join(tmpDir, ".pi", "technologies");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "pystring.md"),
      "---\nid: pystring\nname: PyString\nkeywords: python, pytest\n---\n\nPyString body.",
      "utf8",
    );

    const projectResources = discoverTechnologyResources(tmpDir).filter((r) => r.source === "project");
    assert.strictEqual(projectResources.length, 1);
    assert.deepStrictEqual(projectResources[0].keywords, ["python", "pytest"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("matchTechnologies with empty stack hints falls back to generic", () => {
    const tmpDir = makeTmpDir("agent-gen-emptyhints-");
    const resources = discoverTechnologyResources(tmpDir);
    const matched = matchTechnologies([], resources);
    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].id, "generic");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("matchTechnologies returns an empty array when generic is missing and nothing matches", () => {
    const resources = [
      { id: "foo", name: "Foo", keywords: ["foo"], body: "Foo body.", source: "project" as const },
    ];
    assert.deepStrictEqual(matchTechnologies(["zzz"], resources), []);
  });

  it("getProjectSlug falls back to the folder name for a corrupted package.json", () => {
    const tmpDir = makeTmpDir("agent-gen-badpkg-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{ not json", "utf8");

    assert.strictEqual(getProjectSlug(tmpDir), slugify(path.basename(tmpDir)));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getProjectSlug slugifies a scoped package name", () => {
    const tmpDir = makeTmpDir("agent-gen-scoped-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "@org/my-pkg" }), "utf8");

    assert.strictEqual(getProjectSlug(tmpDir), "org-my-pkg");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("omits the Project context block when the report arrays are all empty", () => {
    const tmpDir = makeTmpDir("agent-gen-emptyctx-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const report = { ...makeReport(), techStack: [], atomicFunctions: [], constraints: [] };

    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 1), resources, report);
    assert.ok(!plans[0].content.includes("## Project context"));
    assert.ok(!plans[0].content.includes("Technology stack:"));
    assert.ok(!plans[0].content.includes("Key functions in this project:"));
    assert.ok(!plans[0].content.includes("Constraints you must respect:"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writeGeneratedAgents with no plans creates nothing and no manifest", () => {
    const tmpDir = makeTmpDir("agent-gen-noplans-");

    const result = writeGeneratedAgents(tmpDir, []);
    assert.deepStrictEqual(result.created, []);
    assert.deepStrictEqual(result.skipped, []);
    assert.strictEqual(loadGeneratedManifest(tmpDir), null);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("coverage audit gaps", () => {
  it("parseKeywords returns an empty array for missing or malformed keywords frontmatter", () => {
    assert.deepStrictEqual(parseKeywords(undefined), []);
    assert.deepStrictEqual(parseKeywords(42), []);
    assert.deepStrictEqual(parseKeywords({ list: ["python"] }), []);
    assert.deepStrictEqual(parseKeywords(null), []);
  });
});

describe("model inheritance", () => {
  it("generated agents never pin a model in frontmatter (all 14 roles)", () => {
    const tmpDir = makeTmpDir("agent-gen-nomodel-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    assert.strictEqual(plans.length, GENERATED_ROLES.length);
    for (const plan of plans) {
      const frontmatter = plan.content.split("---")[1] ?? "";
      assert.ok(
        !/^model:/m.test(frontmatter),
        `${plan.agentName} must not pin a model — subagents inherit pi's default model`,
      );
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generated agents carry orchestration frontmatter (all 14 roles)", () => {
    const tmpDir = makeTmpDir("agent-gen-frontmatter-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    for (const plan of plans) {
      const frontmatter = plan.content.split("---")[1] ?? "";
      assert.ok(/^session-mode: lineage-only$/m.test(frontmatter), `${plan.agentName} needs session-mode: lineage-only`);
      assert.ok(/^auto-exit: true$/m.test(frontmatter), `${plan.agentName} needs auto-exit: true`);
      assert.ok(/^spawning: false$/m.test(frontmatter), `${plan.agentName} needs spawning: false`);
      assert.ok(plan.content.includes("## Completion contract"), `${plan.agentName} needs the completion contract`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("artifact-writing roles get the write tool and discussion is interactive", () => {
    const tmpDir = makeTmpDir("agent-gen-tools-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    const writingRoles = ["scout-2", "scout-3", "scout-4", "discussion", "plan-overview", "security-gate"];
    for (const role of writingRoles) {
      const plan = plans.find((p) => p.role === role);
      assert.ok(plan, `missing plan for ${role}`);
      const frontmatter = plan.content.split("---")[1] ?? "";
      assert.ok(/^tools:.*\bwrite\b/m.test(frontmatter), `${role} must carry the write tool`);
    }
    const discussion = plans.find((p) => p.role === "discussion");
    const discussionFrontmatter = discussion?.content.split("---")[1] ?? "";
    assert.ok(/^interactive: true$/m.test(discussionFrontmatter), "discussion must be interactive");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("non-discussion roles never carry the interactive flag", () => {
    const tmpDir = makeTmpDir("agent-gen-nointeractive-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    for (const plan of plans) {
      if (plan.role === "discussion") continue;
      const frontmatter = plan.content.split("---")[1] ?? "";
      assert.ok(!/^interactive:/m.test(frontmatter), `${plan.agentName} must not be interactive`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("write-tool roles have exactly read+write and linter/full-test have read+bash+write", () => {
    const tmpDir = makeTmpDir("agent-gen-exacttools-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    const writingRoles = ["scout-2", "scout-3", "scout-4", "discussion", "plan-overview", "security-gate"];
    for (const role of writingRoles) {
      const frontmatter = plans.find((p) => p.role === role)?.content.split("---")[1] ?? "";
      assert.ok(/^tools: read, write$/m.test(frontmatter), `${role} must have exactly 'tools: read, write'`);
    }
    for (const role of ["linter", "full-test"]) {
      const frontmatter = plans.find((p) => p.role === role)?.content.split("---")[1] ?? "";
      assert.ok(/^tools: read, bash, write$/m.test(frontmatter), `${role} must have exactly 'tools: read, bash, write'`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("completion contract appears exactly once, before the technology craft sections", () => {
    const tmpDir = makeTmpDir("agent-gen-contract-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    for (const plan of plans) {
      assert.strictEqual(
        plan.content.split("## Completion contract").length - 1,
        1,
        `${plan.agentName} must have exactly one completion contract`,
      );
      const contractIndex = plan.content.indexOf("## Completion contract");
      const craftIndex = plan.content.indexOf("## Technology craft");
      if (craftIndex !== -1) {
        assert.ok(contractIndex < craftIndex, `${plan.agentName}: contract must precede craft sections`);
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("frontmatter key order is stable for drift detection", () => {
    const tmpDir = makeTmpDir("agent-gen-order-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    const expectedOrder = ["name:", "description:", "tools:", "session-mode:", "auto-exit:", "spawning:"];
    for (const plan of plans) {
      const frontmatter = (plan.content.split("---")[1] ?? "").trim().split("\n");
      const keys = frontmatter.filter((l) => expectedOrder.some((k) => l.startsWith(k)));
      assert.deepStrictEqual(
        keys.map((l) => expectedOrder.find((k) => l.startsWith(k))),
        expectedOrder,
        `${plan.agentName} frontmatter key order changed`,
      );
    }
    const discussion = plans.find((p) => p.role === "discussion");
    const discussionLines = (discussion?.content.split("---")[1] ?? "").trim().split("\n");
    assert.ok(
      discussionLines.indexOf("interactive: true") === discussionLines.length - 1,
      "interactive flag must be the last frontmatter line for discussion",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("sub-agent regeneration", () => {
  function setupProject(prefix: string): string {
    const tmpDir = makeTmpDir(prefix);
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    return tmpDir;
  }

  function agentFile(tmpDir: string, agentName: string): string {
    return path.join(tmpDir, ".pi", "agents", `${agentName}.md`);
  }

  it("generated agents carry the generator version footer", () => {
    const tmpDir = setupProject("agent-gen-ver-");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 1), resources, null);
    assert.ok(
      plans[0].content.includes(`(generator v${GENERATOR_VERSION})`),
      "footer must carry the generator version for staleness detection",
    );
    assert.ok(plans[0].content.includes("Generated by pi-senai"), "marker text must be kept");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("doc-writer agents carry the documentation contract from the catalog", () => {
    const tmpDir = setupProject("agent-gen-doccontract-");
    const resources = discoverTechnologyResources(tmpDir);
    const writerDefs = GENERATED_ROLES.filter((d) => d.role === "readme-writer");
    const plans = planAgentGeneration(tmpDir, writerDefs, resources, null);
    const content = plans[0].content;
    assert.ok(content.includes("## Documentation contract"));
    assert.ok(content.includes("- Target: README.md"));
    assert.ok(content.includes("- Template: readme (based on Standard Readme spec)"));
    assert.ok(content.includes("- Hard length cap: 150 lines"));
    assert.ok(content.includes("## Install, ## Usage"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("non-writer roles carry no documentation contract", () => {
    const tmpDir = setupProject("agent-gen-nocontract-");
    const resources = discoverTechnologyResources(tmpDir);
    const defs = GENERATED_ROLES.filter((d) => d.role === "linter");
    const plans = planAgentGeneration(tmpDir, defs, resources, null);
    assert.ok(!plans[0].content.includes("## Documentation contract"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("api-docs-writer contract targets docs/reference/ with the api-reference template", () => {
    const tmpDir = setupProject("agent-gen-apicontract-");
    const resources = discoverTechnologyResources(tmpDir);
    const defs = GENERATED_ROLES.filter((d) => d.role === "api-docs-writer");
    const plans = planAgentGeneration(tmpDir, defs, resources, null);
    const content = plans[0].content;
    assert.ok(content.includes("## Documentation contract"));
    assert.ok(content.includes("- Target: docs/reference/"));
    assert.ok(content.includes("- Template: api-reference (based on Google API reference style)"));
    assert.ok(content.includes("- Hard length cap: 60 lines"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("other-docs-writer contract uses the how-to template", () => {
    const tmpDir = setupProject("agent-gen-othercontract-");
    const resources = discoverTechnologyResources(tmpDir);
    const defs = GENERATED_ROLES.filter((d) => d.role === "other-docs-writer");
    const plans = planAgentGeneration(tmpDir, defs, resources, null);
    const content = plans[0].content;
    assert.ok(content.includes("- Target: docs/how-to/"));
    assert.ok(content.includes("- Template: how-to (based on Diátaxis how-to guides)"));
    assert.ok(content.includes("- Hard length cap: 150 lines"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("doctor flags a team agent with an older generator-version footer as stale", () => {
    const tmpDir = setupProject("agent-gen-stale-");
    const slug = getProjectSlug(tmpDir);
    const agentName = `${slug}-scout-2`;
    // Complete generated-format content, but the footer says the previous
    // generator version — doctor must flag it as from an older pi-senai.
    const content = [
      "---",
      `name: ${agentName}`,
      "description: Code Scout 2 for demo. Generated by pi-senai.",
      "tools: read, write",
      "---",
      "",
      `# ${agentName}`,
      "",
      "## Your mandate",
      "",
      "- Search code.",
      "",
      "## Technology craft (Generic)",
      "",
      "craft",
      "",
      "---",
      `_Generated by pi-senai (generator v${GENERATOR_VERSION - 1}) from technology resource(s): \`generic\`._`,
    ].join("\n");
    fs.mkdirSync(path.join(tmpDir, ".pi", "agents"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "agents", `${agentName}.md`), content, "utf8");
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": agentName } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Generated team agents");
    assert.ok(section, "Generated team agents section must exist");
    const stale = section.items.find(
      (i) => i.status === "warning" && i.message === `${agentName}: generated by an older pi-senai version`,
    );
    assert.ok(stale, `stale footer must warn; got: ${section.items.map((i) => i.message).join(" | ")}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("regenerate overwrites a manifest-proven untouched file and refreshes its hash", () => {
    const tmpDir = setupProject("agent-gen-regen-");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 2), resources, null);

    writeGeneratedAgents(tmpDir, plans);

    // Simulate an extension update: the generator now produces new content.
    plans[0].content = `${plans[0].content}\n\n## New section from updated extension`;
    const result = writeGeneratedAgents(tmpDir, plans, { regenerate: true });

    assert.strictEqual(result.created.length, 0);
    assert.strictEqual(result.regenerated.length, 2);
    assert.strictEqual(result.keptDrifted.length, 0);
    assert.strictEqual(result.skipped.length, 0);
    const onDisk = fs.readFileSync(agentFile(tmpDir, plans[0].agentName), "utf8");
    assert.ok(onDisk.includes("New section from updated extension"));

    // Manifest hash must follow the new content, so a second regenerate is
    // still treated as proven-untouched.
    const second = writeGeneratedAgents(tmpDir, plans, { regenerate: true });
    assert.strictEqual(second.regenerated.length, 2);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("regenerate keeps a user-edited file (keptDrifted) and leaves the bytes intact", () => {
    const tmpDir = setupProject("agent-gen-drift-");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 2), resources, null);
    writeGeneratedAgents(tmpDir, plans);

    const editedPath = agentFile(tmpDir, plans[0].agentName);
    const edited = `${fs.readFileSync(editedPath, "utf8")}\n\nUSER EDIT`;
    fs.writeFileSync(editedPath, edited, "utf8");

    plans[0].content = "generator wants to write this";
    const result = writeGeneratedAgents(tmpDir, plans, { regenerate: true });

    assert.strictEqual(result.regenerated.length, 1, "only the untouched file is regenerated");
    assert.deepStrictEqual(result.keptDrifted, [path.relative(tmpDir, editedPath)]);
    assert.strictEqual(fs.readFileSync(editedPath, "utf8"), edited, "user edits must survive");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("regenerate never touches an existing file that is not in the manifest", () => {
    const tmpDir = setupProject("agent-gen-unknown-");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 1), resources, null);

    // Hand-made file with a generated-style name and no manifest entry.
    fs.mkdirSync(path.join(tmpDir, ".pi", "agents"), { recursive: true });
    fs.writeFileSync(agentFile(tmpDir, plans[0].agentName), "HAND_MADE", "utf8");

    const result = writeGeneratedAgents(tmpDir, plans, { regenerate: true });
    assert.strictEqual(result.created.length, 0);
    assert.strictEqual(result.regenerated.length, 0);
    assert.strictEqual(result.skipped.length, 1);
    assert.strictEqual(fs.readFileSync(agentFile(tmpDir, plans[0].agentName), "utf8"), "HAND_MADE");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("previewRegeneration classifies recreate/overwrite/keptDrifted/unknown without writing", () => {
    const tmpDir = setupProject("agent-gen-preview-");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES.slice(0, 4), resources, null);
    writeGeneratedAgents(tmpDir, plans.slice(0, 3));

    const [toEdit, toKeep, toDelete, unknownPlan] = plans;
    // keptDrifted: user edit after generation
    fs.appendFileSync(agentFile(tmpDir, toEdit.agentName), "\nUSER EDIT", "utf8");
    // recreate: generated, then deleted
    fs.rmSync(agentFile(tmpDir, toDelete.agentName));
    // unknown: exists but never manifested
    fs.writeFileSync(agentFile(tmpDir, unknownPlan.agentName), "HAND_MADE", "utf8");

    const before = fs.readdirSync(path.join(tmpDir, ".pi", "agents")).sort();
    const preview = previewRegeneration(
      tmpDir,
      plans.map((p) => p.agentName),
    );
    const after = fs.readdirSync(path.join(tmpDir, ".pi", "agents")).sort();

    assert.deepStrictEqual(preview.overwrite, [path.relative(tmpDir, agentFile(tmpDir, toKeep.agentName))]);
    assert.deepStrictEqual(preview.keptDrifted, [path.relative(tmpDir, agentFile(tmpDir, toEdit.agentName))]);
    assert.deepStrictEqual(preview.recreate, [path.relative(tmpDir, agentFile(tmpDir, toDelete.agentName))]);
    assert.deepStrictEqual(preview.unknown, [path.relative(tmpDir, agentFile(tmpDir, unknownPlan.agentName))]);
    assert.deepStrictEqual(after, before, "preview must not write anything");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ----- Testing discipline pinning (Plan v2.0, Change 16) -----

  it("test-skeleton mandate carries the testing-discipline keywords", () => {
    const def = GENERATED_ROLES.find((r) => r.role === "test-skeleton");
    assert.ok(def, "test-skeleton role must exist");
    const mandate = def.mandate;
    // Required keywords that the test-skeleton agent must see in its mandate.
    const required = [
      "AAA",
      "Equivalence partitioning",
      "Boundary value analysis",
      "naming convention",
      "table-driven",
      "property-based",
      "RED",
      "zero-assertion",
      "mystery guest",
      "over-mocking",
      "mirror-logic",
    ];
    for (const kw of required) {
      assert.ok(
        mandate.toLowerCase().includes(kw.toLowerCase()),
        `test-skeleton mandate must contain "${kw}"; got: ${mandate}`,
      );
    }
  });

  it("test-skeleton mandate does not balloon past 25% over the prior size", () => {
    const def = GENERATED_ROLES.find((r) => r.role === "test-skeleton");
    assert.ok(def, "test-skeleton role must exist");
    // Pre-discipline mandate was ~115 chars. Allow 25% headroom.
    assert.ok(
      def.mandate.length <= 700,
      `test-skeleton mandate grew too large (${def.mandate.length} chars); consider trimming`,
    );
  });

  it("only test-skeleton carries the test-design discipline keywords (no cross-contamination)", () => {
    // test-skeleton owns the test-DESIGN discipline (AAA, EP, BVA, naming, table-driven, property-based).
    // linter and full-test are testing-adjacent and may mention anti-pattern names — they should
    // NOT carry the design keywords like Equivalence partitioning or Boundary value analysis.
    const designOnlyKeywords = [
      "Equivalence partitioning",
      "Boundary value analysis",
      "table-driven",
      "property-based",
      "naming convention",
    ];
    const defs = GENERATED_ROLES.filter((r) =>
      ["linter", "full-test", "scout-2", "scout-3", "scout-4", "discussion", "plan-overview", "security-gate", "archive"].includes(r.role),
    );
    for (const def of defs) {
      for (const kw of designOnlyKeywords) {
        assert.ok(
          !def.mandate.includes(kw),
          `${def.role} mandate must NOT carry the test-design keyword "${kw}"; that belongs to test-skeleton only`,
        );
      }
    }
  });

  it("linter mandate carries the testing-adjacent anti-pattern awareness (Q3)", () => {
    const def = GENERATED_ROLES.find((r) => r.role === "linter");
    assert.ok(def, "linter role must exist");
    const mandate = def.mandate;
    const required = [
      "testPaths",
      "anti-pattern",          // linter flags anti-patterns when scanning tests
      "zero-assertion",
      "over-mocking",
      "mirror-logic",
      "blocking",
      "Do not auto-fix",
    ];
    for (const kw of required) {
      assert.ok(
        mandate.toLowerCase().includes(kw.toLowerCase()),
        `linter mandate must mention "${kw}"; got: ${mandate}`,
      );
    }
  });

  it("full-test mandate requires zero skipped tests and named blockers (Q3)", () => {
    const def = GENERATED_ROLES.find((r) => r.role === "full-test");
    assert.ok(def, "full-test role must exist");
    const mandate = def.mandate;
    const required = [
      "exact error output",
      ".skip",
      "xfail",
      "TODO",
      "re-enable",
      "zero-assertion",
      "no tests discovered",
    ];
    for (const kw of required) {
      assert.ok(
        mandate.toLowerCase().includes(kw.toLowerCase()),
        `full-test mandate must mention "${kw}"; got: ${mandate}`,
      );
    }
  });

  it("linter and full-test mandates stay under 700 chars (no balloon)", () => {
    for (const role of ["linter", "full-test"]) {
      const def = GENERATED_ROLES.find((r) => r.role === role);
      assert.ok(def, `${role} role must exist`);
      assert.ok(
        def.mandate.length <= 700,
        `${role} mandate grew too large (${def.mandate.length} chars); consider trimming`,
      );
    }
  });

  it("test-skeleton generated agent body carries the full discipline rules (via the mandate block)", () => {
    const tmpDir = makeTmpDir("agent-gen-disciplineskel-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    const skelPlan = plans.find((p) => p.role === "test-skeleton");
    assert.ok(skelPlan, "test-skeleton plan must exist");
    const body = skelPlan.content;

    // The agent-generator embeds the mandate into the body. Every rule that
    // we promised in the skill must appear in the body, because that is what
    // the runtime agent actually reads.
    const required = ["AAA", "Equivalence partitioning", "Boundary value analysis", "naming convention",
      "table-driven", "property-based", "zero-assertion", "mystery guest",
      "over-mocking", "mirror-logic"];
    for (const kw of required) {
      assert.ok(body.toLowerCase().includes(kw.toLowerCase()), `test-skeleton body must mention "${kw}"`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ----- Generator v5 fine-tune pinning (Plan generator_finetune_v5) -----

  it("every GENERATED_ROLES row carries a non-empty invocationHint", () => {
    for (const def of GENERATED_ROLES) {
      assert.ok(
        typeof def.invocationHint === "string" && def.invocationHint.length > 0,
        `${def.role} must carry a non-empty invocationHint so the YAML description is a real trigger`,
      );
    }
  });

  it("every GENERATED_ROLES row carries an outOfScope array of length >= 1", () => {
    for (const def of GENERATED_ROLES) {
      assert.ok(
        Array.isArray(def.outOfScope) && def.outOfScope.length >= 1,
        `${def.role} must carry at least one outOfScope entry so the agent knows its boundary`,
      );
    }
  });

  it("test-skeleton invocationHint names 'failing test stubs' and outOfScope forbids implementation", () => {
    const def = GENERATED_ROLES.find((r) => r.role === "test-skeleton");
    assert.ok(def, "test-skeleton role must exist");
    assert.ok(
      def.invocationHint.toLowerCase().includes("failing test stub"),
      `test-skeleton invocationHint must name 'failing test stubs'; got: ${def.invocationHint}`,
    );
    const joined = def.outOfScope.join(" ").toLowerCase();
    assert.ok(
      joined.includes("do not implement source code"),
      `test-skeleton outOfScope must forbid implementing source code; got: ${def.outOfScope}`,
    );
  });

  it("generated agent body contains a '## Out of scope' section between mandate and completion contract", () => {
    const tmpDir = makeTmpDir("agent-gen-outofscope-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    for (const plan of plans) {
      const body = plan.content;
      assert.ok(body.includes("## Out of scope"), `${plan.agentName} body must include '## Out of scope'`);
      // Section order: Your mandate -> Out of scope -> Completion contract
      const mandateIdx = body.indexOf("## Your mandate");
      const outOfScopeIdx = body.indexOf("## Out of scope");
      const contractIdx = body.indexOf("## Completion contract");
      assert.ok(mandateIdx >= 0, `${plan.agentName}: missing Your mandate`);
      assert.ok(outOfScopeIdx > mandateIdx, `${plan.agentName}: Out of scope must follow Your mandate`);
      assert.ok(contractIdx > outOfScopeIdx, `${plan.agentName}: Completion contract must follow Out of scope`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generated agent body description contains the invocationHint as the auto-invocation trigger", () => {
    const tmpDir = makeTmpDir("agent-gen-descrtrigger-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const resources = discoverTechnologyResources(tmpDir);
    const plans = planAgentGeneration(tmpDir, GENERATED_ROLES, resources, makeReport());

    for (const plan of plans) {
      const def = GENERATED_ROLES.find((d) => d.role === plan.role);
      assert.ok(def, `${plan.role} role def must exist`);
      // Extract the YAML description from the frontmatter.
      const frontmatterMatch = plan.content.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(frontmatterMatch, `${plan.agentName}: missing YAML frontmatter`);
      const frontmatter = frontmatterMatch![1];
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      assert.ok(descMatch, `${plan.agentName}: missing description: in frontmatter`);
      const desc = descMatch![1];
      assert.ok(
        desc.includes(def.invocationHint),
        `${plan.agentName}: description must start with invocationHint ("${def.invocationHint}"); got: ${desc}`,
      );
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GENERATOR_VERSION is bumped to 5", () => {
    assert.strictEqual(GENERATOR_VERSION, 5, "GENERATOR_VERSION must be 5 after the v5 fine-tune");
  });
});
