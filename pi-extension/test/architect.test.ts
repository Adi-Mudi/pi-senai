import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  addToGeneratedManifest,
  areDriversStale,
  autoMapArchitectureAgents,
  buildArchitectPrompt,
  discoverArchitectureLibrary,
  generateAgentFiles,
  generateArchitectureDocs,
  generateSkillFiles,
  getArchitectProfilePath,
  getArchitectReportPath,
  isFeasible,
  loadArchitectProfile,
  loadArchitectReport,
  loadGeneratedManifest,
  migrateLegacyArchitectState,
  removeStaleArchitectureArtifacts,
  saveArchitectProfile,
  saveArchitectReport,
  selectArchitecture,
  slugify,
  writeGeneratedManifest,
} from "../src/architect.js";
import { saveAgentConfig } from "../src/agent-config.js";
import type { ArchitectProfile, ArchitectReport, ArchitectureLibraryEntry } from "../src/architect.js";
import { saveArchitectInputsConfig } from "../src/architect-inputs-config.js";
import type { ArchitectInputsConfig } from "../src/architect-inputs-config.js";
import { createEmptyDrivers } from "../src/driver-extractor.js";

describe("architect", () => {
  it("slugify converts text to slug", () => {
    assert.strictEqual(slugify("My Project Name"), "my-project-name");
    assert.strictEqual(slugify("Inventory Web App"), "inventory-web-app");
  });

  it("getArchitectProfilePath returns correct path", () => {
    assert.strictEqual(
      getArchitectProfilePath("/fake"),
      path.join("/fake", ".pi/architect/architect-profile.json"),
    );
  });

  it("getArchitectReportPath returns correct path", () => {
    assert.strictEqual(
      getArchitectReportPath("/fake"),
      path.join("/fake", ".pi/architect/architect-report.json"),
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

  it("loadArchitectProfile normalizes projectSlug from project field", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prof-legacy-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-profile.json"),
      JSON.stringify({
        projectName: "Nifty App",
        project: "nifty-app",
        selectedArchitecture: "gas-monolith",
      }),
      "utf8",
    );
    const loaded = loadArchitectProfile(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded!.projectSlug, "nifty-app");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectProfile derives projectSlug from projectName when missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prof-slug-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-profile.json"),
      JSON.stringify({
        projectName: "Nifty App",
        selectedArchitecture: "gas-monolith",
      }),
      "utf8",
    );
    const loaded = loadArchitectProfile(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded!.projectSlug, "nifty-app");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectProfile returns null when file is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prof-missing-"));
    assert.strictEqual(loadArchitectProfile(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectProfile throws on malformed JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prof-bad-json-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-profile.json"),
      "{ not valid",
      "utf8",
    );
    assert.throws(() => loadArchitectProfile(tmpDir), /Invalid architect profile/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectProfile throws on missing required fields", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prof-bad-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-profile.json"),
      JSON.stringify({ projectName: "Nifty App" }),
      "utf8",
    );
    assert.throws(() => loadArchitectProfile(tmpDir), /missing projectName, projectSlug, or selectedArchitecture/);
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

  it("loadArchitectReport returns null when file is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-rep-missing-"));
    assert.strictEqual(loadArchitectReport(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectReport throws on malformed JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-rep-bad-json-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-report.json"),
      "{ not valid",
      "utf8",
    );
    assert.throws(() => loadArchitectReport(tmpDir), /Invalid architect report/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectReport normalizes object ADRs with missing fields", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-rep-adr-obj-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-report.json"),
      JSON.stringify({
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
        adrs: [
          { id: "0001", title: "Use modular monolith" },
          { title: "Missing id" },
          { id: "0002", title: "" },
        ],
        constraints: [],
      }),
      "utf8",
    );
    const loaded = loadArchitectReport(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded!.adrs.length, 1);
    assert.strictEqual(loaded!.adrs[0].id, "0001");
    assert.strictEqual(loaded!.adrs[0].context, "");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectReport normalizes string ADRs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-rep-strings-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-report.json"),
      JSON.stringify({
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
        adrs: ["ADR-001: Use modular monolith", "Plain title without id"],
        constraints: [],
      }),
      "utf8",
    );
    const loaded = loadArchitectReport(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded!.adrs.length, 2);
    assert.strictEqual(loaded!.adrs[0].id, "ADR-001");
    assert.strictEqual(loaded!.adrs[0].title, "Use modular monolith");
    assert.strictEqual(loaded!.adrs[1].title, "Plain title without id");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("isFeasible returns true only for feasible reports", () => {
    const feasibleReport = { feasibility: "feasible" } as any;
    const riskyReport = { feasibility: "risky" } as any;
    const notFeasibleReport = { feasibility: "not-feasible" } as any;
    assert.strictEqual(isFeasible(feasibleReport), true);
    assert.strictEqual(isFeasible(riskyReport), false);
    assert.strictEqual(isFeasible(notFeasibleReport), false);
  });

  it("selectArchitecture returns null for empty library", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ id: "FR-1", description: "Small team" });
    assert.strictEqual(selectArchitecture(drivers, []), null);
  });

  it("selectArchitecture picks highest scoring entry", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ id: "FR-1", description: "Small team web app" });
    const library: ArchitectureLibraryEntry[] = [
      {
        id: "modular-monolith",
        name: "Modular Monolith",
        filePath: "",
        domain: ["web"],
        teamSize: "small",
        complexity: "low",
        bestForDrivers: ["small team"],
        notForDrivers: [],
        content: "",
      },
      {
        id: "microservices",
        name: "Microservices",
        filePath: "",
        domain: ["web"],
        teamSize: "large",
        complexity: "high",
        bestForDrivers: ["large team"],
        notForDrivers: [],
        content: "",
      },
    ];
    const selected = selectArchitecture(drivers, library);
    assert.ok(selected);
    assert.strictEqual(selected!.id, "modular-monolith");
  });

  it("selectArchitecture penalizes not-for drivers", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ id: "FR-1", description: "Small team" });
    const library: ArchitectureLibraryEntry[] = [
      {
        id: "modular-monolith",
        name: "Modular Monolith",
        filePath: "",
        domain: [],
        teamSize: "",
        complexity: "",
        bestForDrivers: ["small team"],
        notForDrivers: [],
        content: "",
      },
      {
        id: "microservices",
        name: "Microservices",
        filePath: "",
        domain: [],
        teamSize: "",
        complexity: "",
        bestForDrivers: ["small team", "distributed"],
        notForDrivers: ["small team"],
        content: "",
      },
    ];
    const selected = selectArchitecture(drivers, library);
    assert.ok(selected);
    assert.strictEqual(selected!.id, "modular-monolith");
  });

  it("areDriversStale returns true when drivers are missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-stale-missing-"));
    const config: ArchitectInputsConfig = {
      version: 1,
      documents: [{ type: "readme", path: "README.md" }],
      additionalConstraints: [],
    };
    assert.strictEqual(areDriversStale(tmpDir, config), true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("areDriversStale returns true when input is newer", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-stale-newer-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), "{}", "utf8");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# readme", "utf8");
    // Ensure README is newer.
    const now = Date.now();
    fs.utimesSync(path.join(tmpDir, "README.md"), now / 1000, (now + 1000) / 1000);
    const config: ArchitectInputsConfig = {
      version: 1,
      documents: [{ type: "readme", path: "README.md" }],
      additionalConstraints: [],
    };
    assert.strictEqual(areDriversStale(tmpDir, config), true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("areDriversStale returns false when drivers are newer", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-stale-ok-"));
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# readme", "utf8");
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), "{}", "utf8");
    const now = Date.now();
    fs.utimesSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), now / 1000, (now + 1000) / 1000);
    const config: ArchitectInputsConfig = {
      version: 1,
      documents: [{ type: "readme", path: "README.md" }],
      additionalConstraints: [],
    };
    assert.strictEqual(areDriversStale(tmpDir, config), false);
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
    assert.strictEqual(entries[0].id, "modular-monolith");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discoverArchitectureLibrary reads JSON library entries", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-lib-json-"));
    const libDir = path.join(tmpDir, ".pi", "architecture-library");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "library.json"),
      JSON.stringify([
        {
          id: "gas-sheets-monolith",
          name: "Google Apps Script + Google Sheets Monolith",
          description: "Serverless spreadsheet automation.",
          platform: "Google Workspace",
          runtime: "Google Apps Script",
          strengths: ["No hosting needed"],
          weaknesses: ["6-minute timeout"],
          bestForDrivers: ["google sheets"],
        },
      ]),
      "utf8",
    );
    const entries = discoverArchitectureLibrary(tmpDir);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].id, "gas-sheets-monolith");
    assert.strictEqual(entries[0].name, "Google Apps Script + Google Sheets Monolith");
    assert.ok(entries[0].content.includes("Google Workspace"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discoverArchitectureLibrary skips malformed files and falls back id from name", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-lib-malformed-"));
    const libDir = path.join(tmpDir, ".pi", "architecture-library");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "valid.md"),
      "---\nname: Valid Arch\ncomplexity: low\n---\n# Valid\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(libDir, "no-name.md"),
      "---\ncomplexity: low\n---\n# No Name\n",
      "utf8",
    );
    fs.writeFileSync(path.join(libDir, "bad.json"), "{ not valid", "utf8");

    const entries = discoverArchitectureLibrary(tmpDir);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].name, "Valid Arch");
    assert.strictEqual(entries[0].id, "valid-arch");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discoverArchitectureLibrary returns empty array when library dir is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-lib-missing-"));
    const entries = discoverArchitectureLibrary(tmpDir);
    assert.deepStrictEqual(entries, []);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("selectArchitecture picks modular monolith for small team", () => {
    const drivers = createEmptyDrivers();
    drivers.constraints.push({ id: "C-1", category: "team-size", description: "small team" });
    drivers.technicalConcerns.push({ id: "TC-1", description: "web app" });

    const library: ArchitectureLibraryEntry[] = [
      {
        id: "modular-monolith",
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
        id: "microservices",
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
      id: "modular-monolith",
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
      id: "modular-monolith",
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

    const architecturePath = path.join(tmpDir, ".pi", "architect", "architecture.md");
    const architectureContent = fs.readFileSync(architecturePath, "utf8");
    assert.ok(architectureContent.includes("Software Architecture"));
    assert.ok(architectureContent.includes("Use modular monolith"));
    assert.ok(architectureContent.includes("## Architecture diagrams"));
    assert.ok(architectureContent.includes("### System context"));
    assert.ok(architectureContent.includes("### Containers and components"));
    assert.ok(architectureContent.includes("### Typical interaction flow"));
    assert.ok(architectureContent.includes("```mermaid"));
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
      id: "modular-monolith",
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
    const driversDir = path.join(tmpDir, ".pi", "architect");
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

  it("migrateLegacyArchitectState moves files from .IDE_Plans/architect to .pi/architect", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-migrate-"));
    const legacyDir = path.join(tmpDir, ".IDE_Plans", "architect");
    const legacyMapDir = path.join(legacyDir, "architect-map");
    const targetDir = path.join(tmpDir, ".pi", "architect");
    fs.mkdirSync(legacyMapDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "architecture.md"), "# Architecture", "utf8");
    fs.writeFileSync(path.join(legacyMapDir, "map.json"), "{}", "utf8");
    const moved = migrateLegacyArchitectState(tmpDir);
    assert.strictEqual(moved.length, 1);
    assert.ok(fs.existsSync(path.join(targetDir, "architecture.md")));
    assert.ok(!fs.existsSync(path.join(targetDir, "architect-map")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateAgentFiles links each agent to its stage skill using the architecture id", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-agent-skills-"));
    const profile: ArchitectProfile = {
      projectName: "Inventory App",
      projectSlug: "inventory-app",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
    const entry: ArchitectureLibraryEntry = {
      id: "modular-monolith",
      name: "Modular Monolith",
      filePath: "",
      domain: ["web"],
      teamSize: "small",
      complexity: "low",
      bestForDrivers: ["small team"],
      notForDrivers: ["large independent teams"],
      content: "",
    };
    generateAgentFiles(tmpDir, profile, entry);
    const skillPaths = generateSkillFiles(tmpDir, profile, entry);
    const skillNames = new Set(skillPaths.map((p) => path.basename(path.dirname(p))));

    const readSkillRef = (role: string): string => {
      const content = fs.readFileSync(
        path.join(tmpDir, ".pi", "agents", `inventory-app-modular-monolith-${role}.md`),
        "utf8",
      );
      const match = content.match(/^skills:\s*(.+)$/m);
      assert.ok(match, `agent ${role} should have a skills frontmatter line`);
      return match[1].trim();
    };

    assert.strictEqual(readSkillRef("planner"), "inventory-app-modular-monolith-plan");
    assert.strictEqual(readSkillRef("implementer"), "inventory-app-modular-monolith-implement");
    assert.strictEqual(readSkillRef("reviewer-correctness"), "inventory-app-modular-monolith-plan");
    assert.strictEqual(readSkillRef("reviewer-security"), "inventory-app-modular-monolith-plan");
    assert.strictEqual(readSkillRef("reviewer-tests"), "inventory-app-modular-monolith-plan");

    for (const role of ["planner", "implementer", "reviewer-correctness", "reviewer-security", "reviewer-tests"]) {
      assert.ok(
        skillNames.has(readSkillRef(role)),
        `referenced skill for ${role} should match a generated skill folder`,
      );
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("areDriversStale returns true when the inputs config is newer than drivers", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-stale-config-"));
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), "{}", "utf8");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(tmpDir, "docs", "PRD.md"), old, old);
    fs.utimesSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), old, old);
    const inputsConfig = {
      version: 1 as const,
      documents: [{ type: "prd" as const, path: "docs/PRD.md" }],
      additionalConstraints: ["changed constraint"],
    };
    saveArchitectInputsConfig(tmpDir, inputsConfig);
    assert.strictEqual(areDriversStale(tmpDir, inputsConfig), true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("areDriversStale returns false when config and documents are older than drivers", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-stale-config-ok-"));
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");
    const inputsConfig = {
      version: 1 as const,
      documents: [{ type: "prd" as const, path: "docs/PRD.md" }],
      additionalConstraints: [],
    };
    saveArchitectInputsConfig(tmpDir, inputsConfig);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(tmpDir, "docs", "PRD.md"), old, old);
    fs.utimesSync(path.join(tmpDir, ".pi", "senai", "architect-inputs.json"), old, old);
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), "{}", "utf8");
    assert.strictEqual(areDriversStale(tmpDir, inputsConfig), false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removeStaleArchitectureArtifacts removes only previous-architecture files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-cleanup-"));
    const profile: ArchitectProfile = {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "hexagonal",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "test-project-monolith-planner.md"), "old", "utf8");
    fs.writeFileSync(path.join(agentsDir, "test-project-monolith-implementer.md"), "old", "utf8");
    fs.writeFileSync(path.join(agentsDir, "test-project-hexagonal-planner.md"), "current", "utf8");
    fs.writeFileSync(path.join(agentsDir, "my-helper.md"), "user", "utf8");
    fs.writeFileSync(path.join(agentsDir, "test-project-notes.md"), "user file with slug prefix", "utf8");
    const oldSkillDir = path.join(tmpDir, ".pi", "skills", "test-project-monolith-plan");
    fs.mkdirSync(oldSkillDir, { recursive: true });
    fs.writeFileSync(path.join(oldSkillDir, "SKILL.md"), "old", "utf8");
    const currentSkillDir = path.join(tmpDir, ".pi", "skills", "test-project-hexagonal-plan");
    fs.mkdirSync(currentSkillDir, { recursive: true });
    fs.writeFileSync(path.join(currentSkillDir, "SKILL.md"), "current", "utf8");

    // The hash guard only deletes files the manifest proves we generated and
    // the user never edited — record the stale artifacts as generated first.
    writeGeneratedManifest(tmpDir, [
      path.join(agentsDir, "test-project-monolith-planner.md"),
      path.join(agentsDir, "test-project-monolith-implementer.md"),
      path.join(oldSkillDir, "SKILL.md"),
    ]);
    const result = removeStaleArchitectureArtifacts(tmpDir, profile);

    assert.strictEqual(result.removed.length, 3);
    assert.strictEqual(result.kept.length, 0);
    assert.ok(!fs.existsSync(path.join(agentsDir, "test-project-monolith-planner.md")));
    assert.ok(!fs.existsSync(path.join(agentsDir, "test-project-monolith-implementer.md")));
    assert.ok(!fs.existsSync(oldSkillDir));
    assert.ok(fs.existsSync(path.join(agentsDir, "test-project-hexagonal-planner.md")));
    assert.ok(fs.existsSync(path.join(agentsDir, "my-helper.md")));
    assert.ok(fs.existsSync(path.join(agentsDir, "test-project-notes.md")));
    assert.ok(fs.existsSync(path.join(currentSkillDir, "SKILL.md")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateArchitectureDocs replaces the ADR set on regeneration", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-adr-clear-"));
    const profile: ArchitectProfile = {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
    const baseReport: ArchitectReport = {
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
      adrs: [{ id: "0001", title: "Use modular monolith", context: "c", decision: "d", consequences: "x" }],
      constraints: [],
    };

    generateArchitectureDocs(tmpDir, profile, baseReport);
    const adrsDir = path.join(tmpDir, ".pi", "architect", "adrs");
    assert.ok(fs.existsSync(path.join(adrsDir, "0001-use-modular-monolith.md")));

    const newReport: ArchitectReport = {
      ...baseReport,
      adrs: [{ id: "0001", title: "Adopt plugin kernel", context: "c", decision: "d", consequences: "x" }],
    };
    generateArchitectureDocs(tmpDir, profile, newReport);

    assert.deepStrictEqual(fs.readdirSync(adrsDir), ["0001-adopt-plugin-kernel.md"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeArchReport(adrs: ArchitectReport["adrs"]): ArchitectReport {
    return {
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
      adrs,
      constraints: [],
    };
  }

  function makeCleanupProfile(): ArchitectProfile {
    return {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "hexagonal",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
  }

  it("removeStaleArchitectureArtifacts clears multiple old architectures and keeps lookalikes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-cleanup-multi-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "test-project-monolith-planner.md"), "old", "utf8");
    fs.writeFileSync(path.join(agentsDir, "test-project-layered-architecture-implementer.md"), "old", "utf8");
    fs.writeFileSync(path.join(agentsDir, "test-project-hexagonal-planner-backup.md"), "lookalike", "utf8");

    writeGeneratedManifest(tmpDir, [
      path.join(agentsDir, "test-project-monolith-planner.md"),
      path.join(agentsDir, "test-project-layered-architecture-implementer.md"),
    ]);
    const result = removeStaleArchitectureArtifacts(tmpDir, makeCleanupProfile());

    assert.strictEqual(result.removed.length, 2);
    assert.ok(!fs.existsSync(path.join(agentsDir, "test-project-monolith-planner.md")));
    assert.ok(!fs.existsSync(path.join(agentsDir, "test-project-layered-architecture-implementer.md")));
    assert.ok(fs.existsSync(path.join(agentsDir, "test-project-hexagonal-planner-backup.md")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removeStaleArchitectureArtifacts keeps a user-edited stale file (hash mismatch)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-cleanup-drift-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const staleFile = path.join(agentsDir, "test-project-monolith-planner.md");
    fs.writeFileSync(staleFile, "old", "utf8");
    writeGeneratedManifest(tmpDir, [staleFile]);

    // User edits the file after generation — the hash no longer matches.
    fs.writeFileSync(staleFile, "old + user edit", "utf8");

    const result = removeStaleArchitectureArtifacts(tmpDir, makeCleanupProfile());
    assert.strictEqual(result.removed.length, 0);
    assert.deepStrictEqual(result.kept, [path.relative(tmpDir, staleFile)]);
    assert.strictEqual(fs.readFileSync(staleFile, "utf8"), "old + user edit");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removeStaleArchitectureArtifacts keeps a pattern-matching file that is not in the manifest", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-cleanup-nomanifest-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    // Hand-made file with an unlucky matching name, no manifest entry.
    const handMade = path.join(agentsDir, "test-project-monolith-planner.md");
    fs.writeFileSync(handMade, "hand-made", "utf8");

    const result = removeStaleArchitectureArtifacts(tmpDir, makeCleanupProfile());
    assert.strictEqual(result.removed.length, 0);
    assert.deepStrictEqual(result.kept, [path.relative(tmpDir, handMade)]);
    assert.ok(fs.existsSync(handMade));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removeStaleArchitectureArtifacts keeps skill-like files that are not directories", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-cleanup-file-"));
    const skillsDir = path.join(tmpDir, ".pi", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "test-project-monolith-plan"), "a file, not a dir", "utf8");

    const removed = removeStaleArchitectureArtifacts(tmpDir, makeCleanupProfile());

    assert.deepStrictEqual(removed, { removed: [], kept: [] });
    assert.ok(fs.existsSync(path.join(skillsDir, "test-project-monolith-plan")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removeStaleArchitectureArtifacts handles missing agents and skills directories", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-cleanup-empty-"));
    assert.deepStrictEqual(removeStaleArchitectureArtifacts(tmpDir, makeCleanupProfile()), { removed: [], kept: [] });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateArchitectureDocs keeps non-markdown files in the adrs folder", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-adr-keep-"));
    const adrsDir = path.join(tmpDir, ".pi", "architect", "adrs");
    fs.mkdirSync(adrsDir, { recursive: true });
    fs.writeFileSync(path.join(adrsDir, "notes.txt"), "keep me", "utf8");
    fs.writeFileSync(path.join(adrsDir, "0099-old-decision.md"), "old", "utf8");

    generateArchitectureDocs(tmpDir, makeCleanupProfile(), makeArchReport([
      { id: "0001", title: "First decision", context: "c", decision: "d", consequences: "x" },
    ]));

    assert.ok(fs.existsSync(path.join(adrsDir, "notes.txt")));
    assert.ok(!fs.existsSync(path.join(adrsDir, "0099-old-decision.md")));
    assert.ok(fs.existsSync(path.join(adrsDir, "0001-first-decision.md")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateArchitectureDocs with zero ADRs empties the adrs folder", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-adr-zero-"));
    const adrsDir = path.join(tmpDir, ".pi", "architect", "adrs");
    fs.mkdirSync(adrsDir, { recursive: true });
    fs.writeFileSync(path.join(adrsDir, "0001-old-decision.md"), "old", "utf8");

    generateArchitectureDocs(tmpDir, makeCleanupProfile(), makeArchReport([]));

    assert.deepStrictEqual(fs.readdirSync(adrsDir), []);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("areDriversStale returns false when config and drivers have the same mtime", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-stale-equal-"));
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD", "utf8");
    const inputsConfig = {
      version: 1 as const,
      documents: [{ type: "prd" as const, path: "docs/PRD.md" }],
      additionalConstraints: [],
    };
    saveArchitectInputsConfig(tmpDir, inputsConfig);
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), "{}", "utf8");
    const same = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(tmpDir, "docs", "PRD.md"), same, same);
    fs.utimesSync(path.join(tmpDir, ".pi", "senai", "architect-inputs.json"), same, same);
    fs.utimesSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), same, same);
    assert.strictEqual(areDriversStale(tmpDir, inputsConfig), false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectReport normalizes numeric confidence", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-confidence-"));

    saveArchitectReport(tmpDir, { ...makeArchReport([]), confidence: 95 } as unknown as ArchitectReport);
    assert.strictEqual(loadArchitectReport(tmpDir)?.confidence, "high");

    saveArchitectReport(tmpDir, { ...makeArchReport([]), confidence: 60 } as unknown as ArchitectReport);
    assert.strictEqual(loadArchitectReport(tmpDir)?.confidence, "medium");

    saveArchitectReport(tmpDir, { ...makeArchReport([]), confidence: 10 } as unknown as ArchitectReport);
    assert.strictEqual(loadArchitectReport(tmpDir)?.confidence, "low");

    saveArchitectReport(tmpDir, makeArchReport([]));
    assert.strictEqual(loadArchitectReport(tmpDir)?.confidence, "high");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeAutoMapProfile(): ArchitectProfile {
    return {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
  }

  it("autoMapArchitectureAgents creates agents.json and maps all seven roles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-automap-"));

    const mapped = autoMapArchitectureAgents(tmpDir, makeAutoMapProfile(), "modular-monolith");

    assert.deepStrictEqual(mapped, [
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

  it("autoMapArchitectureAgents preserves custom mappings and remaps stale generated ones", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-automap-custom-"));
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: {
        implementer: "my-custom-coder",
        planner: "test-project-old-arch-planner",
      },
    });

    const mapped = autoMapArchitectureAgents(tmpDir, makeAutoMapProfile(), "modular-monolith");

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(saved.agents["implementer"], "my-custom-coder", "custom mapping must stay untouched");
    assert.strictEqual(
      saved.agents["planner"],
      "test-project-modular-monolith-planner",
      "stale generated mapping must be remapped",
    );
    assert.ok(!mapped.includes("implementer"));
    assert.ok(mapped.includes("planner"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("autoMapArchitectureAgents is a no-op when mappings are already correct", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-automap-noop-"));

    const first = autoMapArchitectureAgents(tmpDir, makeAutoMapProfile(), "modular-monolith");
    assert.strictEqual(first.length, 7);
    const before = fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8");

    const second = autoMapArchitectureAgents(tmpDir, makeAutoMapProfile(), "modular-monolith");

    assert.deepStrictEqual(second, []);
    const after = fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8");
    assert.strictEqual(after, before, "agents.json must not be rewritten on a no-op run");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectReport maps a free-text ADR string to id ADR-000 and keeps the title", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-rep-adr000-"));
    saveArchitectReport(tmpDir, {
      ...makeArchReport([]),
      adrs: ["Use a single deployable unit for everything"],
    } as unknown as ArchitectReport);

    const loaded = loadArchitectReport(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded!.adrs.length, 1);
    assert.strictEqual(loaded!.adrs[0].id, "ADR-000");
    assert.strictEqual(loaded!.adrs[0].title, "Use a single deployable unit for everything");
    assert.strictEqual(loaded!.adrs[0].context, "");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectReport drops empty strings, numbers, nulls, and id-less objects from adrs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-rep-adr-filter-"));
    saveArchitectReport(tmpDir, {
      ...makeArchReport([]),
      adrs: [
        "",
        42,
        null,
        { id: "", title: "x" },
        { id: "ADR-7", title: "Valid decision", context: "c", decision: "d", consequences: "x" },
      ],
    } as unknown as ArchitectReport);

    const loaded = loadArchitectReport(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded!.adrs.length, 1, "only the fully valid entry survives");
    assert.strictEqual(loaded!.adrs[0].id, "ADR-7");
    assert.strictEqual(loaded!.adrs[0].title, "Valid decision");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadArchitectReport maps numeric confidence at the 80/50 boundaries", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-confidence-edge-"));
    const cases: Array<[number, string]> = [
      [80, "high"],
      [79, "medium"],
      [50, "medium"],
      [49, "low"],
    ];
    for (const [value, expected] of cases) {
      saveArchitectReport(tmpDir, { ...makeArchReport([]), confidence: value } as unknown as ArchitectReport);
      assert.strictEqual(loadArchitectReport(tmpDir)?.confidence, expected, `confidence ${value}`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeManifest(tmpDir: string, content: string): void {
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "architect", "generated-manifest.json"), content, "utf8");
  }

  it("loadGeneratedManifest returns null for a wrong version", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-manifest-ver-"));
    writeManifest(tmpDir, JSON.stringify({ version: 2, generatedAt: "", files: {} }));
    assert.strictEqual(loadGeneratedManifest(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadGeneratedManifest returns null when files is not an object", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-manifest-files-"));
    writeManifest(tmpDir, JSON.stringify({ version: 1, generatedAt: "", files: "nope" }));
    assert.strictEqual(loadGeneratedManifest(tmpDir), null);
    writeManifest(tmpDir, JSON.stringify({ version: 1, generatedAt: "", files: null }));
    assert.strictEqual(loadGeneratedManifest(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadGeneratedManifest returns null for malformed JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-manifest-json-"));
    writeManifest(tmpDir, "{ not valid");
    assert.strictEqual(loadGeneratedManifest(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("addToGeneratedManifest skips missing files and hashes only real ones", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-manifest-add-"));
    const realPath = path.join(tmpDir, "real-file.txt");
    fs.writeFileSync(realPath, "content", "utf8");
    const missingPath = path.join(tmpDir, "does-not-exist.txt");

    const manifest = addToGeneratedManifest(tmpDir, [realPath, missingPath]);

    assert.deepStrictEqual(Object.keys(manifest.files), ["real-file.txt"]);
    assert.match(manifest.files["real-file.txt"], /^[0-9a-f]{64}$/);
    const persisted = loadGeneratedManifest(tmpDir);
    assert.deepStrictEqual(Object.keys(persisted!.files), ["real-file.txt"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrateLegacyArchitectState returns empty when no legacy dir exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-migrate-none-"));
    assert.deepStrictEqual(migrateLegacyArchitectState(tmpDir), []);
    assert.ok(!fs.existsSync(path.join(tmpDir, ".pi", "architect")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrateLegacyArchitectState does not clobber an existing .pi/architect", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-migrate-clobber-"));
    const legacyDir = path.join(tmpDir, ".IDE_Plans", "architect");
    const targetDir = path.join(tmpDir, ".pi", "architect");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "old.md"), "old", "utf8");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "current.md"), "current", "utf8");

    assert.deepStrictEqual(migrateLegacyArchitectState(tmpDir), []);
    assert.ok(fs.existsSync(path.join(legacyDir, "old.md")), "legacy dir stays untouched");
    assert.strictEqual(fs.readFileSync(path.join(targetDir, "current.md"), "utf8"), "current");
    assert.ok(!fs.existsSync(path.join(targetDir, "old.md")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("selectArchitecture keeps the first entry on ties and on all-negative scores", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ id: "FR-1", description: "plain requirement" });
    const makeEntry = (id: string, notFor: string[]): ArchitectureLibraryEntry => ({
      id,
      name: id,
      filePath: "",
      domain: [],
      teamSize: "",
      complexity: "",
      bestForDrivers: [],
      notForDrivers: notFor,
      content: "",
    });

    const tie = selectArchitecture(drivers, [makeEntry("first", []), makeEntry("second", [])]);
    assert.strictEqual(tie?.id, "first", "equal scores keep library order");

    const negativeDrivers = createEmptyDrivers();
    negativeDrivers.functionalRequirements.push({ id: "FR-1", description: "needs kubernetes" });
    const negative = selectArchitecture(negativeDrivers, [
      makeEntry("first", ["kubernetes"]),
      makeEntry("second", ["kubernetes"]),
    ]);
    assert.strictEqual(negative?.id, "first", "all-negative scores still return scored[0]");
  });

  it("slugify truncates at 40 characters and returns empty for all-symbol input", () => {
    const long = "a".repeat(60);
    assert.strictEqual(slugify(long).length, 40);
    assert.strictEqual(slugify(long), "a".repeat(40));
    assert.strictEqual(slugify("!!!"), "");
  });

  it("generateArchitectureDocs fills fallback lines when report sections are empty", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-docs-empty-"));
    const profile: ArchitectProfile = {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };

    generateArchitectureDocs(tmpDir, profile, makeArchReport([]));

    const content = fs.readFileSync(path.join(tmpDir, ".pi", "architect", "architecture.md"), "utf8");
    assert.ok(content.includes("Not provided."), "empty text sections use the Not provided fallback");
    assert.ok(content.includes("No components defined."));
    assert.ok(content.includes("No interfaces defined."));
    assert.ok(content.includes("No technology stack defined."));
    assert.ok(content.includes("No development order defined."));
    assert.ok(content.includes("No atomic functions defined."));
    assert.ok(content.includes("No quality attribute mapping defined."));
    assert.ok(content.includes("No constraints defined."));
    assert.ok(content.includes("No ADRs defined."));
    assert.ok(content.includes("participant System"), "zero-component sequence diagram uses the System fallback");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("autoMapArchitectureAgents throws on a corrupted agents.json", () => {
    // NOTE: possible bug — see Doc/test-plan.md known issues
    // (throw propagates through finalize after artifacts are already written)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-automap-corrupt-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "{ not valid json", "utf8");

    assert.throws(
      () => autoMapArchitectureAgents(tmpDir, makeAutoMapProfile(), "modular-monolith"),
      /Invalid agent config/,
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("autoMapArchitectureAgents preserves a custom agent whose name starts with the project slug", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-automap-prefix-"));
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { implementer: "test-project-my-handmade-agent" },
    });
    // The hand-made agent file exists on disk, so it is never treated as stale.
    fs.mkdirSync(path.join(tmpDir, ".pi", "agents"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "agents", "test-project-my-handmade-agent.md"), "custom", "utf8");

    const mapped = autoMapArchitectureAgents(tmpDir, makeAutoMapProfile(), "modular-monolith");

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(
      saved.agents["implementer"],
      "test-project-my-handmade-agent",
      "hand-made agent with the slug prefix must stay untouched",
    );
    assert.ok(!mapped.includes("implementer"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("autoMapArchitectureAgents leaves agents generated for a different project untouched", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-automap-other-"));
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { planner: "other-project-modular-monolith-planner" },
    });

    const mapped = autoMapArchitectureAgents(tmpDir, makeAutoMapProfile(), "modular-monolith");

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(saved.agents["planner"], "other-project-modular-monolith-planner");
    assert.ok(!mapped.includes("planner"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("autoMapArchitectureAgents returns only the roles it actually changed", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-automap-mixed-"));
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: {
        planner: "test-project-modular-monolith-planner", // already correct
        implementer: "test-project-old-arch-implementer", // stale generated
      },
    });

    const mapped = autoMapArchitectureAgents(tmpDir, makeAutoMapProfile(), "modular-monolith");

    assert.deepStrictEqual(mapped, [
      "scout-1",
      "implementer",
      "reviewer-correctness",
      "reviewer-security",
      "reviewer-tests",
      "code-review",
    ]);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "utf8"));
    assert.strictEqual(
      saved.agents["planner"],
      "test-project-modular-monolith-planner",
      "already-correct mapping is not rewritten",
    );
    assert.strictEqual(saved.agents["implementer"], "test-project-modular-monolith-implementer");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("coverage audit gaps", () => {
  function makeGapProfile(overrides?: Partial<ArchitectProfile>): ArchitectProfile {
    return {
      projectName: "Test Project",
      projectSlug: "test-project",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
      ...overrides,
    };
  }

  function makeGapReport(overrides?: Partial<ArchitectReport>): ArchitectReport {
    return {
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
      ...overrides,
    };
  }

  it("discoverArchitectureLibrary accepts a JSON file holding a single object", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-lib-single-"));
    const libDir = path.join(tmpDir, ".pi", "architecture-library");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "single.json"),
      JSON.stringify({ id: "solo-arch", name: "Solo Arch", description: "One object, not an array." }),
      "utf8",
    );

    const entries = discoverArchitectureLibrary(tmpDir);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].id, "solo-arch");
    assert.strictEqual(entries[0].name, "Solo Arch");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discoverArchitectureLibrary skips name-less JSON items, uses domain when platform is absent, and ignores other files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-lib-json-edge-"));
    const libDir = path.join(tmpDir, ".pi", "architecture-library");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "library.json"),
      JSON.stringify([
        { id: "no-name-here" },
        { name: "Domain Only Arch", domain: ["embedded", "plc"] },
      ]),
      "utf8",
    );
    fs.writeFileSync(path.join(libDir, "notes.txt"), "name: Not An Entry", "utf8");

    const entries = discoverArchitectureLibrary(tmpDir);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].name, "Domain Only Arch");
    assert.strictEqual(entries[0].id, "domain-only-arch");
    assert.deepStrictEqual(entries[0].domain, ["embedded", "plc"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateArchitectureDocs draws system-context edges for external interfaces only", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-docs-ext-"));
    const report = makeGapReport({
      interfaces: [
        { name: "Payment Gateway", type: "external", description: "Card payments" },
        { name: "Internal Bus", type: "internal", description: "In-process events" },
      ],
    });

    generateArchitectureDocs(tmpDir, makeGapProfile(), report);

    const content = fs.readFileSync(path.join(tmpDir, ".pi", "architect", "architecture.md"), "utf8");
    assert.ok(content.includes("id_payment-gateway[Payment Gateway]"));
    assert.ok(content.includes("System --> id_payment-gateway"));
    assert.ok(!content.includes("id_internal-bus"), "internal interfaces are not external context nodes");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateArchitectureDocs chains sequence edges and caps participants at six", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-docs-seq-"));
    const components = Array.from({ length: 8 }, (_, i) => ({
      name: `Comp ${i + 1}`,
      responsibility: "Part of the chain",
      dependencies: [],
    }));
    const report = makeGapReport({ components });

    generateArchitectureDocs(tmpDir, makeGapProfile(), report);

    const content = fs.readFileSync(path.join(tmpDir, ".pi", "architect", "architecture.md"), "utf8");
    assert.ok(content.includes("U->>id_comp-1: initiates request"));
    assert.ok(content.includes("id_comp-1->>id_comp-2: processes"));
    assert.ok(content.includes("id_comp-5->>id_comp-6: processes"));
    assert.ok(content.includes("id_comp-6-->>U: returns result"));
    assert.ok(!content.includes("participant id_comp-7"), "participants are capped by slice(0, 6)");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateAgentFiles includes the additional constraints block when configured", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-agent-constraints-"));
    const profile = makeGapProfile({ additionalConstraints: ["Must run offline", "No paid services"] });
    const entry: ArchitectureLibraryEntry = {
      id: "modular-monolith",
      name: "Modular Monolith",
      filePath: "",
      domain: [],
      teamSize: "",
      complexity: "",
      bestForDrivers: [],
      notForDrivers: [],
      content: "",
    };

    generateAgentFiles(tmpDir, profile, entry);

    const content = fs.readFileSync(
      path.join(tmpDir, ".pi", "agents", "test-project-modular-monolith-planner.md"),
      "utf8",
    );
    assert.ok(content.includes("## Additional constraints"));
    assert.ok(content.includes("- Must run offline"));
    assert.ok(content.includes("- No paid services"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});


