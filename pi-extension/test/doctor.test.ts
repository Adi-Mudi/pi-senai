import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSenaiDiagnostic, formatDiagnosticReport } from "../src/doctor.js";
import { saveAgentConfig } from "../src/agent-config.js";
import { saveFilesConfig } from "../src/files-config.js";
import { saveAgentsFilesConfig } from "../src/agents-files-config.js";
import { saveArchitectInputsConfig } from "../src/architect-inputs-config.js";
import { saveArchitectProfile, saveArchitectReport } from "../src/architect.js";
import { createEmptyDrivers } from "../src/driver-extractor.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeAgent(cwd: string, name: string, frontmatter: Record<string, unknown>): void {
  const dir = path.join(cwd, ".pi", "agents");
  fs.mkdirSync(dir, { recursive: true });
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "", `# ${name}`);
  fs.writeFileSync(path.join(dir, `${name}.md`), lines.join("\n"), "utf8");
}

function writeFile(cwd: string, relPath: string, content = ""): void {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

describe("doctor", () => {
  it("reports missing config files", () => {
    const tmpDir = makeTmpDir("doctor-missing-");
    const report = runSenaiDiagnostic(tmpDir);

    assert.strictEqual(report.ok, false);
    const configSection = report.sections.find((s) => s.title === "Configuration files");
    assert.ok(configSection);
    assert.strictEqual(
      configSection.items.filter((i) => i.status === "error").length,
      3,
      "all three config files should be reported as missing",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports valid config files", () => {
    const tmpDir = makeTmpDir("doctor-valid-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    const report = runSenaiDiagnostic(tmpDir);

    assert.strictEqual(report.ok, true);
    const configSection = report.sections.find((s) => s.title === "Configuration files");
    assert.ok(configSection);
    assert.strictEqual(
      configSection.items.filter((i) => i.status === "ok").length,
      3,
      "all three config files should be reported as ok",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports files.json version mismatch instead of crashing", () => {
    const tmpDir = makeTmpDir("doctor-version-mismatch-");
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "senai", "files.json"),
      JSON.stringify({
        version: 3,
        codePaths: ["src/"],
        inputDocuments: ["README.md"],
        testPaths: ["tests/"],
        excludedPaths: [".git/"],
      }),
      "utf8",
    );
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    const report = runSenaiDiagnostic(tmpDir);

    assert.strictEqual(report.ok, false);
    const configSection = report.sections.find((s) => s.title === "Configuration files");
    assert.ok(configSection);
    const mismatch = configSection.items.find(
      (i) => i.status === "error" && i.message.includes("Unsupported files.json version: 3"),
    );
    assert.ok(mismatch, "should report unsupported files.json version");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports not-found custom agent", () => {
    const tmpDir = makeTmpDir("doctor-missing-agent-");

    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { "scout-3": "missing-scout-agent" },
    });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    const report = runSenaiDiagnostic(tmpDir);

    assert.strictEqual(report.ok, false);
    const mappingSection = report.sections.find((s) => s.title === "Agent mapping sources");
    assert.ok(mappingSection);
    const scout3 = mappingSection.items.find((i) => i.message.includes("scout-3"));
    assert.ok(scout3);
    assert.strictEqual(scout3.status, "error");
    assert.ok(scout3.message.includes("NOT FOUND"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports agent with conflicting mandate", () => {
    const tmpDir = makeTmpDir("doctor-conflict-");

    writeAgent(tmpDir, "gas-error-handler", {
      name: "gas-error-handler",
      description: "Fix only. Do not build. Diagnose GAS errors.",
      tools: ["read", "write", "edit"],
    });

    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { "scout-3": "gas-error-handler" },
    });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    const report = runSenaiDiagnostic(tmpDir);

    assert.strictEqual(report.ok, false);
    const capabilitySection = report.sections.find((s) => s.title === "Agent-role capability fit");
    assert.ok(capabilitySection);
    const conflict = capabilitySection.items.find(
      (i) => i.message.includes("ROLE CONFLICT") && i.message.includes("scout-3"),
    );
    assert.ok(conflict, "should report role conflict for scout-3");
    assert.strictEqual(conflict.status, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports missing tools for a role", () => {
    const tmpDir = makeTmpDir("doctor-tools-");

    writeAgent(tmpDir, "bad-implementer", {
      name: "bad-implementer",
      description: "A coding agent that forgot its write tool.",
      tools: ["read"],
    });

    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { implementer: "bad-implementer" },
    });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    const report = runSenaiDiagnostic(tmpDir);

    assert.strictEqual(report.ok, false);
    const capabilitySection = report.sections.find((s) => s.title === "Agent-role capability fit");
    assert.ok(capabilitySection);
    const missingTools = capabilitySection.items.find(
      (i) => i.message.includes("MISSING REQUIRED TOOLS") && i.message.includes("implementer"),
    );
    assert.ok(missingTools, "should report missing tools for implementer");
    assert.strictEqual(missingTools.status, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports file scope conflicts", () => {
    const tmpDir = makeTmpDir("doctor-conflict-paths-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/", "src/utils/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "src/utils/helper.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    const report = runSenaiDiagnostic(tmpDir);

    assert.strictEqual(report.ok, false);
    const fileScopeSection = report.sections.find((s) => s.title === "Project file scope");
    assert.ok(fileScopeSection);
    const conflict = fileScopeSection.items.find((i) => i.message.includes("Path conflicts"));
    assert.ok(conflict, "should report path conflict");
    assert.strictEqual(conflict.status, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports missing truth document", () => {
    const tmpDir = makeTmpDir("doctor-truth-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: {
        "scout-1": { primary: "docs/missing-prd.md" },
      },
    });

    const report = runSenaiDiagnostic(tmpDir);

    assert.strictEqual(report.ok, false);
    const docSection = report.sections.find((s) => s.title === "Agent document assignments");
    assert.ok(docSection);
    const missing = docSection.items.find((i) => i.message.includes("MISSING"));
    assert.ok(missing, "should report missing truth document");
    assert.strictEqual(missing.status, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("formatDiagnosticReport includes summary and sections", () => {
    const tmpDir = makeTmpDir("doctor-format-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    const report = runSenaiDiagnostic(tmpDir);
    const text = formatDiagnosticReport(report);

    assert.ok(text.includes("Pi Senai Diagnostic Report"));
    assert.ok(text.includes("Configuration files"));
    assert.ok(text.includes("Agent mapping sources"));
    assert.ok(text.includes("Agent-role capability fit"));
    assert.ok(text.includes("Project file scope"));
    assert.ok(text.includes("Agent document assignments"));
    assert.ok(text.includes("Runtime environment"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports invalid architectural drivers without crashing", () => {
    const tmpDir = makeTmpDir("doctor-invalid-drivers-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    // Write an invalid drivers file (malformed JSON).
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"),
      "{ not valid json",
      "utf8",
    );

    const report = runSenaiDiagnostic(tmpDir);
    const archSection = report.sections.find((s) => s.title === "Architecture setup");
    assert.ok(archSection);

    const invalidDrivers = archSection.items.find((i) => i.message.includes("Invalid architectural drivers"));
    assert.ok(invalidDrivers, "doctor should report invalid drivers as an error instead of crashing");
    assert.strictEqual(invalidDrivers.status, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports invalid architect profile without crashing", () => {
    const tmpDir = makeTmpDir("doctor-invalid-profile-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-profile.json"),
      "{ not valid json",
      "utf8",
    );

    const report = runSenaiDiagnostic(tmpDir);
    const archSection = report.sections.find((s) => s.title === "Architecture setup");
    assert.ok(archSection);

    const invalidProfile = archSection.items.find((i) => i.message.includes("Invalid architect profile"));
    assert.ok(invalidProfile, "doctor should report invalid profile as an error instead of crashing");
    assert.strictEqual(invalidProfile.status, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports invalid architect report without crashing", () => {
    const tmpDir = makeTmpDir("doctor-invalid-report-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architect-report.json"),
      "{ not valid json",
      "utf8",
    );

    const report = runSenaiDiagnostic(tmpDir);
    const archSection = report.sections.find((s) => s.title === "Architecture setup");
    assert.ok(archSection);

    const invalidReport = archSection.items.find((i) => i.message.includes("Invalid architect report"));
    assert.ok(invalidReport, "doctor should report invalid report as an error instead of crashing");
    assert.strictEqual(invalidReport.status, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports missing generated architecture agents and skills as errors", () => {
    const tmpDir = makeTmpDir("doctor-arch-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    // Create architecture inputs and profile so doctor reaches the agent/skill checks.
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "readme", path: "README.md" }],
      additionalConstraints: [],
    });

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

    const report = runSenaiDiagnostic(tmpDir);
    const archSection = report.sections.find((s) => s.title === "Architecture setup");
    assert.ok(archSection);

    const missingAgents = archSection.items.find((i) => i.message.includes("expected architecture agents are missing"));
    const missingSkills = archSection.items.find((i) => i.message.includes("expected architecture skills are missing"));
    assert.ok(missingAgents, "doctor should report missing agents as errors");
    assert.ok(missingSkills, "doctor should report missing skills as errors");
    assert.strictEqual(missingAgents.status, "error");
    assert.strictEqual(missingSkills.status, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports agent capability mismatch", () => {
    const tmpDir = makeTmpDir("doctor-capability-");

    saveAgentConfig(tmpDir, {
      version: 1,
      agents: {
        "reviewer-correctness": "read-only-reviewer",
      },
    });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    writeAgent(tmpDir, "read-only-reviewer", {
      name: "read-only-reviewer",
      description: "Read-only reviewer",
      tools: "read, write",
      output: "single",
    });

    const report = runSenaiDiagnostic(tmpDir);
    const roleSection = report.sections.find((s) => s.title === "Agent-role capability fit");
    assert.ok(roleSection);

    const mismatch = roleSection.items.find((i) => i.message.includes("read-only") && i.status === "warning");
    assert.ok(mismatch, "doctor should warn about read-only role with write tool");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports stale intermediate driver files", () => {
    const tmpDir = makeTmpDir("doctor-stale-drivers-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "drivers-prd.json"), "{}", "utf8");

    const report = runSenaiDiagnostic(tmpDir);
    const archSection = report.sections.find((s) => s.title === "Architecture setup");
    assert.ok(archSection);

    const staleWarning = archSection.items.find((i) => i.message.includes("stale intermediate driver files"));
    assert.ok(staleWarning, "doctor should warn about stale intermediate driver files");
    assert.strictEqual(staleWarning.status, "warning");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports missing architecture.md", () => {
    const tmpDir = makeTmpDir("doctor-no-arch-md-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");

    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "readme", path: "README.md" }],
      additionalConstraints: [],
    });
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

    const report = runSenaiDiagnostic(tmpDir);
    const archSection = report.sections.find((s) => s.title === "Architecture setup");
    assert.ok(archSection);

    const missingMd = archSection.items.find((i) => i.message.includes("No architecture.md found"));
    assert.ok(missingMd, "doctor should report missing architecture.md");
    assert.strictEqual(missingMd.status, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("doctor architecture validation", () => {
  const SLUG = "test-project";
  const ARCH = "modular-monolith";
  const GENERATED_ROLES = ["planner", "implementer", "reviewer-correctness", "reviewer-security", "reviewer-tests"];

  function saveTestProfile(cwd: string): void {
    saveArchitectProfile(cwd, {
      projectName: "Test Project",
      projectSlug: SLUG,
      selectedArchitecture: ARCH,
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    });
  }

  function saveTestReport(cwd: string): void {
    saveArchitectReport(cwd, {
      selectedArchitecture: ARCH,
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

  function writeGeneratedAgent(
    cwd: string,
    role: string,
    overrides?: { skillsLine?: string; body?: string },
  ): void {
    const name = `${SLUG}-${ARCH}-${role}`;
    const skill = `${SLUG}-${ARCH}-${role === "implementer" ? "implement" : "plan"}`;
    const body =
      overrides?.body ??
      "Read `.pi/architect/architecture.md` and the relevant ADRs in `.pi/architect/adrs/` before acting.\n\n## Forbidden patterns\n\n- global mutable state";
    const content = [
      "---",
      `name: ${name}`,
      "description: generated test agent",
      "tools: read, write, edit, bash",
      overrides?.skillsLine !== undefined ? overrides.skillsLine : `skills: ${skill}`,
      "---",
      "",
      `# ${name}`,
      "",
      body,
    ].join("\n");
    writeFile(cwd, path.join(".pi", "agents", `${name}.md`), content);
  }

  function writeGeneratedSkills(cwd: string): void {
    for (const stage of ["plan", "implement", "document", "deliver"]) {
      writeFile(cwd, path.join(".pi", "skills", `${SLUG}-${ARCH}-${stage}`, "SKILL.md"), "# skill");
    }
  }

  function findSection(report: ReturnType<typeof runSenaiDiagnostic>, title: string) {
    const section = report.sections.find((s) => s.title === title);
    assert.ok(section, `section "${title}" should exist`);
    return section;
  }

  it("mapping check skips with info when no architecture profile exists", () => {
    const tmpDir = makeTmpDir("doctor-map-none-");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture agent mapping");
    assert.strictEqual(section.items.length, 1);
    assert.strictEqual(section.items[0].status, "info");
    assert.ok(section.items[0].message.includes("skipped"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mapping check passes when all six roles point to the generated agents", () => {
    const tmpDir = makeTmpDir("doctor-map-ok-");
    saveTestProfile(tmpDir);
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: {
        "scout-1": `${SLUG}-${ARCH}-planner`,
        planner: `${SLUG}-${ARCH}-planner`,
        implementer: `${SLUG}-${ARCH}-implementer`,
        "reviewer-correctness": `${SLUG}-${ARCH}-reviewer-correctness`,
        "reviewer-security": `${SLUG}-${ARCH}-reviewer-security`,
        "reviewer-tests": `${SLUG}-${ARCH}-reviewer-tests`,
      },
    });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture agent mapping");
    assert.strictEqual(section.items.filter((i) => i.status === "error").length, 0);
    assert.strictEqual(section.items.filter((i) => i.status === "ok").length, 6);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mapping check errors when a role points to a different agent", () => {
    const tmpDir = makeTmpDir("doctor-map-wrong-");
    saveTestProfile(tmpDir);
    saveAgentConfig(tmpDir, { version: 1, agents: { planner: "gas-planner" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture agent mapping");
    const plannerItem = section.items.find((i) => i.message.includes("Architecture Planner (planner)"));
    assert.ok(plannerItem);
    assert.strictEqual(plannerItem.status, "error");
    assert.ok(plannerItem.message.includes('"gas-planner"'));
    assert.ok(plannerItem.details?.[0].includes(`${SLUG}-${ARCH}-planner`));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mapping check errors when scout-1 falls back to the plain built-in scout", () => {
    const tmpDir = makeTmpDir("doctor-map-scout-");
    saveTestProfile(tmpDir);
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture agent mapping");
    const scoutItem = section.items.find((i) => i.message.includes("Scout Architecture (scout-1)"));
    assert.ok(scoutItem);
    assert.strictEqual(scoutItem.status, "error");
    assert.ok(scoutItem.message.includes('"scout"'));
    assert.ok(scoutItem.details?.[0].includes(`${SLUG}-${ARCH}-planner`));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content check passes for complete generated agents", () => {
    const tmpDir = makeTmpDir("doctor-content-ok-");
    saveTestProfile(tmpDir);
    writeGeneratedSkills(tmpDir);
    for (const role of GENERATED_ROLES) writeGeneratedAgent(tmpDir, role);
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated agent content");
    assert.strictEqual(section.items.filter((i) => i.status === "error").length, 0);
    assert.strictEqual(section.items.filter((i) => i.status === "ok").length, 5);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content check errors when the skills frontmatter line is missing", () => {
    const tmpDir = makeTmpDir("doctor-content-noskills-");
    saveTestProfile(tmpDir);
    writeGeneratedSkills(tmpDir);
    writeGeneratedAgent(tmpDir, "planner", { skillsLine: "" });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated agent content");
    const item = section.items.find((i) => i.message.includes(`${SLUG}-${ARCH}-planner`));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes("missing a skills: line")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content check errors when the referenced skill folder does not exist", () => {
    const tmpDir = makeTmpDir("doctor-content-noskilldir-");
    saveTestProfile(tmpDir);
    writeGeneratedAgent(tmpDir, "implementer");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated agent content");
    const item = section.items.find((i) => i.message.includes(`${SLUG}-${ARCH}-implementer`));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes(`referenced skill "${SLUG}-${ARCH}-implement" not found`)));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content check errors when body references are missing", () => {
    const tmpDir = makeTmpDir("doctor-content-nobody-");
    saveTestProfile(tmpDir);
    writeGeneratedSkills(tmpDir);
    writeGeneratedAgent(tmpDir, "planner", { body: "You are the planner." });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated agent content");
    const item = section.items.find((i) => i.message.includes(`${SLUG}-${ARCH}-planner`));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes("architecture.md")));
    assert.ok(item.details?.some((d) => d.includes("adrs")));
    assert.ok(item.details?.some((d) => d.includes("Forbidden patterns")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drift check warns when a generated file is newer than the report", () => {
    const tmpDir = makeTmpDir("doctor-drift-warn-");
    saveTestProfile(tmpDir);
    saveTestReport(tmpDir);
    const reportPath = path.join(tmpDir, ".pi", "architect", "architect-report.json");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(reportPath, old, old);
    writeFile(tmpDir, path.join(".pi", "architect", "architecture.md"), "hand edited");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture drift");
    const warning = section.items.find((i) => i.status === "warning");
    assert.ok(warning, "should warn about the modified file");
    assert.ok(warning.message.includes("architecture.md"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drift check is ok when no generated file is newer than the report", () => {
    const tmpDir = makeTmpDir("doctor-drift-ok-");
    saveTestProfile(tmpDir);
    writeFile(tmpDir, path.join(".pi", "architect", "architecture.md"), "original");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(tmpDir, ".pi", "architect", "architecture.md"), old, old);
    saveTestReport(tmpDir);
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture drift");
    assert.strictEqual(section.items.filter((i) => i.status === "warning").length, 0);
    assert.strictEqual(section.items.filter((i) => i.status === "ok").length, 1);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
