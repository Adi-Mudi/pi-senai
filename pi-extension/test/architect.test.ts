import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildArchitectPrompt,
  discoverArchitectureLibrary,
  generateAgentFiles,
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
      skillLevel: "intermediate",
      drivers: createEmptyDrivers(),
      freeFormRequirements: [],
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

    const selected = selectArchitecture(drivers, library, "intermediate");
    assert.strictEqual(selected?.name, "modular-monolith");
  });

  it("generateAgentFiles creates files with correct names", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-gen-"));
    const profile: ArchitectProfile = {
      projectName: "Inventory App",
      projectSlug: "inventory-app",
      selectedArchitecture: "modular-monolith",
      skillLevel: "intermediate",
      drivers: createEmptyDrivers(),
      freeFormRequirements: [],
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
      skillLevel: "intermediate",
      drivers: createEmptyDrivers(),
      freeFormRequirements: [],
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
      skillLevel: "intermediate",
      drivers: createEmptyDrivers(),
      freeFormRequirements: [],
    };
    const prompt = buildArchitectPrompt(tmpDir, profile);
    assert.match(prompt, /Inventory App/);
    assert.match(prompt, /modular-monolith/);
    assert.match(prompt, /Architect Generation Task/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
