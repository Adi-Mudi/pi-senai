import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  GENERATED_ROLES,
  discoverTechnologyResources,
  matchTechnologies,
  planAgentGeneration,
  writeGeneratedAgents,
} from "../src/agent-generator.js";
import { saveArchitectReport, slugify } from "../src/architect.js";

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
});
