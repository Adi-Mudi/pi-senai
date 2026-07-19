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
import { saveArchitectProfile, saveArchitectReport, writeGeneratedManifest } from "../src/architect.js";
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

  it("mapping check passes when all seven roles point to the generated agents", () => {
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
        "code-review": `${SLUG}-${ARCH}-reviewer-correctness`,
      },
    });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture agent mapping");
    assert.strictEqual(section.items.filter((i) => i.status === "error").length, 0);
    assert.strictEqual(section.items.filter((i) => i.status === "ok").length, 7);
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

  it("drift check warns when a generated file is modified after the manifest", () => {
    const tmpDir = makeTmpDir("doctor-drift-edit-");
    saveTestProfile(tmpDir);
    writeFile(tmpDir, path.join(".pi", "architect", "architecture.md"), "original");
    writeGeneratedManifest(tmpDir, [path.join(tmpDir, ".pi", "architect", "architecture.md")]);
    writeFile(tmpDir, path.join(".pi", "architect", "architecture.md"), "hand edited");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture drift");
    const warning = section.items.find((i) => i.status === "warning");
    assert.ok(warning, "should warn about the modified file");
    assert.ok(warning.message.includes("architecture.md"));
    assert.ok(warning.message.includes("modified after generation"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drift check is ok when all generated files match the manifest", () => {
    const tmpDir = makeTmpDir("doctor-drift-match-");
    saveTestProfile(tmpDir);
    writeFile(tmpDir, path.join(".pi", "architect", "architecture.md"), "original");
    writeFile(tmpDir, path.join(".pi", "skills", `${SLUG}-${ARCH}-plan`, "SKILL.md"), "skill");
    writeGeneratedManifest(tmpDir, [
      path.join(tmpDir, ".pi", "architect", "architecture.md"),
      path.join(tmpDir, ".pi", "skills", `${SLUG}-${ARCH}-plan`, "SKILL.md"),
    ]);
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture drift");
    assert.strictEqual(section.items.filter((i) => i.status === "warning").length, 0);
    assert.strictEqual(section.items.filter((i) => i.status === "ok").length, 1);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mapping check skips safely when the profile is corrupt", () => {
    const tmpDir = makeTmpDir("doctor-map-corrupt-");
    writeFile(tmpDir, path.join(".pi", "architect", "architect-profile.json"), "{ not valid json");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture agent mapping");
    assert.strictEqual(section.items.length, 1);
    assert.strictEqual(section.items[0].status, "info");
    assert.ok(section.items[0].message.includes("skipped"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mapping check uses the architecture id from the profile", () => {
    const tmpDir = makeTmpDir("doctor-map-hex-");
    saveArchitectProfile(tmpDir, {
      projectName: "Test Project",
      projectSlug: SLUG,
      selectedArchitecture: "hexagonal",
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    });
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: {
        "scout-1": `${SLUG}-hexagonal-planner`,
        planner: `${SLUG}-hexagonal-planner`,
        implementer: `${SLUG}-hexagonal-implementer`,
        "reviewer-correctness": `${SLUG}-hexagonal-reviewer-correctness`,
        "reviewer-security": `${SLUG}-hexagonal-reviewer-security`,
        "reviewer-tests": `${SLUG}-hexagonal-reviewer-tests`,
        "code-review": `${SLUG}-hexagonal-reviewer-correctness`,
      },
    });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture agent mapping");
    assert.strictEqual(section.items.filter((i) => i.status === "error").length, 0);
    assert.strictEqual(section.items.filter((i) => i.status === "ok").length, 7);
    assert.ok(section.items.every((i) => i.message.includes(`${SLUG}-hexagonal-`)));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mapping check reports mixed ok and error items for partial mapping", () => {
    const tmpDir = makeTmpDir("doctor-map-partial-");
    saveTestProfile(tmpDir);
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: {
        planner: `${SLUG}-${ARCH}-planner`,
        implementer: `${SLUG}-${ARCH}-implementer`,
      },
    });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture agent mapping");
    assert.strictEqual(section.items.filter((i) => i.status === "ok").length, 2);
    assert.strictEqual(section.items.filter((i) => i.status === "error").length, 5);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content check skips with info when no architecture profile exists", () => {
    const tmpDir = makeTmpDir("doctor-content-none-");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated agent content");
    assert.strictEqual(section.items.length, 1);
    assert.strictEqual(section.items[0].status, "info");
    assert.ok(section.items[0].message.includes("skipped"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content check names only the missing skill when several are listed", () => {
    const tmpDir = makeTmpDir("doctor-content-multiskill-");
    saveTestProfile(tmpDir);
    writeGeneratedSkills(tmpDir);
    writeGeneratedAgent(tmpDir, "planner", {
      skillsLine: `skills: ${SLUG}-${ARCH}-plan, ${SLUG}-${ARCH}-nonexistent`,
    });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated agent content");
    const item = section.items.find((i) => i.message.includes(`${SLUG}-${ARCH}-planner`));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes(`"${SLUG}-${ARCH}-nonexistent" not found`)));
    assert.ok(!item.details?.some((d) => d.includes(`"${SLUG}-${ARCH}-plan" not found`)));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content check errors when the tools frontmatter line is missing", () => {
    const tmpDir = makeTmpDir("doctor-content-notools-");
    saveTestProfile(tmpDir);
    writeGeneratedSkills(tmpDir);
    const name = `${SLUG}-${ARCH}-planner`;
    writeFile(
      tmpDir,
      path.join(".pi", "agents", `${name}.md`),
      [
        "---",
        `name: ${name}`,
        "description: generated test agent",
        `skills: ${SLUG}-${ARCH}-plan`,
        "---",
        "",
        `# ${name}`,
        "",
        "Read `.pi/architect/architecture.md` and the relevant ADRs in `.pi/architect/adrs/` before acting.",
        "",
        "## Forbidden patterns",
        "",
        "- global mutable state",
      ].join("\n"),
    );
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated agent content");
    const item = section.items.find((i) => i.message.includes(name));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes("missing a tools: line")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content check tolerates extra whitespace in the skills line", () => {
    const tmpDir = makeTmpDir("doctor-content-whitespace-");
    saveTestProfile(tmpDir);
    writeGeneratedSkills(tmpDir);
    writeGeneratedAgent(tmpDir, "planner", { skillsLine: `skills:   ${SLUG}-${ARCH}-plan  ` });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated agent content");
    const item = section.items.find((i) => i.message.includes(`${SLUG}-${ARCH}-planner`));
    assert.ok(item);
    assert.strictEqual(item.status, "ok");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content check skips agent files that do not exist on disk", () => {
    const tmpDir = makeTmpDir("doctor-content-missing-");
    saveTestProfile(tmpDir);
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated agent content");
    assert.strictEqual(section.items.length, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drift check skips with info when no manifest exists", () => {
    const tmpDir = makeTmpDir("doctor-drift-none-");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture drift");
    assert.strictEqual(section.items.length, 1);
    assert.strictEqual(section.items[0].status, "info");
    assert.ok(section.items[0].message.includes("skipped"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drift check warns when a generated file is deleted", () => {
    const tmpDir = makeTmpDir("doctor-drift-delete-");
    saveTestProfile(tmpDir);
    const agentRelPath = path.join(".pi", "agents", `${SLUG}-${ARCH}-planner.md`);
    writeFile(tmpDir, agentRelPath, "agent");
    writeGeneratedManifest(tmpDir, [path.join(tmpDir, agentRelPath)]);
    fs.rmSync(path.join(tmpDir, agentRelPath));
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture drift");
    const warning = section.items.find((i) => i.status === "warning");
    assert.ok(warning, "should warn about the deleted file");
    assert.ok(warning.message.includes("deleted"));
    assert.ok(warning.message.includes("planner.md"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drift check does not flag files written after the report in the same generation batch", () => {
    // Regression test: the old timestamp-based check flagged every generated
    // file because the factory writes the report before the other files.
    const tmpDir = makeTmpDir("doctor-drift-batch-");
    saveTestProfile(tmpDir);
    saveTestReport(tmpDir);
    writeFile(tmpDir, path.join(".pi", "architect", "architecture.md"), "written after the report, same batch");
    writeGeneratedManifest(tmpDir, [path.join(tmpDir, ".pi", "architect", "architecture.md")]);
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture drift");
    assert.strictEqual(section.items.filter((i) => i.status === "warning").length, 0);
    assert.strictEqual(section.items[0].status, "ok");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drift check ignores files that are not in the manifest", () => {
    const tmpDir = makeTmpDir("doctor-drift-foreign-");
    saveTestProfile(tmpDir);
    writeFile(tmpDir, path.join(".pi", "architect", "architecture.md"), "original");
    writeGeneratedManifest(tmpDir, [path.join(tmpDir, ".pi", "architect", "architecture.md")]);
    writeFile(tmpDir, path.join(".pi", "architect", "my-own-notes.md"), "user file, not generated");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture drift");
    assert.strictEqual(section.items.filter((i) => i.status === "warning").length, 0);
    assert.strictEqual(section.items[0].status, "ok");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeProjectPackage(cwd: string): void {
    writeFile(cwd, "package.json", JSON.stringify({ name: SLUG }));
  }

  function writeTeamAgent(cwd: string, role: string, body: string): void {
    const name = `${SLUG}-${role}`;
    writeFile(
      cwd,
      path.join(".pi", "agents", `${name}.md`),
      ["---", `name: ${name}`, "description: team agent", "tools: read", "---", "", `# ${name}`, "", body].join("\n"),
    );
  }

  it("team content check passes for a complete generated team agent", () => {
    const tmpDir = makeTmpDir("doctor-team-ok-");
    writeProjectPackage(tmpDir);
    writeTeamAgent(tmpDir, "scout-2", "## Your mandate\n\n- search code\n\n## Technology craft (Generic)\n\ncraft");
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": `${SLUG}-scout-2` } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated team agents");
    const item = section.items.find((i) => i.message.includes(`${SLUG}-scout-2`));
    assert.ok(item);
    assert.strictEqual(item.status, "ok");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("team content check errors when mandate or craft is missing", () => {
    const tmpDir = makeTmpDir("doctor-team-bad-");
    writeProjectPackage(tmpDir);
    writeTeamAgent(tmpDir, "scout-2", "no sections here");
    writeTeamAgent(tmpDir, "linter", "## Your mandate\n\n- lint\n");
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": `${SLUG}-scout-2`, linter: `${SLUG}-linter` } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated team agents");
    const scoutItem = section.items.find((i) => i.message.includes(`${SLUG}-scout-2`));
    const linterItem = section.items.find((i) => i.message.includes(`${SLUG}-linter`));
    assert.ok(scoutItem && scoutItem.status === "error");
    assert.ok(scoutItem.details?.some((d) => d.includes("mandate")));
    assert.ok(linterItem && linterItem.status === "error");
    assert.ok(linterItem.details?.some((d) => d.includes("Technology craft")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("team content check skips custom-mapped roles silently", () => {
    const tmpDir = makeTmpDir("doctor-team-skip-");
    writeProjectPackage(tmpDir);
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated team agents");
    assert.strictEqual(section.items.filter((i) => i.status === "error").length, 0);
    assert.strictEqual(section.items[0].status, "info");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check warns on a malformed project resource", () => {
    const tmpDir = makeTmpDir("doctor-res-bad-");
    writeFile(tmpDir, path.join(".pi", "technologies", "bad.md"), "---\nid: bad\nname: Bad\n---\n");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("bad.md"));
    assert.ok(warning, "should warn about the malformed resource");
    assert.ok(section.items.some((i) => i.status === "ok"), "bundled resources are valid");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check warns on missing template sections", () => {
    const tmpDir = makeTmpDir("doctor-res-sections-");
    writeFile(
      tmpDir,
      path.join(".pi", "technologies", "rust.md"),
      "---\nid: rust\nname: Rust\nkeywords: [rust]\n---\n\nJust some prose, no sections. (source: https://doc.rust-lang.org/)",
    );
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("rust.md"));
    assert.ok(warning);
    assert.ok(warning.details?.some((d) => d.includes("Core rules")));
    assert.ok(warning.details?.some((d) => d.includes("Testing patterns")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check warns when no official source is cited", () => {
    const tmpDir = makeTmpDir("doctor-res-nosrc-");
    writeFile(
      tmpDir,
      path.join(".pi", "technologies", "rust.md"),
      "---\nid: rust\nname: Rust\nkeywords: [rust]\n---\n\n## Core rules\n\n- x\n\n## Testing patterns\n\n- y\n\n## Tooling and limits\n\n- z\n",
    );
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("rust.md"));
    assert.ok(warning);
    assert.ok(warning.details?.some((d) => d.includes("sourcing rule")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check warns when the id is missing from keywords", () => {
    const tmpDir = makeTmpDir("doctor-res-idkey-");
    writeFile(
      tmpDir,
      path.join(".pi", "technologies", "rust.md"),
      "---\nid: rust\nname: Rust\nkeywords: [cargo]\n---\n\n## Core rules\n\n- x (source: https://doc.rust-lang.org/)\n\n## Testing patterns\n\n- y\n\n## Common mistakes\n\n- z\n",
    );
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("rust.md"));
    assert.ok(warning);
    assert.ok(warning.details?.some((d) => d.includes("keywords do not include")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skill reference check errors on a missing skill and accepts a valid one", () => {
    const tmpDir = makeTmpDir("doctor-skillref-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "my-reviewer.md"),
      ["---", "name: my-reviewer", "description: reviewer", "tools: read", "skills: my-skill, missing-skill", "---", "", "# my-reviewer", "", "body"].join("\n"),
    );
    writeFile(
      tmpDir,
      path.join(".pi", "skills", "my-skill", "SKILL.md"),
      ["---", "name: my-skill", "description: a valid skill", "---", "", "# my-skill", "", "content"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "code-review": "my-reviewer" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent skill references");
    const missing = section.items.find((i) => i.status === "error" && i.message.includes("missing-skill"));
    assert.ok(missing, "should error on the missing skill");
    assert.ok(!section.items.some((i) => i.message.includes('"my-skill"') && i.status !== "ok"), "valid skill passes");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skill reference check warns on an invalid SKILL.md", () => {
    const tmpDir = makeTmpDir("doctor-skillref-bad-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "my-reviewer.md"),
      ["---", "name: my-reviewer", "description: reviewer", "tools: read", "skills: bad-skill", "---", "", "# my-reviewer", "", "body"].join("\n"),
    );
    writeFile(tmpDir, path.join(".pi", "skills", "bad-skill", "SKILL.md"), "---\nname: bad-skill\n---\n\ncontent");
    saveAgentConfig(tmpDir, { version: 1, agents: { "code-review": "my-reviewer" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent skill references");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("bad-skill"));
    assert.ok(warning, "should warn about the invalid SKILL.md");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("integrity check errors on name mismatch and tool typos", () => {
    const tmpDir = makeTmpDir("doctor-integrity-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "real-file.md"),
      ["---", "name: different-name", "description: x", "tools: read, reed", "---", "", "# body"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "real-file" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent file integrity");
    const item = section.items.find((i) => i.message.includes("real-file"));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes("different-name") && d.includes("does not match the filename")));
    assert.ok(item.details?.some((d) => d.includes("reed")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("integrity check warns on a bad thinking level and errors on an empty body", () => {
    const tmpDir = makeTmpDir("doctor-integrity-2-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "thinker.md"),
      ["---", "name: thinker", "description: x", "tools: read", "thinking: turbo", "---", "", "# body"].join("\n"),
    );
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "empty-body.md"),
      ["---", "name: empty-body", "description: x", "tools: read", "---"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "thinker", linter: "empty-body" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent file integrity");
    const thinkerItem = section.items.find((i) => i.message.includes("thinker"));
    const emptyItem = section.items.find((i) => i.message.includes("empty-body"));
    assert.ok(thinkerItem && thinkerItem.status === "warning");
    assert.ok(thinkerItem.details?.some((d) => d.includes("turbo")));
    assert.ok(emptyItem && emptyItem.status === "error");
    assert.ok(emptyItem.details?.some((d) => d.includes("empty")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("secret scan warns on a planted api key and passes a clean tree", () => {
    const tmpDir = makeTmpDir("doctor-secret-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "leaky.md"),
      ["---", "name: leaky", "description: x", "tools: read", "---", "", '# Config\napi_key = "ABCDEFGH12345678"'].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "leaky" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Secret scan");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("leaky.md"));
    assert.ok(warning, "should flag the planted secret");
    assert.ok(warning.message.includes(":8"), "should include the line number");

    const cleanDir = makeTmpDir("doctor-secret-clean-");
    const cleanReport = runSenaiDiagnostic(cleanDir);
    const cleanSection = findSection(cleanReport, "Secret scan");
    assert.strictEqual(cleanSection.items.filter((i) => i.status === "warning").length, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(cleanDir, { recursive: true, force: true });
  });

  it("skill reference check resolves a bundled skill", () => {
    const tmpDir = makeTmpDir("doctor-skillref-bundled-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "my-planner.md"),
      ["---", "name: my-planner", "description: planner", "tools: read", "skills: senai-plan", "---", "", "# my-planner", "", "body"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { planner: "my-planner" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent skill references");
    assert.strictEqual(section.items.filter((i) => i.status === "error").length, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skill reference check reports info when no agents reference skills", () => {
    const tmpDir = makeTmpDir("doctor-skillref-none-");
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent skill references");
    assert.strictEqual(section.items.length, 1);
    assert.strictEqual(section.items[0].status, "info");
    assert.ok(section.items[0].message.includes("No agents reference skills"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check accepts comma-string keywords", () => {
    const tmpDir = makeTmpDir("doctor-res-commas-");
    writeFile(
      tmpDir,
      path.join(".pi", "technologies", "rust.md"),
      '---\nid: rust\nname: Rust\nkeywords: "rust, cargo"\n---\n\n## Core rules\n\n- x (source: https://doc.rust-lang.org/)\n\n## Testing patterns\n\n- y\n\n## Common mistakes\n\n- z\n',
    );
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    assert.ok(!section.items.some((i) => i.message.includes("rust.md")), "comma-string keywords should be valid");
    assert.ok(section.items.some((i) => i.status === "ok"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check warns when keywords are empty", () => {
    const tmpDir = makeTmpDir("doctor-res-nokey-");
    writeFile(
      tmpDir,
      path.join(".pi", "technologies", "nokey.md"),
      "---\nid: nokey\nname: NoKey\nkeywords: []\n---\n\nBody exists.",
    );
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("nokey.md"));
    assert.ok(warning);
    assert.ok(warning.details?.some((d) => d.includes("no keywords")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("integrity check accepts ext: tool names and rejects unknown ones", () => {
    const tmpDir = makeTmpDir("doctor-integrity-ext-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "ext-ok.md"),
      ["---", "name: ext-ok", "description: x", "tools: read, ext:mcp/search", "---", "", "# body"].join("\n"),
    );
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "ext-bad.md"),
      ["---", "name: ext-bad", "description: x", "tools: read, ext", "---", "", "# body"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "ext-ok", "scout-3": "ext-bad" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent file integrity");
    assert.ok(!section.items.some((i) => i.message.includes("ext-ok")), "ext: tool names should pass");
    const badItem = section.items.find((i) => i.message.includes("ext-bad"));
    assert.ok(badItem && badItem.status === "error");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("integrity check reports all problems of one agent in a single item", () => {
    const tmpDir = makeTmpDir("doctor-integrity-multi-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "multi.md"),
      ["---", "name: wrong-name", "description: x", "tools: reed", "thinking: turbo", "---"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "multi" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent file integrity");
    const items = section.items.filter((i) => i.message.includes("multi"));
    assert.strictEqual(items.length, 1, "one agent should produce one item");
    assert.strictEqual(items[0].status, "error");
    assert.ok(items[0].details && items[0].details.length >= 3, "all problems listed");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("secret scan reports each secret with its own line number", () => {
    const tmpDir = makeTmpDir("doctor-secret-multi-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "leaky2.md"),
      [
        "---", "name: leaky2", "description: x", "tools: read", "---", "",
        'api_key = "FIRSTKEY123456"',
        "some normal line",
        'token = "SECOND.TOKEN.1234"',
      ].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "leaky2" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Secret scan");
    const warnings = section.items.filter((i) => i.status === "warning" && i.message.includes("leaky2.md"));
    assert.strictEqual(warnings.length, 2);
    assert.ok(warnings.some((i) => i.message.includes(":7")));
    assert.ok(warnings.some((i) => i.message.includes(":9")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("secret scan covers senai config json files", () => {
    const tmpDir = makeTmpDir("doctor-secret-config-");
    saveAgentConfig(tmpDir, { version: 1, agents: { planner: "sk-ABCDEFGHIJKLMNOPQRSTUV" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Secret scan");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("agents.json"));
    assert.ok(warning, "should flag the secret inside agents.json");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("team content check errors when the tools frontmatter line is missing", () => {
    const tmpDir = makeTmpDir("doctor-team-notools-");
    writeProjectPackage(tmpDir);
    const name = `${SLUG}-scout-2`;
    writeFile(
      tmpDir,
      path.join(".pi", "agents", `${name}.md`),
      ["---", `name: ${name}`, "description: team agent", "---", "", `# ${name}`, "", "## Your mandate", "", "- search", "", "## Technology craft (Generic)", "", "craft"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": name } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated team agents");
    const item = section.items.find((i) => i.message.includes(name));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes("tools: line")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full-green project produces zero errors across all sections", () => {
    const tmpDir = makeTmpDir("doctor-green-");
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: {
        "scout-1": `${SLUG}-${ARCH}-planner`,
        planner: `${SLUG}-${ARCH}-planner`,
        implementer: `${SLUG}-${ARCH}-implementer`,
        "reviewer-correctness": `${SLUG}-${ARCH}-reviewer-correctness`,
        "reviewer-security": `${SLUG}-${ARCH}-reviewer-security`,
        "reviewer-tests": `${SLUG}-${ARCH}-reviewer-tests`,
        "code-review": `${SLUG}-${ARCH}-reviewer-correctness`,
      },
    });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["README.md"],
      testPaths: ["tests/"],
      excludedPaths: [".git/"],
    });
    writeFile(tmpDir, "src/index.ts");
    writeFile(tmpDir, "README.md");
    writeFile(tmpDir, "tests/index.test.ts");
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "readme", path: "README.md" }],
      additionalConstraints: [],
    });
    writeFile(
      tmpDir,
      path.join(".pi", "architecture-library", "modular-monolith.md"),
      "---\nname: modular-monolith\n---\n# Modular Monolith",
    );
    saveTestProfile(tmpDir);
    saveTestReport(tmpDir);
    writeGeneratedSkills(tmpDir);
    for (const role of GENERATED_ROLES) writeGeneratedAgent(tmpDir, role);
    writeFile(tmpDir, path.join(".pi", "architect", "architecture.md"), "# Architecture");
    writeGeneratedManifest(tmpDir, [
      ...GENERATED_ROLES.map((r) => path.join(tmpDir, ".pi", "agents", `${SLUG}-${ARCH}-${r}.md`)),
      ...["plan", "implement", "document", "deliver"].map((s) =>
        path.join(tmpDir, ".pi", "skills", `${SLUG}-${ARCH}-${s}`, "SKILL.md"),
      ),
      path.join(tmpDir, ".pi", "architect", "architecture.md"),
    ]);

    const report = runSenaiDiagnostic(tmpDir);
    assert.strictEqual(report.summary.error, 0, "no section may contain an error on a healthy project");
    assert.strictEqual(report.ok, true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("formatDiagnosticReport renders pass and fail verdicts", () => {
    const passDir = makeTmpDir("doctor-verdict-pass-");
    saveAgentConfig(passDir, { version: 1, agents: {} });
    saveFilesConfig(passDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: [],
      testPaths: [],
      excludedPaths: [],
    });
    writeFile(passDir, "src/index.ts");
    saveAgentsFilesConfig(passDir, { version: 2, documents: {} });
    const passText = formatDiagnosticReport(runSenaiDiagnostic(passDir));
    assert.ok(passText.includes("✅ Configuration looks good."));
    fs.rmSync(passDir, { recursive: true, force: true });

    const failDir = makeTmpDir("doctor-verdict-fail-");
    const failText = formatDiagnosticReport(runSenaiDiagnostic(failDir));
    assert.ok(failText.includes("❌ Please fix the errors above"));
    fs.rmSync(failDir, { recursive: true, force: true });
  });
});
