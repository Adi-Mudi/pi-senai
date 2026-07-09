import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerArchitectTools } from "../src/architect-tools.js";
import { saveArchitectProfile, saveArchitectReport } from "../src/architect.js";
import { createEmptyDrivers } from "../src/driver-extractor.js";
import { getArchitectMapDir } from "../src/constants.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeMockPi(): {
  pi: any;
  tools: Map<string, any>;
} {
  const tools = new Map<string, any>();
  return {
    pi: {
      registerTool: (tool: any) => {
        tools.set(tool.name, tool);
      },
    },
    tools,
  };
}

function makeCtx(cwd: string): any {
  return { cwd };
}

describe("architect-tools", () => {
  it("registers both architect tools", () => {
    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    assert.strictEqual(tools.size, 2);
    assert.ok(tools.has("orchestra_merge_architect_drivers"));
    assert.ok(tools.has("orchestra_finalize_architecture"));
  });

  it("merge tool merges map outputs", async () => {
    const tmpDir = makeTmpDir("arch-tools-merge-");
    const mapDir = getArchitectMapDir(tmpDir);
    fs.mkdirSync(mapDir, { recursive: true });

    const output1 = {
      document: "docs/PRD.md",
      documentType: "prd",
      functionalRequirements: [{ id: "FR-1", description: "Do X" }],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    const output2 = {
      document: "docs/NFR.md",
      documentType: "nfr",
      functionalRequirements: [{ id: "FR-2", description: "Do Y" }],
      qualityAttributes: [{ id: "QA-1", category: "scale", description: "Scale" }],
      constraints: [],
      technicalConcerns: [],
      uncertainties: ["U1"],
    };
    fs.writeFileSync(path.join(mapDir, "docs-PRD.md.json"), JSON.stringify(output1), "utf8");
    fs.writeFileSync(path.join(mapDir, "docs-NFR.md.json"), JSON.stringify(output2), "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("orchestra_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.ok(result.details);
    assert.strictEqual(result.details.functionalRequirements, 2);
    assert.strictEqual(result.details.qualityAttributes, 1);
    assert.strictEqual(result.details.uncertainties, 1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool ingests legacy driver files and deletes them", async () => {
    const tmpDir = makeTmpDir("arch-tools-legacy-");
    const legacyDir = path.join(tmpDir, ".pi", "orchestra");
    fs.mkdirSync(legacyDir, { recursive: true });

    const legacyDrivers = {
      functionalRequirements: [{ id: "FR-LEGACY", description: "Legacy" }],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(legacyDir, "drivers-prd.json"), JSON.stringify(legacyDrivers), "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("orchestra_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 1);
    assert.strictEqual(result.details.deletedLegacy.length, 1);
    assert.ok(!fs.existsSync(path.join(legacyDir, "drivers-prd.json")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool ignores malformed legacy files", async () => {
    const tmpDir = makeTmpDir("arch-tools-bad-legacy-");
    const legacyDir = path.join(tmpDir, ".pi", "orchestra");
    fs.mkdirSync(legacyDir, { recursive: true });

    fs.writeFileSync(path.join(legacyDir, "drivers-bad.json"), "{ not valid", "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("orchestra_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 0);
    assert.strictEqual(result.details.deletedLegacy.length, 1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool fails when profile is missing", async () => {
    const tmpDir = makeTmpDir("arch-tools-no-profile-");
    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("orchestra_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.error, "missing profile");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool fails when report is missing", async () => {
    const tmpDir = makeTmpDir("arch-tools-no-report-");
    saveArchitectProfile(tmpDir, {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    });

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("orchestra_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.error, "missing report");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool fails when architecture is not in library", async () => {
    const tmpDir = makeTmpDir("arch-tools-no-arch-");
    saveArchitectProfile(tmpDir, {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "missing-arch",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    });
    saveArchitectReport(tmpDir, {
      selectedArchitecture: "missing-arch",
      confidence: "high",
      missingResources: [],
      reasoning: "Small team.",
      skillProfile: { recommendedAgents: [], forbiddenPatterns: [] },
      developmentOrder: [],
      feasibility: "feasible",
      feasibilityReasoning: "Clear.",
      techStack: [],
      atomicFunctions: [],
      systemOverview: "",
      components: [],
      interfaces: [],
      dataFlow: "",
      dataModel: "",
      deployment: "",
      qualityAttributeMapping: [],
      adrs: [],
      constraints: [],
    });

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("orchestra_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.error, "architecture not found");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool generates docs, agents, and skills", async () => {
    const tmpDir = makeTmpDir("arch-tools-finalize-");
    const libDir = path.join(tmpDir, ".pi", "architecture-library");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "modular-monolith.md"),
      "---\nname: modular-monolith\ncomplexity: low\nbest-for-drivers:\n  - small team\n---\n# Modular Monolith\n",
      "utf8",
    );

    saveArchitectProfile(tmpDir, {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    });
    saveArchitectReport(tmpDir, {
      selectedArchitecture: "modular-monolith",
      confidence: "high",
      missingResources: [],
      reasoning: "Small team.",
      skillProfile: { recommendedAgents: [], forbiddenPatterns: [] },
      developmentOrder: [],
      feasibility: "feasible",
      feasibilityReasoning: "Clear.",
      techStack: [],
      atomicFunctions: [],
      systemOverview: "",
      components: [],
      interfaces: [],
      dataFlow: "",
      dataModel: "",
      deployment: "",
      qualityAttributeMapping: [],
      adrs: [],
      constraints: [],
    });

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("orchestra_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.ok(result.details.docs.length > 0);
    assert.ok(result.details.agents.length > 0);
    assert.ok(result.details.skills.length > 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