describe("architect agent orchestration frontmatter", () => {
  function makeProfile(): ArchitectProfile {
    return {
      projectName: "Inventory App",
      projectSlug: "inventory-app",
      selectedArchitecture: "modular-monolith",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    };
  }

  function makeEntry(): ArchitectureLibraryEntry {
    return {
      id: "modular-monolith",
      name: "Modular Monolith",
      filePath: "",
      domain: ["web"],
      teamSize: "small",
      complexity: "low",
      bestForDrivers: ["small team"],
      notForDrivers: ["large independent teams"],
      content: "",
    };
  }

  const ARCH_AGENT_ROLES = ["planner", "implementer", "reviewer-correctness", "reviewer-security", "reviewer-tests"];

  function readAgent(tmpDir: string, role: string): string {
    return fs.readFileSync(
      path.join(tmpDir, ".pi", "agents", `inventory-app-modular-monolith-${role}.md`),
      "utf8",
    );
  }

  it("planner and implementer keep the full tool set", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-tools-full-"));
    generateAgentFiles(tmpDir, makeProfile(), makeEntry());
    for (const role of ["planner", "implementer"]) {
      assert.ok(
        /^tools: read, write, edit, bash$/m.test(readAgent(tmpDir, role)),
        `${role} must keep 'tools: read, write, edit, bash'`,
      );
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reviewer agents lose the edit tool but keep write", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-tools-reviewer-"));
    generateAgentFiles(tmpDir, makeProfile(), makeEntry());
    for (const role of ["reviewer-correctness", "reviewer-security", "reviewer-tests"]) {
      const content = readAgent(tmpDir, role);
      assert.ok(/^tools: read, write, bash$/m.test(content), `${role} must be 'tools: read, write, bash'`);
      assert.ok(!/^tools:.*\bedit\b/m.test(content), `${role} must not carry edit`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("all architecture agents carry orchestration frontmatter and the completion contract", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-frontmatter-"));
    generateAgentFiles(tmpDir, makeProfile(), makeEntry());
    for (const role of ARCH_AGENT_ROLES) {
      const content = readAgent(tmpDir, role);
      const frontmatter = content.split("---")[1] ?? "";
      assert.ok(/^session-mode: lineage-only$/m.test(frontmatter), `${role} needs session-mode: lineage-only`);
      assert.ok(/^auto-exit: true$/m.test(frontmatter), `${role} needs auto-exit: true`);
      assert.ok(/^spawning: false$/m.test(frontmatter), `${role} needs spawning: false`);
      assert.ok(!/^model:/m.test(frontmatter), `${role} must not pin a model`);
      assert.ok(content.includes("## Completion contract"), `${role} needs the completion contract`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
