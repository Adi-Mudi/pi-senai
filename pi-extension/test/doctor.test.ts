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
        "security-gate": "write-heavy-gate",
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

    writeAgent(tmpDir, "write-heavy-gate", {
      name: "write-heavy-gate",
      description: "Custom gate agent",
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

  it("reports invalid agents.json without crashing", () => {
    const tmpDir = makeTmpDir("doctor-invalid-agents-");

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

    // Write an invalid agents config (malformed JSON).
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "agents.json"), "{ not valid json", "utf8");

    const report = runSenaiDiagnostic(tmpDir);
    const configSection = report.sections.find((s) => s.title === "Configuration files");
    assert.ok(configSection);

    const invalidAgents = configSection.items.find((i) => i.message.includes("Invalid agent config"));
    assert.ok(invalidAgents, "doctor should report invalid agents.json as an error instead of crashing");
    assert.strictEqual(invalidAgents.status, "error");
    assert.ok(invalidAgents.details?.some((d) => d.includes("/senai-configure-agents")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports invalid agents_files.json without crashing", () => {
    const tmpDir = makeTmpDir("doctor-invalid-agents-files-");

    saveAgentConfig(tmpDir, { version: 1, agents: {} });
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

    // Write an invalid agents_files config (malformed JSON).
    fs.mkdirSync(path.join(tmpDir, ".pi", "senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "senai", "agents_files.json"), "{ not valid json", "utf8");

    const report = runSenaiDiagnostic(tmpDir);
    const configSection = report.sections.find((s) => s.title === "Configuration files");
    assert.ok(configSection);

    const invalidAgentsFiles = configSection.items.find((i) => i.message.includes("Invalid agents_files config"));
    assert.ok(invalidAgentsFiles, "doctor should report invalid agents_files.json as an error instead of crashing");
    assert.strictEqual(invalidAgentsFiles.status, "error");
    assert.ok(invalidAgentsFiles.details?.some((d) => d.includes("/senai-configure-agents-files")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writer roles accept write tools and require them", () => {
    const tmpDir = makeTmpDir("doctor-writer-roles-");

    saveAgentConfig(tmpDir, {
      version: 1,
      agents: {
        "reviewer-correctness": "writer-reviewer",
        planner: "read-only-planner",
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

    writeAgent(tmpDir, "writer-reviewer", {
      name: "writer-reviewer",
      description: "Reviewer that writes review files",
      tools: "read, write",
      output: "single",
    });
    writeAgent(tmpDir, "read-only-planner", {
      name: "read-only-planner",
      description: "Planner without write tool",
      tools: "read",
      output: "single",
    });

    const report = runSenaiDiagnostic(tmpDir);
    const roleSection = report.sections.find((s) => s.title === "Agent-role capability fit");
    assert.ok(roleSection);

    const readonlyWarning = roleSection.items.find(
      (i) => i.message.includes("writer-reviewer") && i.message.includes("read-only") && i.status === "warning",
    );
    assert.ok(!readonlyWarning, "writer role with write tool should not get a read-only warning");

    const missingWrite = roleSection.items.find(
      (i) => i.message.includes("read-only-planner") && i.message.includes("MISSING REQUIRED TOOLS"),
    );
    assert.ok(missingWrite, "writer role without write tool should be an error");
    assert.strictEqual(missingWrite.status, "error");
    assert.ok(missingWrite.details?.some((d) => d.includes("write")));

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

  it("config check warns on agents.json version 2 and silently migrates agents_files.json version 1", () => {
    const tmpDir = makeTmpDir("doctor-config-version-");
    saveAgentConfig(tmpDir, { version: 2, agents: {} });
    // saveAgentsFilesConfig always writes version 2, so write the v1 file directly.
    writeFile(tmpDir, path.join(".pi", "senai", "agents_files.json"), JSON.stringify({ version: 1, documents: {} }));

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Configuration files");

    const agentsWarning = section.items.find(
      (i) => i.status === "warning" && i.message.includes("agents.json version is 2; expected 1"),
    );
    assert.ok(agentsWarning, "agents.json version 2 should produce a version warning");

    const agentsFilesOk = section.items.find(
      (i) => i.status === "ok" && i.message.includes("agents_files.json found and valid"),
    );
    assert.ok(agentsFilesOk, "agents_files.json version 1 should still load");
    // NOTE: version 1 is silently migrated to 2 on load, so no version warning is emitted.
    assert.ok(
      !section.items.some((i) => i.message.includes("agents_files.json version")),
      "no agents_files.json version warning is emitted for a migrated v1 file",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mapping check notes a project agent shadowing a built-in with the same name", () => {
    const tmpDir = makeTmpDir("doctor-shadow-");
    writeAgent(tmpDir, "scout", {
      name: "scout",
      description: "Project scout overriding the built-in",
      tools: "read",
    });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent mapping sources");
    const scoutItem = section.items.find((i) => i.message.includes("(scout-2)"));
    assert.ok(scoutItem);
    assert.strictEqual(scoutItem.status, "info");
    assert.ok(
      scoutItem.details?.some((d) => d.includes("a built-in agent with the same name is shadowed")),
      "shadowed built-in should be noted",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mapping check errors when the agent file frontmatter is unreadable", () => {
    const tmpDir = makeTmpDir("doctor-unreadable-");
    // Missing description -> parseAgentFileFull returns undefined.
    writeFile(tmpDir, path.join(".pi", "agents", "broken.md"), "---\nname: broken\n---\n\n# broken\n");
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-3": "broken" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent mapping sources");
    const item = section.items.find((i) => i.message.includes("(scout-3)") && i.message.includes("broken"));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.message.includes("frontmatter is unreadable"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("capability check reports info for a custom agent without a tools list", () => {
    const tmpDir = makeTmpDir("doctor-no-tools-");
    writeAgent(tmpDir, "no-tools-agent", {
      name: "no-tools-agent",
      description: "An agent that declares no tools",
    });
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "no-tools-agent" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent-role capability fit");
    const item = section.items.find((i) => i.message.includes("no-tools-agent"));
    assert.ok(item);
    assert.strictEqual(item.status, "info");
    assert.ok(item.message.includes("no explicit tools list"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("capability check warns on an explicit empty tools list", () => {
    const tmpDir = makeTmpDir("doctor-empty-tools-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "empty-tools.md"),
      ["---", "name: empty-tools", "description: Agent with empty tools", "tools: []", "---", "", "# empty-tools"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-3": "empty-tools" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent-role capability fit");
    const item = section.items.find((i) => i.message.includes("empty-tools"));
    assert.ok(item);
    assert.strictEqual(item.status, "warning");
    assert.ok(item.message.includes("explicit tools list is empty"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("capability check warns for a read-only role holding write and for an output preference", () => {
    const tmpDir = makeTmpDir("doctor-cap-warnings-");
    writeAgent(tmpDir, "write-scout", {
      name: "write-scout",
      description: "Scout that can write",
      tools: "read, write",
    });
    writeAgent(tmpDir, "output-scout", {
      name: "output-scout",
      description: "Scout with an output preference",
      tools: "read",
      output: "single",
    });
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { "scout-2": "write-scout", "scout-4": "output-scout" },
    });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent-role capability fit");

    const readonlyWarning = section.items.find(
      (i) => i.message.includes("write-scout") && i.message.includes("has write tool but role is read-only"),
    );
    assert.ok(readonlyWarning);
    assert.strictEqual(readonlyWarning.status, "warning");

    const outputWarning = section.items.find(
      (i) => i.message.includes("output-scout") && i.message.includes('has output="single"'),
    );
    assert.ok(outputWarning);
    assert.strictEqual(outputWarning.status, "warning");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("file scope warns per category when nothing is configured", () => {
    const tmpDir = makeTmpDir("doctor-scope-empty-");
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: [],
      testPaths: [],
      excludedPaths: [],
    });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Project file scope");
    const warnings = section.items.filter((i) => i.status === "warning" && i.message.includes("none configured"));
    assert.strictEqual(warnings.length, 3);
    assert.ok(section.items.some((i) => i.message.includes("Code paths: none configured")));
    assert.ok(section.items.some((i) => i.message.includes("Input documents: none configured")));
    assert.ok(section.items.some((i) => i.message.includes("Test paths: none configured")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("file scope does not treat src and src/ as a conflict", () => {
    const tmpDir = makeTmpDir("doctor-scope-edge-");
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src"],
      inputDocuments: [],
      testPaths: ["src/"],
      excludedPaths: [],
    });
    writeFile(tmpDir, "src/index.ts");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Project file scope");
    assert.ok(
      !section.items.some((i) => i.message.includes("Path conflicts")),
      "trailing-slash variant of the same folder is not a conflict",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("file scope flags the same path listed twice as a conflict", () => {
    const tmpDir = makeTmpDir("doctor-scope-dup-");
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src", "src"],
      inputDocuments: [],
      testPaths: [],
      excludedPaths: [],
    });
    writeFile(tmpDir, "src/index.ts");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Project file scope");
    const conflict = section.items.find((i) => i.message.includes("Path conflicts"));
    assert.ok(conflict);
    assert.strictEqual(conflict.status, "error");
    assert.ok(conflict.details?.some((d) => d.includes("src overlaps src")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("agents_files check is ok when the truth document exists and is in the inputDocuments scope", () => {
    const tmpDir = makeTmpDir("doctor-agents-files-ok-");
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: ["docs/prd.md"],
      testPaths: [],
      excludedPaths: [],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: { "scout-1": { primary: "docs/prd.md" } } });
    writeFile(tmpDir, "docs/prd.md", "# PRD");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent document assignments");
    const item = section.items.find((i) => i.message.includes("truth document: docs/prd.md"));
    assert.ok(item);
    assert.strictEqual(item.status, "ok");
    assert.ok(item.details?.some((d) => d.includes("in the inputDocuments scope")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("agents_files check warns when the truth document exists outside the inputDocuments scope", () => {
    const tmpDir = makeTmpDir("doctor-agents-files-scope-");
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: [],
      testPaths: [],
      excludedPaths: [],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: { "scout-1": { primary: "docs/prd.md" } } });
    writeFile(tmpDir, "docs/prd.md", "# PRD");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent document assignments");
    const item = section.items.find((i) => i.message.includes("truth document: docs/prd.md"));
    assert.ok(item);
    assert.strictEqual(item.status, "warning");
    assert.ok(item.details?.some((d) => d.includes("NOT in the inputDocuments scope")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("agents_files check errors on a missing comparison document", () => {
    const tmpDir = makeTmpDir("doctor-agents-files-missing-");
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: { "scout-1": { reads: ["docs/missing.md"] } } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent document assignments");
    const item = section.items.find((i) => i.message.includes("comparison document MISSING: docs/missing.md"));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("agents_files check reports info when no assignments exist", () => {
    const tmpDir = makeTmpDir("doctor-agents-files-none-");
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent document assignments");
    assert.strictEqual(section.items.length, 1);
    assert.strictEqual(section.items[0].status, "info");
    assert.ok(section.items[0].message.includes("No per-role document assignments configured"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("environment check is ok when running inside tmux", () => {
    const tmpDir = makeTmpDir("doctor-env-tmux-");
    const previous = process.env.TMUX;
    process.env.TMUX = "1";
    try {
      const report = runSenaiDiagnostic(tmpDir);
      const section = findSection(report, "Runtime environment");
      assert.strictEqual(section.items.length, 1);
      assert.strictEqual(section.items[0].status, "ok");
      assert.ok(section.items[0].message.includes("tmux"));
    } finally {
      if (previous === undefined) {
        delete process.env.TMUX;
      } else {
        process.env.TMUX = previous;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("architecture setup warns on non-high confidence and counts a non-empty library", () => {
    const tmpDir = makeTmpDir("doctor-arch-confidence-");
    saveTestProfile(tmpDir);
    saveArchitectReport(tmpDir, {
      selectedArchitecture: ARCH,
      confidence: "medium",
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
    writeFile(
      tmpDir,
      path.join(".pi", "architecture-library", "modular-monolith.md"),
      "---\nname: modular-monolith\n---\n# Modular Monolith",
    );

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture setup");

    const confidence = section.items.find((i) => i.message.includes("medium confidence"));
    assert.ok(confidence);
    assert.strictEqual(confidence.status, "warning");

    const library = section.items.find((i) => i.message.includes("Architecture library has 1 entries."));
    assert.ok(library);
    assert.strictEqual(library.status, "ok");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("architecture setup errors when only some ADR files exist", () => {
    const tmpDir = makeTmpDir("doctor-arch-adr-partial-");
    saveTestProfile(tmpDir);
    saveArchitectReport(tmpDir, {
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
      adrs: [
        { id: "0001", title: "First decision", context: "c", decision: "d", consequences: "x" },
        { id: "0002", title: "Second decision", context: "c", decision: "d", consequences: "x" },
      ],
      constraints: [],
    });
    writeFile(tmpDir, path.join(".pi", "architect", "adrs", "0001-first-decision.md"), "# ADR 1");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture setup");
    const item = section.items.find((i) => i.message.includes("Found 1 of 2 expected ADRs"));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("architecture setup warns when no ADR entry has a valid id and title", () => {
    const tmpDir = makeTmpDir("doctor-arch-adr-invalid-");
    saveTestProfile(tmpDir);
    // A non-array adrs field survives loadArchitectReport untouched; iterating it
    // yields no entries with a valid id/title, which triggers the warning branch.
    saveArchitectReport(tmpDir, {
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
      adrs: "garbage" as unknown as [],
      constraints: [],
    });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture setup");
    const item = section.items.find((i) => i.message.includes("none have a valid id and title"));
    assert.ok(item);
    assert.strictEqual(item.status, "warning");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("architecture setup errors on a misnamed architecture agent file", () => {
    const tmpDir = makeTmpDir("doctor-arch-misnamed-");
    saveTestProfile(tmpDir);
    writeFile(
      tmpDir,
      path.join(".pi", "agents", `${SLUG}-${ARCH}-wrongname.md`),
      "---\nname: wrong\n---\n# wrong",
    );

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture setup");
    const item = section.items.find((i) => i.message.includes("misnamed architecture agents found"));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes(`${SLUG}-${ARCH}-wrongname.md`)));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("architecture setup errors when a configured input document is missing", () => {
    const tmpDir = makeTmpDir("doctor-arch-missing-doc-");
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "prd", path: "docs/missing.md" }],
      additionalConstraints: [],
    });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture setup");
    const item = section.items.find((i) => i.message.includes("configured architect input documents are missing"));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes("docs/missing.md")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("team content check reports info when no generated team agents exist", () => {
    const tmpDir = makeTmpDir("doctor-team-none-");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated team agents");
    assert.strictEqual(section.items.length, 1);
    assert.strictEqual(section.items[0].status, "info");
    assert.ok(section.items[0].message.includes("No generated team agents found"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check reports ok when all resources are valid", () => {
    const tmpDir = makeTmpDir("doctor-res-ok-");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    const okItem = section.items.find((i) => i.status === "ok" && i.message.includes("technology resource(s) valid"));
    assert.ok(okItem, "bundled resources should produce a single ok item");
    assert.ok(!section.items.some((i) => i.status === "warning"), "no warnings on a clean tree");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check catches an unparseable resource file", () => {
    const tmpDir = makeTmpDir("doctor-res-unparseable-");
    // A directory named *.md makes readFileSync throw, hitting the catch branch.
    fs.mkdirSync(path.join(tmpDir, ".pi", "technologies", "bad.md"), { recursive: true });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("bad.md"));
    assert.ok(warning);
    assert.ok(warning.details?.some((d) => d.includes("could not be parsed")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("integrity check reports a single ok item when all agents are valid", () => {
    const tmpDir = makeTmpDir("doctor-integrity-ok-");
    writeAgent(tmpDir, "good-agent", {
      name: "good-agent",
      description: "A well-formed agent",
      tools: "read",
    });
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "good-agent" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent file integrity");
    assert.strictEqual(section.items.length, 1);
    assert.strictEqual(section.items[0].status, "ok");
    assert.ok(section.items[0].message.includes("All mapped agent files are internally valid"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("secret scan flags each pattern with line numbers, scans skills, and skips unreadable files", () => {
    const tmpDir = makeTmpDir("doctor-secret-patterns-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "leaky3.md"),
      [
        "---",
        "name: leaky3",
        "description: x",
        "tools: read",
        "---",
        "# Config",
        "-----BEGIN RSA PRIVATE KEY-----",
        'api = "sk-ABCDEFGHIJKLMNOPQRSTUVWX"',
        'google = "AIza12345678901234567890123"',
        "password=hunter2secret",
      ].join("\n"),
    );
    writeFile(tmpDir, path.join(".pi", "skills", "leaky-skill", "SKILL.md"), 'token = "ABCDEFGHIJKLMNOP"');
    // A directory named *.md cannot be read as a file; the scan must skip it.
    fs.mkdirSync(path.join(tmpDir, ".pi", "agents", "unreadable.md"));

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Secret scan");

    const leaky = section.items.filter((i) => i.status === "warning" && i.message.includes("leaky3.md"));
    assert.strictEqual(leaky.length, 4);
    assert.ok(leaky.some((i) => i.message.includes(":7")), "BEGIN PRIVATE KEY line flagged");
    assert.ok(leaky.some((i) => i.message.includes(":8")), "sk-... line flagged");
    assert.ok(leaky.some((i) => i.message.includes(":9")), "AIza... line flagged");
    assert.ok(leaky.some((i) => i.message.includes(":10")), "password= line flagged");

    const skillWarning = section.items.find(
      (i) => i.status === "warning" && i.message.includes(path.join("leaky-skill", "SKILL.md")),
    );
    assert.ok(skillWarning, "SKILL.md inside .pi/skills/<dir>/ is scanned");

    assert.ok(
      !section.items.some((i) => i.message.includes("unreadable.md")),
      "unreadable files are skipped without crashing",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("doctor setup progress", () => {
  const PROGRESS_SLUG = "testproj";

  function findProgress(report: ReturnType<typeof runSenaiDiagnostic>) {
    const section = report.sections.find((s) => s.title === "Setup progress");
    assert.ok(section, "Setup progress section should exist");
    return section;
  }

  function guidanceMessage(section: { items: Array<{ status: string; message: string }> }): string {
    const item = section.items.find(
      (i) => i.message.includes("Next: run") || i.message.includes("Setup complete"),
    );
    assert.ok(item, "a guidance item should exist");
    return item.message;
  }

  function writeMinimalReport(cwd: string): void {
    saveArchitectReport(cwd, {
      selectedArchitecture: "modular-monolith",
      confidence: "high",
      missingResources: [],
      reasoning: "ok",
      skillProfile: { recommendedAgents: [], forbiddenPatterns: [] },
      developmentOrder: [],
      feasibility: "feasible",
      feasibilityReasoning: "ok",
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

  function setupThrough(step: number): string {
    const tmpDir = makeTmpDir("doctor-progress-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: PROGRESS_SLUG }), "utf8");
    if (step >= 1) {
      saveFilesConfig(tmpDir, { version: 2, codePaths: [], inputDocuments: [], testPaths: [], excludedPaths: [] });
    }
    if (step >= 2) {
      saveArchitectInputsConfig(tmpDir, { version: 1, documents: [], additionalConstraints: [] });
    }
    if (step >= 3) {
      writeMinimalReport(tmpDir);
    }
    if (step >= 4) {
      saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": `${PROGRESS_SLUG}-scout-2` } });
      writeAgent(tmpDir, `${PROGRESS_SLUG}-scout-2`, {
        name: `${PROGRESS_SLUG}-scout-2`,
        description: "generated team agent",
      });
    }
    if (step >= 5) {
      saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    }
    return tmpDir;
  }

  it("empty project points at /senai-configure-files and leads the report", () => {
    const tmpDir = setupThrough(0);
    const report = runSenaiDiagnostic(tmpDir);
    assert.strictEqual(report.sections[0].title, "Setup progress", "progress section is first");
    const section = findProgress(report);
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-files"));
    assert.ok(section.items.some((i) => i.message.startsWith("1. Project files configured — pending")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("with only files.json the next step is /senai-configure-architect-inputs", () => {
    const tmpDir = setupThrough(1);
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-architect-inputs"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("with architect inputs done the next step is /senai-generate-architect", () => {
    const tmpDir = setupThrough(2);
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-generate-architect"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("with an architect report the next step is /senai-generate-sub-agents", () => {
    const tmpDir = setupThrough(3);
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-generate-sub-agents"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("with a generated team agent the next step is /senai-configure-agents-files", () => {
    const tmpDir = setupThrough(4);
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-agents-files"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fully configured project reports setup complete", () => {
    const tmpDir = setupThrough(5);
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Setup complete — run /senai-plan <mission>"));
    assert.ok(section.items.some((i) => i.message.startsWith("7. First run — ready")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits no error items, so the verdict is unaffected", () => {
    const tmpDir = setupThrough(0);
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(!section.items.some((i) => i.status === "error"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("counts completed checks in the guidance line", () => {
    const tmpDir = setupThrough(2);
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("2/5 checks complete"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
