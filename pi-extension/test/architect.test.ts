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
  isFeasible,
  loadArchitectProfile,
  loadArchitectReport,
  migrateLegacyArchitectState,
  saveArchitectProfile,
  saveArchitectReport,
  selectArchitecture,
  slugify,
} from "../src/architect.js";
import type { ArchitectProfile, ArchitectReport, ArchitectureLibraryEntry } from "../src/architect.js";
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
});
