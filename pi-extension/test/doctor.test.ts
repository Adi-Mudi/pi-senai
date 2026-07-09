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
