import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  areDriversStale,
  buildArchitectPrompt,
  discoverArchitectureLibrary,
  generateAgentFiles,
  generateArchitectureDocs,
  generateSkillFiles,
  getArchitectProfilePath,
  getArchitectReportPath,
  loadArchitectProfile,
  loadArchitectReport,
  saveArchitectProfile,
  saveArchitectReport,
  selectArchitecture,
  slugify,
} from "../src/architect.js";
import type { ArchitectProfile, ArchitectureLibraryEntry } from "../src/architect.js";
import { createEmptyDrivers } from "../src/driver-extractor.js";

describe("architect", () => {
  it("slugify converts text to slug", () => {
    assert.strictEqual(slugify("My Project Name"), "my-project-name");
    assert.strictEqual(slugify("Inventory Web App"), "inventory-web-app");
  });

  it("getArchitectProfilePath returns correct path", () => {
    assert.strictEqual(
      getArchitectProfilePath("/fake"),
      path.join("/fake", ".pi/orchestra/architect-profile.json"),
    );
  });

  it("getArchitectReportPath returns correct path", () => {
    assert.strictEqual(
      getArchitectReportPath("/fake"),
      path.join("/fake", ".pi/orchestra/architect-report.json"),
    );
  });

  it("saveArchitectProfile and loadArchitectProfile round-trip", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prof-"));
    const profile: ArchitectProfile = {
      projectName: "Inventory App",
      projectSlug: "inventory-app",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
    saveArchitectProfile(tmpDir, profile);
    const loaded = loadArchitectProfile(tmpDir);
    assert.deepStrictEqual(loaded, profile);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveArchitectReport and loadArchitectReport round-trip", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-rep-"));
    const report = {
      selectedArchitecture: "modular-monolith",
      confidence: "high" as const,
      missingResources: [],
      reasoning: "Small team, simple deployment.",
      skillProfile: { recommendedAgents: ["planner"], forbiddenPatterns: ["microservices"] },
      developmentOrder: ["Set up project"],
      feasibility: "feasible" as const,
      feasibilityReasoning: "Drivers are clear and the library entry matches.",
      techStack: ["TypeScript", "Node.js"],
      atomicFunctions: ["create-item"],
      systemOverview: "Inventory web app.",
      components: [{ name: "API", responsibility: "Handle requests", dependencies: ["Database"] }],
      interfaces: [{ name: "REST API", type: "external" as const, description: "HTTP JSON API" }],
      dataFlow: "Client -> API -> Database",
      dataModel: "Items, orders",
      deployment: "Single Node.js process",
      qualityAttributeMapping: [{ qualityAttribute: "consistency", decision: "Single database" }],
      adrs: [{ id: "0001", title: "Use modular monolith", context: "Small team.", decision: "Modular monolith.", consequences: "Simple deployment." }],
      constraints: ["Small team"],
    };
    saveArchitectReport(tmpDir, report);
    const loaded = loadArchitectReport(tmpDir);
    assert.deepStrictEqual(loaded, report);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discoverArchitectureLibrary reads library entries", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-lib-"));
    const libDir = path.join(tmpDir, ".pi", "architecture-library");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "modular-monolith.md"),
      "---\nname: modular-monolith\ncomplexity: low\nbest-for-drivers:\n  - small team\n---\n# Modular Monolith\n",
      "utf8",
    );
    const entries = discoverArchitectureLibrary(tmpDir);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].name, "modular-monolith");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("selectArchitecture picks modular monolith for small team", () => {
    const drivers = createEmptyDrivers();
    drivers.constraints.push({ id: "C-1", category: "team-size", description: "small team" });
    drivers.technicalConcerns.push({ id: "TC-1", description: "web app" });

    const library: ArchitectureLibraryEntry[] = [
      {
        name: "modular-monolith",
        filePath: "",
        domain: ["web"],
        teamSize: "small",
        complexity: "low",
        bestForDrivers: ["small team"],
        notForDrivers: ["large independent teams"],
        content: "",
      },
      {
        name: "microservices",
        filePath: "",
        domain: ["web"],
        teamSize: "large",
        complexity: "high",
        bestForDrivers: ["large independent teams"],
        notForDrivers: ["small team"],
        content: "",
      },
    ];

    const selected = selectArchitecture(drivers, library);
    assert.strictEqual(selected?.name, "modular-monolith");
  });

  it("generateAgentFiles creates files with correct names", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-gen-"));
    const profile: ArchitectProfile = {
      projectName: "Inventory App",
      projectSlug: "inventory-app",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
    const entry: ArchitectureLibraryEntry = {
      name: "modular-monolith",
      filePath: "",
      domain: ["web"],
      teamSize: "small",
      complexity: "low",
      bestForDrivers: ["small team"],
      notForDrivers: ["large independent teams"],
      content: "# Modular Monolith\n\n## Core rules\n1. Keep the app as a single deployable unit.\n",
    };
    const created = generateAgentFiles(tmpDir, profile, entry);
    assert.strictEqual(created.length, 5);
    assert.ok(created.every((p) => p.includes("inventory-app-modular-monolith")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateSkillFiles creates files with correct names", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-gen-"));
    const profile: ArchitectProfile = {
      projectName: "Inventory App",
      projectSlug: "inventory-app",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
    const entry: ArchitectureLibraryEntry = {
      name: "modular-monolith",
      filePath: "",
      domain: ["web"],
      teamSize: "small",
      complexity: "low",
      bestForDrivers: ["small team"],
      notForDrivers: ["large independent teams"],
      content: "",
    };
    const created = generateSkillFiles(tmpDir, profile, entry);
    assert.strictEqual(created.length, 4);
    assert.ok(created.every((p) => p.includes("inventory-app-modular-monolith")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("buildArchitectPrompt includes project name and architecture", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prompt-"));
    const profile: ArchitectProfile = {
      projectName: "Inventory App",
      projectSlug: "inventory-app",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
    const prompt = buildArchitectPrompt(tmpDir, profile);
    assert.match(prompt, /Inventory App/);
    assert.match(prompt, /modular-monolith/);
    assert.match(prompt, /Architect Generation Task/);
    assert.match(prompt, /feasibility/);
    assert.match(prompt, /architecture\.md/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateArchitectureDocs creates architecture.md and ADRs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-docs-"));
    const profile: ArchitectProfile = {
      projectName: "Inventory App",
      projectSlug: "inventory-app",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
    const report = {
      selectedArchitecture: "modular-monolith" as const,
      confidence: "high" as const,
      missingResources: [],
      reasoning: "Small team.",
      skillProfile: { recommendedAgents: ["planner"], forbiddenPatterns: [] },
      developmentOrder: ["Set up project"],
      feasibility: "feasible" as const,
      feasibilityReasoning: "Clear drivers.",
      techStack: ["TypeScript"],
      atomicFunctions: ["create-item"],
      systemOverview: "Inventory web app.",
      components: [{ name: "API", responsibility: "Handle requests", dependencies: [] }],
      interfaces: [],
      dataFlow: "",
      dataModel: "",
      deployment: "",
      qualityAttributeMapping: [],
      adrs: [{ id: "0001", title: "Use modular monolith", context: "Small team.", decision: "Modular monolith.", consequences: "Simple deployment." }],
      constraints: [],
    };
    const created = generateArchitectureDocs(tmpDir, profile, report);
    assert.ok(created.some((p) => p.endsWith("architecture.md")));
    assert.ok(created.some((p) => p.includes("adrs/0001-use-modular-monolith.md")));

    const architecturePath = path.join(tmpDir, ".pi", "orchestra", "architecture.md");
    const architectureContent = fs.readFileSync(architecturePath, "utf8");
    assert.ok(architectureContent.includes("Software Architecture"));
    assert.ok(architectureContent.includes("Use modular monolith"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateAgentFiles references architecture documents", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-agent-docs-"));
    const profile: ArchitectProfile = {
      projectName: "Inventory App",
      projectSlug: "inventory-app",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
    const entry: ArchitectureLibraryEntry = {
      name: "modular-monolith",
      filePath: "",
      domain: ["web"],
      teamSize: "small",
      complexity: "low",
      bestForDrivers: ["small team"],
      notForDrivers: [],
      content: "",
    };
    generateAgentFiles(tmpDir, profile, entry);
    const agentPath = path.join(tmpDir, ".pi", "agents", "inventory-app-modular-monolith-planner.md");
    const content = fs.readFileSync(agentPath, "utf8");
    assert.ok(content.includes("architecture.md"));
    assert.ok(content.includes("ADRs"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("areDriversStale returns true when drivers are missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-stale-"));
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");
    const inputsConfig = {
      version: 1 as const,
      documents: [{ type: "prd" as const, path: "docs/PRD.md" }],
      additionalConstraints: [],
    };
    assert.strictEqual(areDriversStale(tmpDir, inputsConfig), true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("areDriversStale returns true when input is newer than drivers", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-stale-"));
    const docsDir = path.join(tmpDir, "docs");
    const driversDir = path.join(tmpDir, ".pi", "orchestra");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.mkdirSync(driversDir, { recursive: true });

    const driversPath = path.join(driversDir, "architectural-drivers.json");
    fs.writeFileSync(driversPath, "{}", "utf8");
    const oldTime = new Date(Date.now() - 10000);
    fs.utimesSync(driversPath, oldTime, oldTime);

    fs.writeFileSync(path.join(docsDir, "PRD.md"), "# PRD", "utf8");

    const inputsConfig = {
      version: 1 as const,
      documents: [{ type: "prd" as const, path: "docs/PRD.md" }],
      additionalConstraints: [],
    };
    assert.strictEqual(areDriversStale(tmpDir, inputsConfig), true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
