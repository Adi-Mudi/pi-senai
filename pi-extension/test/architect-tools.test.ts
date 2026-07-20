import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { registerArchitectTools } from "../src/architect-tools.js";
import { saveArchitectProfile, saveArchitectReport } from "../src/architect.js";
import { saveArchitectInputsConfig } from "../src/architect-inputs-config.js";
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
    assert.ok(tools.has("senai_merge_architect_drivers"));
    assert.ok(tools.has("senai_finalize_architecture"));
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
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.ok(result.details);
    assert.strictEqual(result.details.functionalRequirements, 2);
    assert.strictEqual(result.details.qualityAttributes, 1);
    assert.strictEqual(result.details.uncertainties, 1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool ingests legacy driver files and deletes them", async () => {
    const tmpDir = makeTmpDir("arch-tools-legacy-");
    const legacyDir = path.join(tmpDir, ".pi", "senai");
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
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 1);
    assert.strictEqual(result.details.deletedLegacy.length, 1);
    assert.ok(!fs.existsSync(path.join(legacyDir, "drivers-prd.json")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool ignores malformed legacy files", async () => {
    const tmpDir = makeTmpDir("arch-tools-bad-legacy-");
    const legacyDir = path.join(tmpDir, ".pi", "senai");
    fs.mkdirSync(legacyDir, { recursive: true });

    fs.writeFileSync(path.join(legacyDir, "drivers-bad.json"), "{ not valid", "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 0);
    assert.strictEqual(result.details.deletedLegacy.length, 1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool fails when profile is missing", async () => {
    const tmpDir = makeTmpDir("arch-tools-no-profile-");
    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

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
    const result = await tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

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
    const result = await tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

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
    const result = await tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.ok(result.details.docs.length > 0);
    assert.ok(result.details.agents.length > 0);
    assert.ok(result.details.skills.length > 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool auto-maps architecture-bound roles in agents.json", async () => {
    const tmpDir = makeTmpDir("arch-tools-automap-");
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
    const result = await tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.deepStrictEqual(result.details.mappedRoles, [
      "scout-1",
      "planner",
      "implementer",
      "reviewer-correctness",
      "reviewer-security",
      "reviewer-tests",
      "code-review",
    ]);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(saved.agents["scout-1"], "test-project-modular-monolith-planner");
    assert.strictEqual(saved.agents["planner"], "test-project-modular-monolith-planner");
    assert.strictEqual(saved.agents["implementer"], "test-project-modular-monolith-implementer");
    assert.strictEqual(saved.agents["reviewer-correctness"], "test-project-modular-monolith-reviewer-correctness");
    assert.strictEqual(saved.agents["reviewer-security"], "test-project-modular-monolith-reviewer-security");
    assert.strictEqual(saved.agents["reviewer-tests"], "test-project-modular-monolith-reviewer-tests");
    assert.strictEqual(saved.agents["code-review"], "test-project-modular-monolith-reviewer-correctness");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool only merges configured documents and deletes stale map files", async () => {
    const tmpDir = makeTmpDir("arch-tools-stale-map-");
    const mapDir = getArchitectMapDir(tmpDir);
    fs.mkdirSync(mapDir, { recursive: true });

    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [
        { type: "prd", path: "docs/PRD.md" },
        { type: "nfr", path: "docs/NFR.md" },
      ],
      additionalConstraints: [],
    });

    const mkOutput = (doc: string, fr: string) => ({
      document: doc,
      documentType: "prd",
      functionalRequirements: [{ id: fr, description: fr }],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    });
    fs.writeFileSync(path.join(mapDir, "docs-PRD.md.json"), JSON.stringify(mkOutput("docs/PRD.md", "FR-1")), "utf8");
    fs.writeFileSync(path.join(mapDir, "docs-NFR.md.json"), JSON.stringify(mkOutput("docs/NFR.md", "FR-2")), "utf8");
    fs.writeFileSync(path.join(mapDir, "docs-OLD.md.json"), JSON.stringify(mkOutput("docs/OLD.md", "FR-OLD")), "utf8");
    fs.writeFileSync(
      path.join(mapDir, "architect-documents.json"),
      JSON.stringify({ version: 1, documents: [], mapOutputs: [], reducedDriversPath: "" }),
      "utf8",
    );

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 2);
    assert.strictEqual(result.details.deletedStaleMapFiles.length, 1);
    assert.ok(result.details.deletedStaleMapFiles[0].includes("docs-OLD.md.json"));
    assert.ok(!fs.existsSync(path.join(mapDir, "docs-OLD.md.json")));
    assert.ok(fs.existsSync(path.join(mapDir, "docs-PRD.md.json")));
    assert.ok(fs.existsSync(path.join(mapDir, "architect-documents.json")), "manifest must be kept");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool keeps all map files when no inputs config exists", async () => {
    const tmpDir = makeTmpDir("arch-tools-noconfig-");
    const mapDir = getArchitectMapDir(tmpDir);
    fs.mkdirSync(mapDir, { recursive: true });

    const output = {
      document: "docs/PRD.md",
      documentType: "prd",
      functionalRequirements: [{ id: "FR-1", description: "Do X" }],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, "docs-PRD.md.json"), JSON.stringify(output), "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 1);
    assert.deepStrictEqual(result.details.deletedStaleMapFiles, []);
    assert.ok(fs.existsSync(path.join(mapDir, "docs-PRD.md.json")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool removes orphan agents and skills from previous architectures", async () => {
    const tmpDir = makeTmpDir("arch-tools-orphans-");
    const libDir = path.join(tmpDir, ".pi", "architecture-library");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "hexagonal.md"),
      "---\nname: hexagonal\ncomplexity: low\nbest-for-drivers:\n  - small team\n---\n# Hexagonal\n",
      "utf8",
    );

    saveArchitectProfile(tmpDir, {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "hexagonal",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    });
    saveArchitectReport(tmpDir, {
      selectedArchitecture: "hexagonal",
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

    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "test-project-monolith-planner.md"), "old", "utf8");
    fs.writeFileSync(path.join(agentsDir, "my-helper.md"), "user", "utf8");
    const oldSkillDir = path.join(tmpDir, ".pi", "skills", "test-project-monolith-plan");
    fs.mkdirSync(oldSkillDir, { recursive: true });
    fs.writeFileSync(path.join(oldSkillDir, "SKILL.md"), "old", "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.ok(fs.existsSync(path.join(agentsDir, "test-project-hexagonal-planner.md")));
    assert.ok(!fs.existsSync(path.join(agentsDir, "test-project-monolith-planner.md")));
    assert.ok(!fs.existsSync(oldSkillDir));
    assert.ok(fs.existsSync(path.join(agentsDir, "my-helper.md")));
    assert.strictEqual(result.details.removedStaleArtifacts.length, 2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool sweeps all map files when the config has an empty document list", async () => {
    const tmpDir = makeTmpDir("arch-tools-empty-docs-");
    const mapDir = getArchitectMapDir(tmpDir);
    fs.mkdirSync(mapDir, { recursive: true });

    saveArchitectInputsConfig(tmpDir, { version: 1, documents: [], additionalConstraints: [] });

    const output = {
      document: "docs/PRD.md",
      documentType: "prd",
      functionalRequirements: [{ id: "FR-1", description: "Do X" }],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, "docs-PRD.md.json"), JSON.stringify(output), "utf8");
    fs.writeFileSync(
      path.join(mapDir, "architect-documents.json"),
      JSON.stringify({ version: 1, documents: [], mapOutputs: [], reducedDriversPath: "" }),
      "utf8",
    );

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 0);
    assert.strictEqual(result.details.deletedStaleMapFiles.length, 1);
    assert.ok(!fs.existsSync(path.join(mapDir, "docs-PRD.md.json")));
    assert.ok(fs.existsSync(path.join(mapDir, "architect-documents.json")), "manifest must be kept");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool keeps but does not merge a file whose content document mismatches its name", async () => {
    const tmpDir = makeTmpDir("arch-tools-mismatch-");
    const mapDir = getArchitectMapDir(tmpDir);
    fs.mkdirSync(mapDir, { recursive: true });

    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: [],
    });

    const mismatched = {
      document: "docs/OTHER.md",
      documentType: "prd",
      functionalRequirements: [{ id: "FR-OTHER", description: "Wrong content" }],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, "docs-PRD.md.json"), JSON.stringify(mismatched), "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 0);
    assert.deepStrictEqual(result.details.deletedStaleMapFiles, []);
    assert.ok(fs.existsSync(path.join(mapDir, "docs-PRD.md.json")), "file kept because its name matches a configured doc");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool deletes malformed stale map files without crashing", async () => {
    const tmpDir = makeTmpDir("arch-tools-malformed-");
    const mapDir = getArchitectMapDir(tmpDir);
    fs.mkdirSync(mapDir, { recursive: true });

    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/PRD.md" }],
      additionalConstraints: [],
    });

    const valid = {
      document: "docs/PRD.md",
      documentType: "prd",
      functionalRequirements: [{ id: "FR-1", description: "Do X" }],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, "docs-PRD.md.json"), JSON.stringify(valid), "utf8");
    fs.writeFileSync(path.join(mapDir, "docs-BROKEN.md.json"), "{ not valid json", "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 1);
    assert.strictEqual(result.details.deletedStaleMapFiles.length, 1);
    assert.ok(!fs.existsSync(path.join(mapDir, "docs-BROKEN.md.json")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool writes a generation manifest with content hashes", async () => {
    const tmpDir = makeTmpDir("arch-tools-manifest-");
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
      adrs: [{ id: "0001", title: "First decision", context: "c", decision: "d", consequences: "x" }],
      constraints: [],
    });

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    const manifestPath = path.join(tmpDir, ".pi", "architect", "generated-manifest.json");
    assert.ok(fs.existsSync(manifestPath), "manifest should exist after finalize");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.strictEqual(manifest.version, 1);
    assert.ok(typeof manifest.generatedAt === "string");

    const expectedCount = result.details.docs.length + result.details.agents.length + result.details.skills.length;
    assert.strictEqual(Object.keys(manifest.files).length, expectedCount);
    assert.strictEqual(result.details.manifestFiles, expectedCount);

    for (const [rel, hash] of Object.entries(manifest.files)) {
      const actual = createHash("sha256").update(fs.readFileSync(path.join(tmpDir, rel))).digest("hex");
      assert.strictEqual(actual, hash, `hash mismatch for ${rel}`);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool with an empty map dir writes an all-empty drivers file", async () => {
    const tmpDir = makeTmpDir("arch-tools-merge-empty-");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.functionalRequirements, 0);
    assert.strictEqual(result.details.qualityAttributes, 0);
    assert.strictEqual(result.details.constraints, 0);
    assert.strictEqual(result.details.technicalConcerns, 0);
    assert.strictEqual(result.details.uncertainties, 0);

    const driversPath = path.join(tmpDir, ".pi", "architect", "architectural-drivers.json");
    assert.ok(fs.existsSync(driversPath), "merged drivers file should exist");
    const saved = JSON.parse(fs.readFileSync(driversPath, "utf8"));
    assert.deepStrictEqual(saved, {
      functionalRequirements: [],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool deletes the legacy root architectural-drivers.json", async () => {
    const tmpDir = makeTmpDir("arch-tools-legacy-root-");
    const legacyDir = path.join(tmpDir, ".pi", "senai");
    fs.mkdirSync(legacyDir, { recursive: true });
    const oldMerged = path.join(legacyDir, "architectural-drivers.json");
    fs.writeFileSync(oldMerged, JSON.stringify(createEmptyDrivers()), "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.ok(!fs.existsSync(oldMerged), "legacy merged file should be deleted");
    assert.deepStrictEqual(result.details.deletedLegacy, [".pi/senai/architectural-drivers.json"]);
    assert.strictEqual(result.details.functionalRequirements, 0, "old merged file is deleted, not merged");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge tool deletes a legacy file with valid JSON but unknown shape without merging it", async () => {
    const tmpDir = makeTmpDir("arch-tools-legacy-shape-");
    const legacyDir = path.join(tmpDir, ".pi", "senai");
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, "drivers-weird.json");
    fs.writeFileSync(legacyFile, JSON.stringify({ foo: 1 }), "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_merge_architect_drivers").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.ok(!fs.existsSync(legacyFile), "unknown-shape legacy file should be deleted");
    assert.deepStrictEqual(result.details.deletedLegacy, [".pi/senai/drivers-weird.json"]);
    assert.strictEqual(result.details.functionalRequirements, 0);
    assert.strictEqual(result.details.qualityAttributes, 0);
    assert.strictEqual(result.details.constraints, 0);
    assert.strictEqual(result.details.technicalConcerns, 0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function saveFinalizeFixtures(
    tmpDir: string,
    options: { profileArch: string; reportArch: string; libraryName: string },
  ): void {
    const libDir = path.join(tmpDir, ".pi", "architecture-library");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "entry.md"),
      `---\nname: ${options.libraryName}\ncomplexity: low\nbest-for-drivers:\n  - small team\n---\n# Entry\n`,
      "utf8",
    );
    saveArchitectProfile(tmpDir, {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: options.profileArch,
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    });
    saveArchitectReport(tmpDir, {
      selectedArchitecture: options.reportArch,
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
  }

  it("finalize tool resolves the architecture via the report when the profile id is not in the library", async () => {
    const tmpDir = makeTmpDir("arch-tools-report-fallback-");
    saveFinalizeFixtures(tmpDir, {
      profileArch: "custom-arch",
      reportArch: "modular-monolith",
      libraryName: "modular-monolith",
    });

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.error, undefined);
    assert.strictEqual(result.details.agents.length, 5);
    assert.ok(
      fs.existsSync(path.join(tmpDir, ".pi", "agents", "test-project-modular-monolith-planner.md")),
      "agents are named after the resolved library entry id",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool resolves the architecture by entry name matching the profile selection", async () => {
    const tmpDir = makeTmpDir("arch-tools-name-match-");
    saveFinalizeFixtures(tmpDir, {
      profileArch: "Modular Monolith",
      reportArch: "something-else",
      libraryName: "Modular Monolith",
    });

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    const result = await tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir));

    assert.strictEqual(result.details.error, undefined);
    assert.strictEqual(result.details.agents.length, 5);
    assert.ok(
      fs.existsSync(path.join(tmpDir, ".pi", "agents", "test-project-modular-monolith-planner.md")),
      "agent names use the slugified library entry id",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool rejects when agents.json is corrupted, before writing any artifacts", async () => {
    const tmpDir = makeTmpDir("arch-tools-corrupt-agents-");
    saveFinalizeFixtures(tmpDir, {
      profileArch: "modular-monolith",
      reportArch: "modular-monolith",
      libraryName: "modular-monolith",
    });
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "{ not valid json", "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    await assert.rejects(
      () => tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir)),
      /Invalid agent config/,
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, ".pi", "architect", "architecture.md")),
      "no architecture docs written when the config is corrupted",
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, ".pi", "agents")),
      "no agents written when the config is corrupted",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finalize tool rejects when architect-profile.json is malformed", async () => {
    const tmpDir = makeTmpDir("arch-tools-bad-profile-");
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "architect", "architect-profile.json"), "{ not valid", "utf8");

    const { pi, tools } = makeMockPi();
    registerArchitectTools(pi);
    await assert.rejects(
      () => tools.get("senai_finalize_architecture").execute("1", {}, undefined, () => {}, makeCtx(tmpDir)),
      /Invalid architect profile/,
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
