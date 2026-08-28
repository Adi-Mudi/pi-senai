import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSenaiDiagnostic, formatDiagnosticReport, significantWords, wordsOverlap, mandateTextForRole, documentSignalWords, compareVersions, type ResolvedAgent } from "../src/doctor.js";
import { saveAgentConfig } from "../src/agent-config.js";
import { saveFilesConfig } from "../src/files-config.js";
import { saveAgentsFilesConfig } from "../src/agents-files-config.js";
import { saveArchitectInputsConfig } from "../src/architect-inputs-config.js";
import { saveArchitectProfile, saveArchitectReport, writeGeneratedManifest } from "../src/architect.js";
import { getProjectSlug, GENERATOR_VERSION } from "../src/agent-generator.js";
import { createEmptyDrivers, saveDrivers } from "../src/driver-extractor.js";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { defaultState, saveState } from "../src/state.js";
import { generateDocsStructure } from "../src/doc-selection.js";

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
        linter: "write-heavy-gate",
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

    // linter writes a report artifact since generator v3 — write is required,
    // not a conflict. The output preference is still flagged.
    const readonlyMismatch = roleSection.items.find(
      (i) => i.message.includes("write-heavy-gate") && i.message.includes("read-only"),
    );
    assert.ok(!readonlyMismatch, "linter with write is correct — no read-only warning");

    const outputWarning = roleSection.items.find(
      (i) => i.message.includes("write-heavy-gate") && i.message.includes('has output="single"'),
    );
    assert.ok(outputWarning, "doctor should warn about the output preference");

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

  it("drift advice names the right regenerate command per file type", () => {
    const tmpDir = makeTmpDir("doctor-drift-advice-");
    saveTestProfile(tmpDir);
    writeProjectPackage(tmpDir);
    const teamRel = path.join(".pi", "agents", `${SLUG}-scout-2.md`);
    const archRel = path.join(".pi", "architect", "architecture.md");
    writeFile(tmpDir, teamRel, "team agent");
    writeFile(tmpDir, archRel, "arch doc");
    writeGeneratedManifest(tmpDir, [path.join(tmpDir, teamRel), path.join(tmpDir, archRel)]);
    fs.rmSync(path.join(tmpDir, teamRel));
    fs.rmSync(path.join(tmpDir, archRel));

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Architecture drift");
    const teamItem = section.items.find((i) => i.message.includes(teamRel));
    const archItem = section.items.find((i) => i.message.includes(archRel));
    assert.ok(teamItem?.details?.some((d) => d.includes("/senai-generate-sub-agents")), "team agent advice must name the sub-agent command");
    assert.ok(!teamItem?.details?.some((d) => d.includes("generate-architect")));
    assert.ok(archItem?.details?.some((d) => d.includes("/senai-generate-architect")), "architecture advice unchanged");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("team content check warns when a generated agent is from an older pi-senai version", () => {
    const tmpDir = makeTmpDir("doctor-team-stale-");
    writeProjectPackage(tmpDir);
    // Old-format file: complete sections but no generator version footer.
    writeTeamAgent(tmpDir, "scout-2", "## Your mandate\n\n- search code\n\n## Technology craft (Generic)\n\ncraft");
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": `${SLUG}-scout-2` } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated team agents");
    const item = section.items.find((i) => i.message.includes(`${SLUG}-scout-2`));
    assert.ok(item);
    assert.strictEqual(item.status, "warning");
    assert.ok(item.message.includes("older pi-senai version"));
    assert.ok(item.details?.some((d) => d.includes("/senai-generate-sub-agents")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("team content check reports orphaned generated agents (marker present, no role mapped)", () => {
    const tmpDir = makeTmpDir("doctor-team-orphan-");
    writeProjectPackage(tmpDir);
    // Generated team agent file, but the role was remapped to a custom agent.
    writeFile(
      tmpDir,
      path.join(".pi", "agents", `${SLUG}-scout-2.md`),
      ["---", `name: ${SLUG}-scout-2`, "description: Scout 2. Generated by pi-senai.", "tools: read", "---", "", "body"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "my-custom-scout" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated team agents");
    const orphan = section.items.find((i) => i.message.includes("Orphaned generated agent"));
    assert.ok(orphan, "should report the orphaned generated agent");
    assert.strictEqual(orphan.status, "info");
    assert.ok(orphan.message.includes(`${SLUG}-scout-2`));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("team content check ignores hand-made agents without the marker", () => {
    const tmpDir = makeTmpDir("doctor-team-handmade-");
    writeProjectPackage(tmpDir);
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "my-helper.md"),
      ["---", "name: my-helper", "description: hand-made agent", "tools: read", "---", "", "body"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Generated team agents");
    assert.ok(!section.items.some((i) => i.message.includes("Orphaned")), "hand-made agents are never flagged");
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
    writeTeamAgent(tmpDir, "scout-2", `## Your mandate\n\n- search code\n\n## Technology craft (Generic)\n\ncraft\n\n---\n_Generated by pi-senai (generator v${GENERATOR_VERSION}) from technology resource(s): \`generic\`._`);
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

  it("resource check reports bundled resources when the project tech dir is missing", () => {
    // Exercises the `if (!fs.existsSync(dir)) continue;` branch: no
    // .pi/technologies/ directory is created at all.
    const tmpDir = makeTmpDir("doctor-res-nodir-");
    assert.ok(!fs.existsSync(path.join(tmpDir, ".pi", "technologies")));
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    assert.strictEqual(
      section.items.filter((i) => i.status === "error").length,
      0,
      "a missing project tech dir is not an error",
    );
    assert.ok(section.items.some((i) => i.status === "ok"), "bundled resources are still checked");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check accepts a present-but-empty project tech dir", () => {
    const tmpDir = makeTmpDir("doctor-res-emptydir-");
    fs.mkdirSync(path.join(tmpDir, ".pi", "technologies"), { recursive: true });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Technology resources");
    assert.strictEqual(section.items.filter((i) => i.status === "error").length, 0);
    assert.ok(section.items.some((i) => i.status === "ok"), "bundled resources are still checked");
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

  it("integrity check warns when an agent pins a model, and stays clean without one", () => {
    const tmpDir = makeTmpDir("doctor-integrity-model-");
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "pinned.md"),
      ["---", "name: pinned", "description: x", "tools: read", "model: anthropic/claude-haiku-4-5", "---", "", "# body"].join("\n"),
    );
    writeFile(
      tmpDir,
      path.join(".pi", "agents", "clean.md"),
      ["---", "name: clean", "description: x", "tools: read", "---", "", "# body"].join("\n"),
    );
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "pinned", "scout-3": "clean" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent file integrity");
    const pinnedItem = section.items.find((i) => i.message.includes("pinned"));
    assert.ok(pinnedItem, "should report the pinned agent");
    assert.strictEqual(pinnedItem.status, "warning");
    assert.ok(
      pinnedItem.details?.some((d) => d.includes("anthropic/claude-haiku-4-5") && d.includes("default model")),
      "should name the pinned model and explain the default-model impact",
    );
    assert.ok(
      !section.items.some((i) => i.message.includes("clean")),
      "agent without a model field must not be flagged",
    );
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

  it("capability check accepts a linter holding write and warns for an output preference", () => {
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
      agents: { linter: "write-scout", "scout-4": "output-scout" },
    });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Agent-role capability fit");

    // linter requires write since generator v3; tools "read, write" still miss bash.
    const readonlyWarning = section.items.find(
      (i) => i.message.includes("write-scout") && i.message.includes("has write tool but role is read-only"),
    );
    assert.ok(!readonlyWarning, "no read-only warning — the role now writes a report artifact");

    const missingBash = section.items.find(
      (i) => i.message.includes("write-scout") && i.message.includes("MISSING REQUIRED TOOLS"),
    );
    assert.ok(missingBash, "linter without bash should error");
    assert.ok(missingBash.details?.some((d) => d.includes("bash")), "names the missing bash tool");

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
      const tmuxItem = section.items.find((i) => i.message.includes("tmux"));
      assert.ok(tmuxItem);
      assert.strictEqual(tmuxItem.status, "ok");
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
      saveAgentsFilesConfig(tmpDir, { version: 2, documents: { planner: { primary: "docs/PRD.md" } } });
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

  function corrupt(cwd: string, relPath: string): void {
    writeFile(cwd, relPath, "{ not valid json");
  }

  it("corrupted files.json leaves step 1 pending", () => {
    const tmpDir = setupThrough(1);
    corrupt(tmpDir, ".pi/senai/files.json");
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-files"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("corrupted architect-inputs.json leaves step 2 pending and is reported, not fatal", () => {
    const tmpDir = setupThrough(2);
    corrupt(tmpDir, ".pi/senai/architect-inputs.json");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findProgress(report);
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-architect-inputs"));
    const setup = report.sections.find((s) => s.title === "Architecture setup");
    assert.ok(
      setup?.items.some((i) => i.status === "error" && i.message.includes("Invalid architect inputs config")),
      "corrupted inputs config is reported as an error item instead of crashing doctor",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("corrupted architect report leaves step 3 pending", () => {
    const tmpDir = setupThrough(3);
    corrupt(tmpDir, ".pi/architect/architect-report.json");
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-generate-architect"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("corrupted agents.json leaves step 4 pending", () => {
    const tmpDir = setupThrough(4);
    corrupt(tmpDir, ".pi/senai/agents.json");
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-generate-sub-agents"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("corrupted agents_files.json leaves step 5 pending", () => {
    const tmpDir = setupThrough(5);
    corrupt(tmpDir, ".pi/senai/agents_files.json");
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-agents-files"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("an agents_files.json with zero assignments leaves step 5 pending", () => {
    const tmpDir = setupThrough(4);
    // File exists but documents is empty — the step was never really performed.
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-agents-files"));
    assert.ok(section.items.some((i) => i.message.startsWith("5. Agent documents assigned — pending")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a reads-only assignment counts as step 5 done", () => {
    const tmpDir = setupThrough(4);
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: { "scout-4": { reads: ["docs/PRD.md"] } } });
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Setup complete"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a role with an empty document entry leaves step 5 pending", () => {
    const tmpDir = setupThrough(4);
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: { planner: {} } });
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-agents-files"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a role with an empty reads array leaves step 5 pending", () => {
    const tmpDir = setupThrough(4);
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: { planner: { reads: [] } } });
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-agents-files"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mapped team agent with a missing agent file leaves step 4 pending", () => {
    const tmpDir = setupThrough(3);
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": `${PROGRESS_SLUG}-scout-2` } });
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-generate-sub-agents"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("agents.json with only custom mappings leaves step 4 pending", () => {
    const tmpDir = setupThrough(3);
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "my-custom-scout" } });
    writeAgent(tmpDir, "my-custom-scout", { name: "my-custom-scout", description: "custom" });
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-generate-sub-agents"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("out-of-order completion still points at the first incomplete step", () => {
    const tmpDir = makeTmpDir("doctor-progress-");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: PROGRESS_SLUG }), "utf8");
    saveArchitectInputsConfig(tmpDir, { version: 1, documents: [], additionalConstraints: [] });
    writeMinimalReport(tmpDir);
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-files"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a generated agent from a different project slug does not count", () => {
    const tmpDir = setupThrough(3);
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "other-proj-scout-2" } });
    writeAgent(tmpDir, "other-proj-scout-2", { name: "other-proj-scout-2", description: "other project" });
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-generate-sub-agents"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects the team agent via the folder-name slug when package.json is absent", () => {
    const tmpDir = makeTmpDir("doctor-progress-");
    saveFilesConfig(tmpDir, { version: 2, codePaths: [], inputDocuments: [], testPaths: [], excludedPaths: [] });
    saveArchitectInputsConfig(tmpDir, { version: 1, documents: [], additionalConstraints: [] });
    writeMinimalReport(tmpDir);
    const slug = getProjectSlug(tmpDir);
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": `${slug}-scout-2` } });
    writeAgent(tmpDir, `${slug}-scout-2`, { name: `${slug}-scout-2`, description: "generated" });
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    assert.ok(guidanceMessage(section).includes("Next: run /senai-configure-agents-files"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("step 6 is always shown and step 7 stays pending mid-sequence", () => {
    const tmpDir = setupThrough(2);
    const section = findProgress(runSenaiDiagnostic(tmpDir));
    const step6 = section.items.find((i) => i.message.startsWith("6. Doctor verification"));
    assert.ok(step6, "step 6 row exists");
    assert.strictEqual(step6.status, "info");
    assert.ok(section.items.some((i) => i.message.startsWith("7. First run — pending")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("the formatted report renders the progress section and guidance", () => {
    const tmpDir = setupThrough(0);
    const text = formatDiagnosticReport(runSenaiDiagnostic(tmpDir));
    assert.ok(text.includes("## Setup progress"));
    assert.ok(text.includes("Next: run /senai-configure-files"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("doctor document suggestions", () => {
  function findAssignments(report: ReturnType<typeof runSenaiDiagnostic>) {
    const section = report.sections.find((s) => s.title === "Agent document assignments");
    assert.ok(section, "Agent document assignments section should exist");
    return section;
  }

  function setupTypedProject(tmpDir: string): void {
    for (const doc of ["docs/PRD.md", "docs/RTM.md", "docs/TEST_PLAN.md", "docs/NFR.md", "docs/ADR.md"]) {
      writeFile(tmpDir, doc, "# doc");
    }
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [
        { type: "prd", path: "docs/PRD.md" },
        { type: "rtm", path: "docs/RTM.md" },
        { type: "test-plan", path: "docs/TEST_PLAN.md" },
        { type: "nfr", path: "docs/NFR.md" },
        { type: "adr", path: "docs/ADR.md" },
      ],
      additionalConstraints: [],
    });
  }

  it("warns with concrete suggestions when recommended roles are unassigned", () => {
    const tmpDir = makeTmpDir("doctor-docsuggest-");
    setupTypedProject(tmpDir);
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    const warnings = section.items.filter(
      (i) => i.status === "warning" && i.message.includes("has no truth document"),
    );
    assert.ok(warnings.length > 0, "warning expected");
    const scout4 = warnings.find((w) => w.message.includes("(scout-4)"));
    assert.ok(scout4, "per-role warning for scout-4 expected");
    assert.ok(scout4.message.includes("Assign: docs/PRD.md"));
    assert.ok(scout4.details?.some((d) => d.includes("/senai-configure-agents-files")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stays info-only when there is nothing confident to suggest", () => {
    const tmpDir = makeTmpDir("doctor-docsuggest-");
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(!section.items.some((i) => i.status === "warning"));
    assert.ok(section.items.some((i) => i.status === "info" && i.message.includes("No per-role document assignments")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not warn when every suggested role is already assigned", () => {
    const tmpDir = makeTmpDir("doctor-docsuggest-");
    setupTypedProject(tmpDir);
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: ["docs/PRD.md", "docs/RTM.md", "docs/TEST_PLAN.md", "docs/NFR.md", "docs/ADR.md"],
      testPaths: [],
      excludedPaths: [],
    });
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: {
        "scout-1": { primary: "docs/ADR.md" },
        "scout-4": { primary: "docs/PRD.md" },
        discussion: { primary: "docs/PRD.md" },
        planner: { primary: "docs/PRD.md" },
        "reviewer-correctness": { primary: "docs/RTM.md" },
        "reviewer-security": { primary: "docs/NFR.md" },
        "reviewer-tests": { primary: "docs/TEST_PLAN.md" },
        "code-review": { primary: "docs/RTM.md" },
        "security-gate": { primary: "docs/NFR.md" },
      },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.status === "warning" && i.message.includes("have no truth document")),
      "all suggested roles assigned → no suggestion warning",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suggests only for roles that are still unassigned", () => {
    const tmpDir = makeTmpDir("doctor-docsuggest-");
    setupTypedProject(tmpDir);
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-4": { primary: "docs/PRD.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    const warnings = section.items.filter(
      (i) => i.status === "warning" && i.message.includes("has no truth document"),
    );
    assert.ok(warnings.length > 0, "suggestion warnings expected for the remaining roles");
    assert.ok(!warnings.some((w) => w.message.includes("(scout-4)")), "assigned scout-4 is not suggested again");
    const discussion = warnings.find((w) => w.message.includes("(discussion)"));
    assert.ok(discussion?.message.includes("docs/PRD.md"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("an assigned-but-missing truth document errors and is not suggested again", () => {
    const tmpDir = makeTmpDir("doctor-docsuggest-");
    setupTypedProject(tmpDir);
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: { "scout-4": { primary: "docs/DELETED.md" } } });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      section.items.some((i) => i.status === "error" && i.message.includes("(scout-4)") && i.message.includes("MISSING")),
      "missing truth file is an error",
    );
    const warnings = section.items.filter(
      (i) => i.status === "warning" && i.message.includes("has no truth document"),
    );
    assert.ok(warnings.length > 0, "other unassigned roles still get suggestions");
    assert.ok(
      !warnings.some((w) => w.message.includes("(scout-4)")),
      "an assigned role is not suggested even though its file is missing",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits one warning per unassigned suggestion, each with the exact path", () => {
    const tmpDir = makeTmpDir("doctor-docsuggest-");
    setupTypedProject(tmpDir);
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    const warnings = section.items.filter(
      (i) => i.status === "warning" && i.message.includes("has no truth document"),
    );
    assert.strictEqual(
      warnings.length,
      9,
      `expected exactly 9 suggested roles (3 prd + 2 rtm + 1 test-plan + 2 nfr + 1 adr), got: ${warnings.length}`,
    );
    for (const w of warnings) {
      assert.ok(w.message.includes("Assign: "), `warning names the path to assign: ${w.message}`);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});


describe("doctor assignment validation", () => {
  function findAssignments(report: ReturnType<typeof runSenaiDiagnostic>) {
    const section = report.sections.find((s) => s.title === "Agent document assignments");
    assert.ok(section, "Agent document assignments section should exist");
    return section;
  }

  function setupTypedProject(tmpDir: string): void {
    for (const doc of ["docs/PRD.md", "docs/RTM.md", "docs/NFR.md"]) {
      writeFile(tmpDir, doc, "# doc");
    }
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [
        { type: "prd", path: "docs/PRD.md" },
        { type: "rtm", path: "docs/RTM.md" },
        { type: "nfr", path: "docs/NFR.md" },
      ],
      additionalConstraints: [],
    });
  }

  it("errors when an artifact-driven role has a truth document", () => {
    const tmpDir = makeTmpDir("doctor-assign-");
    setupTypedProject(tmpDir);
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { implementer: { primary: "docs/PRD.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      section.items.some(
        (i) => i.status === "error" && i.message.includes("(implementer)") && i.message.includes("stage artifacts"),
      ),
      "artifact role with a truth document is an error",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("errors when an artifact-driven role has only comparison documents", () => {
    const tmpDir = makeTmpDir("doctor-assign-");
    setupTypedProject(tmpDir);
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { archive: { reads: ["docs/PRD.md"] } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      section.items.some(
        (i) => i.status === "error" && i.message.includes("(archive)") && i.message.includes("stage artifacts"),
      ),
      "artifact role with comparison documents is an error",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("errors when a truth document contradicts the suggestion rules", () => {
    const tmpDir = makeTmpDir("doctor-assign-");
    setupTypedProject(tmpDir);
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "reviewer-security": { primary: "docs/PRD.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    const mismatch = section.items.find(
      (i) => i.status === "error" && i.message.includes("(reviewer-security)") && i.message.includes("mismatch"),
    );
    assert.ok(mismatch, "mismatched truth document is an error");
    assert.ok(mismatch.message.includes("docs/PRD.md"), "names the assigned file");
    assert.ok(mismatch.message.includes("docs/NFR.md"), "names the expected file");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts a truth document that matches the suggestion rules", () => {
    const tmpDir = makeTmpDir("doctor-assign-");
    setupTypedProject(tmpDir);
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "reviewer-security": { primary: "docs/NFR.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.status === "error"),
      "matching assignment produces no errors",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not judge roles that have no confident suggestion", () => {
    const tmpDir = makeTmpDir("doctor-assign-");
    setupTypedProject(tmpDir);
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-2": { primary: "docs/PRD.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.status === "error" && i.message.includes("mismatch")),
      "scout-2 (code-reading role, never suggested) is not judged",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});


describe("doctor mandate assignment check", () => {
  function findAssignments(report: ReturnType<typeof runSenaiDiagnostic>) {
    const section = report.sections.find((s) => s.title === "Agent document assignments");
    assert.ok(section, "Agent document assignments section should exist");
    return section;
  }

  it("accepts a scout-2 document that overlaps the mandate", () => {
    const tmpDir = makeTmpDir("doctor-mandate-");
    writeFile(tmpDir, "docs/code-patterns.md", "# Code Patterns\n");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-2": { primary: "docs/code-patterns.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.status === "error"),
      "code-pattern document fits the code-search mandate",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("errors when a scout-2 document contradicts the mandate", () => {
    const tmpDir = makeTmpDir("doctor-mandate-");
    writeFile(tmpDir, "docs/vendor-marketing.md", "# Vendor Marketing\n");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-2": { primary: "docs/vendor-marketing.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    const mismatch = section.items.find(
      (i) => i.status === "error" && i.message.includes("(scout-2)") && i.message.includes("mandate"),
    );
    assert.ok(mismatch, "contradicting document is an error");
    assert.ok(mismatch.message.includes("docs/vendor-marketing.md"), "names the assigned file");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps scout-3 on existence-only checking", () => {
    const tmpDir = makeTmpDir("doctor-mandate-");
    writeFile(tmpDir, "docs/vendor-marketing.md", "# Vendor Marketing\n");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-3": { primary: "docs/vendor-marketing.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.status === "error" && i.message.includes("mandate")),
      "scout-3 is excluded from the mandate layer per user decision",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns when an assignment cannot be verified", () => {
    const tmpDir = makeTmpDir("doctor-mandate-");
    writeFile(tmpDir, "docs/a.md", "plain text, no heading\n");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-2": { primary: "docs/a.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    const warning = section.items.find(
      (i) => i.status === "warning" && i.message.includes("cannot verify"),
    );
    assert.ok(warning, "unverifiable assignment is reported, never silent");
    assert.ok(warning.details?.some((d) => d.includes("(scout-2)") && d.includes("docs/a.md")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("errors when a plan-overview document contradicts the mandate", () => {
    const tmpDir = makeTmpDir("doctor-mandate-");
    writeFile(tmpDir, "docs/vendor-marketing.md", "# Vendor Marketing\n");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "plan-overview": { primary: "docs/vendor-marketing.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      section.items.some(
        (i) => i.status === "error" && i.message.includes("(plan-overview)") && i.message.includes("mandate"),
      ),
      "plan-overview is covered by the mandate layer",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});


describe("significantWords (unit)", () => {
  it("lowercases, splits, and removes stopwords", () => {
    const words = significantWords("Search the Codebase and Report");
    assert.ok(words.has("search"));
    assert.ok(words.has("codebase"));
    assert.ok(!words.has("the"));
    assert.ok(!words.has("and"));
    assert.ok(!words.has("report"), "report is a stopword");
  });

  it("splits on any non-alphanumeric character", () => {
    const words = significantWords("code-risk/dependency_audit");
    assert.deepStrictEqual([...words].sort(), ["audit", "code", "dependency", "risk"]);
  });

  it("drops words shorter than 4 characters", () => {
    assert.strictEqual(significantWords("a an api is").size, 0);
  });

  it("keeps words of exactly 4 characters", () => {
    assert.ok(significantWords("test").has("test"));
  });

  it("keeps words containing digits", () => {
    const words = significantWords("oauth2 tokens");
    assert.ok(words.has("oauth2"));
    assert.ok(words.has("tokens"));
  });

  it("returns an empty set for an empty string", () => {
    assert.strictEqual(significantWords("").size, 0);
  });

  it("returns an empty set for stopword-only input", () => {
    assert.strictEqual(significantWords("the and for with").size, 0);
  });

  it("extracts the expected words from the scout-2 mandate", () => {
    const words = significantWords(
      "Search the codebase and report relevant code locations, existing implementations, and reusable patterns.",
    );
    assert.ok(words.has("codebase"));
    assert.ok(words.has("implementations"));
    assert.ok(!words.has("the"));
    assert.ok(!words.has("report"));
  });
});

describe("wordsOverlap (unit)", () => {
  it("matches identical words", () => {
    assert.ok(wordsOverlap(new Set(["code"]), new Set(["code"])));
  });

  it("matches when a word prefixes the other (a shorter)", () => {
    assert.ok(wordsOverlap(new Set(["code"]), new Set(["codebase"])));
  });

  it("matches when a word prefixes the other (b shorter)", () => {
    assert.ok(wordsOverlap(new Set(["codebase"]), new Set(["code"])));
  });

  it("returns false for unrelated words", () => {
    assert.ok(!wordsOverlap(new Set(["marketing"]), new Set(["codebase"])));
  });

  it("returns false when the first set is empty", () => {
    assert.ok(!wordsOverlap(new Set(), new Set(["code"])));
  });

  it("returns false when both sets are empty", () => {
    assert.ok(!wordsOverlap(new Set(), new Set()));
  });

  it("does not prefix-match words shorter than 4 characters", () => {
    assert.ok(!wordsOverlap(new Set(["cod"]), new Set(["code"])));
  });
});

describe("mandateTextForRole (unit)", () => {
  function makeAgent(frontmatter: ResolvedAgent["frontmatter"]): ResolvedAgent {
    return { name: "x", source: "builtin", filePath: null, frontmatter, shadowed: [] };
  }

  it("combines custom description, generator mandate, and role label", () => {
    const text = mandateTextForRole(
      makeAgent({ name: "x", description: "Custom desc", filePath: "/x.md" }),
      "scout-2",
    );
    assert.ok(text.includes("Custom desc"));
    assert.ok(text.includes("Search the codebase"), "generator mandate included");
    assert.ok(text.includes("Scout 2 — Coder Search"), "role label included");
  });

  it("works with null frontmatter (built-in agent)", () => {
    const text = mandateTextForRole(makeAgent(null), "scout-2");
    assert.ok(text.includes("Search the codebase"));
    assert.ok(text.includes("Scout 2 — Coder Search"));
  });

  it("works for roles outside GENERATED_ROLES", () => {
    const text = mandateTextForRole(
      makeAgent({ name: "x", description: "Custom desc", filePath: "/x.md" }),
      "planner",
    );
    assert.ok(text.includes("Custom desc"));
    assert.ok(text.includes("Planner"));
  });

  it("feeds significantWords with the expected mandate words", () => {
    const words = significantWords(mandateTextForRole(makeAgent(null), "scout-2"));
    assert.ok(words.has("codebase"));
    assert.ok(words.has("implementations"));
  });
});

describe("documentSignalWords (unit)", () => {
  it("extracts words from the filename", () => {
    const tmpDir = makeTmpDir("doctor-signals-");
    const fullPath = path.join(tmpDir, "docs", "code-patterns.md");
    writeFile(tmpDir, "docs/code-patterns.md", "no heading here\n");

    const words = documentSignalWords(tmpDir, "docs/code-patterns.md", fullPath);
    assert.ok(words.has("code"));
    assert.ok(words.has("patterns"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts words from the first markdown heading", () => {
    const tmpDir = makeTmpDir("doctor-signals-");
    const fullPath = path.join(tmpDir, "docs", "a.md");
    writeFile(tmpDir, "docs/a.md", "intro\n# Vendor Marketing\ntext\n");

    const words = documentSignalWords(tmpDir, "docs/a.md", fullPath);
    assert.ok(words.has("vendor"));
    assert.ok(words.has("marketing"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts words from the classified document type", () => {
    const tmpDir = makeTmpDir("doctor-signals-");
    const fullPath = path.join(tmpDir, "docs", "a.md");
    writeFile(tmpDir, "docs/a.md", "no heading\n");
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "test-plan", path: "docs/a.md" }],
      additionalConstraints: [],
    });

    const words = documentSignalWords(tmpDir, "docs/a.md", fullPath);
    assert.ok(words.has("test"));
    assert.ok(words.has("plan"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses filename only when there is no heading and no type", () => {
    const tmpDir = makeTmpDir("doctor-signals-");
    const fullPath = path.join(tmpDir, "docs", "security-notes.md");
    writeFile(tmpDir, "docs/security-notes.md", "plain text\n");

    const words = documentSignalWords(tmpDir, "docs/security-notes.md", fullPath);
    assert.deepStrictEqual([...words].sort(), ["notes", "security"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not throw when the path is a directory", () => {
    const tmpDir = makeTmpDir("doctor-signals-");
    fs.mkdirSync(path.join(tmpDir, "docs", "code-mapper"), { recursive: true });

    const words = documentSignalWords(tmpDir, "docs/code-mapper", path.join(tmpDir, "docs", "code-mapper"));
    assert.ok(words.has("code"));
    assert.ok(words.has("mapper"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not throw when architect-inputs.json is corrupted", () => {
    const tmpDir = makeTmpDir("doctor-signals-");
    const fullPath = path.join(tmpDir, "docs", "code-mapper.md");
    writeFile(tmpDir, "docs/code-mapper.md", "no heading\n");
    writeFile(tmpDir, ".pi/senai/architect-inputs.json", "{not json");

    const words = documentSignalWords(tmpDir, "docs/code-mapper.md", fullPath);
    assert.ok(words.has("code"));
    assert.ok(words.has("mapper"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty set when nothing has signal", () => {
    const tmpDir = makeTmpDir("doctor-signals-");
    const fullPath = path.join(tmpDir, "docs", "a.md");
    writeFile(tmpDir, "docs/a.md", "plain text, no heading\n");

    const words = documentSignalWords(tmpDir, "docs/a.md", fullPath);
    assert.strictEqual(words.size, 0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("strips only the last extension and drops 3-char words", () => {
    const tmpDir = makeTmpDir("doctor-signals-");
    const fullPath = path.join(tmpDir, "docs", "api.spec.md");
    writeFile(tmpDir, "docs/api.spec.md", "no heading\n");

    const words = documentSignalWords(tmpDir, "docs/api.spec.md", fullPath);
    assert.ok(words.has("spec"));
    assert.ok(!words.has("api"), "api is shorter than 4 chars");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("doctor assignment validation edge cases", () => {
  function findAssignments(report: ReturnType<typeof runSenaiDiagnostic>) {
    const section = report.sections.find((s) => s.title === "Agent document assignments");
    assert.ok(section, "Agent document assignments section should exist");
    return section;
  }

  it("aggregates multiple unverifiable assignments into one warning", () => {
    const tmpDir = makeTmpDir("doctor-edge-");
    writeFile(tmpDir, "docs/a.md", "plain text\n");
    writeFile(tmpDir, "docs/b.md", "plain text\n");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: {
        "scout-2": { primary: "docs/a.md" },
        "plan-overview": { primary: "docs/b.md" },
      },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    const warnings = section.items.filter((i) => i.status === "warning" && i.message.includes("cannot verify"));
    assert.strictEqual(warnings.length, 1, "exactly one aggregated warning");
    assert.ok(warnings[0].message.startsWith("Doctor cannot verify 2 document assignment(s)"));
    assert.ok(warnings[0].details?.some((d) => d.includes("(scout-2)")));
    assert.ok(warnings[0].details?.some((d) => d.includes("(plan-overview)")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("missing assigned file produces only the MISSING error, no mandate error", () => {
    const tmpDir = makeTmpDir("doctor-edge-");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-2": { primary: "docs/deleted.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      section.items.some((i) => i.status === "error" && i.message.includes("(scout-2)") && i.message.includes("MISSING")),
      "MISSING error present",
    );
    assert.ok(
      !section.items.some((i) => i.status === "error" && i.message.includes("mandate")),
      "no mandate double-report for a missing file",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("artifact role with an empty reads array is not an assignment", () => {
    const tmpDir = makeTmpDir("doctor-edge-");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { implementer: { reads: [] } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.status === "error" && i.message.includes("stage artifacts")),
      "empty reads array is not treated as an assignment",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("artifact role with an empty entry is not an assignment", () => {
    const tmpDir = makeTmpDir("doctor-edge-");
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { linter: {} },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.status === "error" && i.message.includes("stage artifacts")),
      "empty entry is not treated as an assignment",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("missing + mismatched Layer-1 document produces only the MISSING error", () => {
    const tmpDir = makeTmpDir("doctor-edge-");
    writeFile(tmpDir, "docs/PRD.md", "# PRD\n");
    writeFile(tmpDir, "docs/NFR.md", "# NFR\n");
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [
        { type: "prd", path: "docs/PRD.md" },
        { type: "nfr", path: "docs/NFR.md" },
      ],
      additionalConstraints: [],
    });
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "reviewer-security": { primary: "docs/GONE.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      section.items.some((i) => i.status === "error" && i.message.includes("(reviewer-security)") && i.message.includes("MISSING")),
      "MISSING error present",
    );
    assert.ok(
      !section.items.some((i) => i.status === "error" && i.message.includes("mismatch")),
      "no mismatch double-report for a missing file",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("two mismatched Layer-1 roles produce two separate errors", () => {
    const tmpDir = makeTmpDir("doctor-edge-");
    writeFile(tmpDir, "docs/PRD.md", "# PRD\n");
    writeFile(tmpDir, "docs/NFR.md", "# NFR\n");
    writeFile(tmpDir, "docs/TEST_PLAN.md", "# Test Plan\n");
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [
        { type: "prd", path: "docs/PRD.md" },
        { type: "nfr", path: "docs/NFR.md" },
        { type: "test-plan", path: "docs/TEST_PLAN.md" },
      ],
      additionalConstraints: [],
    });
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: {
        "reviewer-security": { primary: "docs/PRD.md" },
        "reviewer-tests": { primary: "docs/PRD.md" },
      },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    const mismatches = section.items.filter((i) => i.status === "error" && i.message.includes("mismatch"));
    assert.strictEqual(mismatches.length, 2, "one error per mismatched role");
    assert.ok(mismatches.some((i) => i.message.includes("(reviewer-security)")));
    assert.ok(mismatches.some((i) => i.message.includes("(reviewer-tests)")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mandate check passes when the classified type overlaps the mandate", () => {
    const tmpDir = makeTmpDir("doctor-edge-");
    writeFile(tmpDir, "docs/zz.md", "no heading\n");
    saveArchitectInputsConfig(tmpDir, {
      version: 1,
      documents: [{ type: "code", path: "docs/zz.md" }],
      additionalConstraints: [],
    });
    saveAgentsFilesConfig(tmpDir, {
      version: 2,
      documents: { "scout-2": { primary: "docs/zz.md" } },
    });

    const section = findAssignments(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.status === "error"),
      "type 'code' overlaps the code-search mandate — no error",
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("coverage audit gaps", () => {
  function findGapSection(report: ReturnType<typeof runSenaiDiagnostic>, title: string) {
    const section = report.sections.find((s) => s.title === title);
    assert.ok(section, `section "${title}" should exist`);
    return section;
  }

  it("environment check is ok when running inside Zellij", () => {
    const tmpDir = makeTmpDir("doctor-env-zellij-");
    const previousZellij = process.env.ZELLIJ;
    const previousTmux = process.env.TMUX;
    process.env.ZELLIJ = "1";
    delete process.env.TMUX; // the Zellij branch only runs when TMUX is unset
    try {
      const report = runSenaiDiagnostic(tmpDir);
      const section = findGapSection(report, "Runtime environment");
      const zellijItem = section.items.find((i) => i.message.includes("Zellij"));
      assert.ok(zellijItem);
      assert.strictEqual(zellijItem.status, "ok");
    } finally {
      if (previousZellij === undefined) {
        delete process.env.ZELLIJ;
      } else {
        process.env.ZELLIJ = previousZellij;
      }
      if (previousTmux === undefined) {
        delete process.env.TMUX;
      } else {
        process.env.TMUX = previousTmux;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("environment check warns when running inside neither tmux nor Zellij", () => {
    const tmpDir = makeTmpDir("doctor-env-none-");
    const previousZellij = process.env.ZELLIJ;
    const previousTmux = process.env.TMUX;
    delete process.env.ZELLIJ;
    delete process.env.TMUX;
    try {
      const report = runSenaiDiagnostic(tmpDir);
      const section = findGapSection(report, "Runtime environment");
      const muxItem = section.items.find((i) =>
        i.message.includes("Not running inside tmux or Zellij."),
      );
      assert.ok(muxItem);
      assert.strictEqual(muxItem.status, "warning");
      assert.ok(muxItem.details?.some((d) => d.includes("terminal multiplexer")));
    } finally {
      if (previousZellij === undefined) {
        delete process.env.ZELLIJ;
      } else {
        process.env.ZELLIJ = previousZellij;
      }
      if (previousTmux === undefined) {
        delete process.env.TMUX;
      } else {
        process.env.TMUX = previousTmux;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("capability check reports a single ok item when every role skips verification", () => {
    const tmpDir = makeTmpDir("doctor-cap-all-green-");
    // No agents configured: every role resolves to a default/built-in mapping,
    // which the capability check skips, so the all-green ok item is emitted.
    const report = runSenaiDiagnostic(tmpDir);
    const section = findGapSection(report, "Agent-role capability fit");
    assert.strictEqual(section.items.length, 1);
    assert.strictEqual(section.items[0].status, "ok");
    assert.ok(section.items[0].message.includes("All mapped agents have suitable capabilities for their roles."));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("file scope check errors when a configured path does not exist on disk", () => {
    const tmpDir = makeTmpDir("doctor-scope-missing-");
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: ["src/"],
      inputDocuments: ["docs/missing-prd.md"],
      testPaths: [],
      excludedPaths: [],
    });
    writeFile(tmpDir, "src/index.ts");
    // docs/missing-prd.md is intentionally not created.

    const report = runSenaiDiagnostic(tmpDir);
    const section = findGapSection(report, "Project file scope");
    const item = section.items.find((i) => i.message.includes("Input documents: 1 configured, 1 not found"));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.deepStrictEqual(item.details, ["docs/missing-prd.md"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("agents_files check is ok when a comparison document exists", () => {
    const tmpDir = makeTmpDir("doctor-agents-files-reads-ok-");
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: { "scout-3": { reads: ["docs/comparison.md"] } } });
    writeFile(tmpDir, "docs/comparison.md", "# notes");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findGapSection(report, "Agent document assignments");
    const item = section.items.find((i) => i.message.includes("comparison document: docs/comparison.md"));
    assert.ok(item);
    assert.strictEqual(item.status, "ok");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("architecture setup warns when the architecture library is empty or missing", () => {
    const tmpDir = makeTmpDir("doctor-arch-no-library-");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findGapSection(report, "Architecture setup");
    const item = section.items.find((i) => i.message.includes("Architecture library is empty or missing."));
    assert.ok(item);
    assert.strictEqual(item.status, "warning");
    assert.ok(item.details?.some((d) => d.includes(".pi/architecture-library/")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("architecture setup reports info when no architect inputs are configured", () => {
    const tmpDir = makeTmpDir("doctor-arch-no-inputs-");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findGapSection(report, "Architecture setup");
    const item = section.items.find((i) => i.message.includes("No architect inputs configured."));
    assert.ok(item);
    assert.strictEqual(item.status, "info");
    assert.ok(item.message.includes("/senai-configure-architect-inputs"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("architecture setup reports ok for a valid architectural drivers file", () => {
    const tmpDir = makeTmpDir("doctor-arch-drivers-ok-");
    saveDrivers(tmpDir, createEmptyDrivers());

    const report = runSenaiDiagnostic(tmpDir);
    const section = findGapSection(report, "Architecture setup");
    const item = section.items.find((i) =>
      i.message.includes("Architectural drivers file exists at .pi/architect/architectural-drivers.json."),
    );
    assert.ok(item);
    assert.strictEqual(item.status, "ok");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("architecture setup errors on a misnamed generated skill", () => {
    const tmpDir = makeTmpDir("doctor-arch-misnamed-skill-");
    const slug = "gap-project";
    const arch = "modular-monolith";
    saveArchitectProfile(tmpDir, {
      projectName: "Gap Project",
      projectSlug: slug,
      selectedArchitecture: arch,
      drivers: createEmptyDrivers(),
      additionalConstraints: [],
    });
    // Starts with the expected prefix but is not one of the four stage skills.
    writeFile(tmpDir, path.join(".pi", "skills", `${slug}-${arch}-wrongstage`, "SKILL.md"), "# skill");

    const report = runSenaiDiagnostic(tmpDir);
    const section = findGapSection(report, "Architecture setup");
    const item = section.items.find((i) => i.message.includes("misnamed architecture skills found"));
    assert.ok(item);
    assert.strictEqual(item.status, "error");
    assert.ok(item.details?.some((d) => d.includes(path.join(".pi", "skills", `${slug}-${arch}-wrongstage`))));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resource check flags a technology resource with an empty body", () => {
    const tmpDir = makeTmpDir("doctor-res-empty-body-");
    writeFile(
      tmpDir,
      path.join(".pi", "technologies", "empty-body.md"),
      "---\nid: empty-body\nkeywords:\n  - empty-body\n---\n",
    );

    const report = runSenaiDiagnostic(tmpDir);
    const section = findGapSection(report, "Technology resources");
    const warning = section.items.find((i) => i.status === "warning" && i.message.includes("empty-body.md"));
    assert.ok(warning);
    assert.ok(warning.details?.some((d) => d.includes("body is empty")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skill reference check reports empty SKILL.md body and unparsable frontmatter problems", () => {
    const tmpDir = makeTmpDir("doctor-skill-invalid-");
    writeAgent(tmpDir, "gap-skill-agent", {
      name: "gap-skill-agent",
      description: "Agent referencing skills",
      tools: ["read", "write"],
      skills: ["empty-skill", "broken-skill"],
    });
    saveAgentConfig(tmpDir, { version: 1, agents: { planner: "gap-skill-agent" } });
    // Valid frontmatter but no body.
    writeFile(
      tmpDir,
      path.join(".pi", "skills", "empty-skill", "SKILL.md"),
      "---\nname: empty-skill\ndescription: Empty body skill\n---\n",
    );
    // A directory named SKILL.md passes existsSync but cannot be read as a file.
    fs.mkdirSync(path.join(tmpDir, ".pi", "skills", "broken-skill", "SKILL.md"), { recursive: true });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findGapSection(report, "Agent skill references");

    const emptySkill = section.items.find(
      (i) => i.status === "warning" && i.message.includes('references invalid skill "empty-skill"'),
    );
    assert.ok(emptySkill);
    assert.ok(emptySkill.details?.some((d) => d.includes("SKILL.md body is empty")));

    const brokenSkill = section.items.find(
      (i) => i.status === "warning" && i.message.includes('references invalid skill "broken-skill"'),
    );
    assert.ok(brokenSkill);
    assert.ok(brokenSkill.details?.some((d) => d.includes("SKILL.md could not be parsed")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});


describe("doctor optimization checks", () => {
  function findOptSection(report: ReturnType<typeof runSenaiDiagnostic>, title: string) {
    const section = report.sections.find((s) => s.title === title);
    assert.ok(section, `section '${title}' should exist`);
    return section;
  }

  it("scout-1 mapped to a planner-style agent gets no planner warning (excluded by design)", () => {
    const tmpDir = makeTmpDir("doctor-scout1-planner-");
    writeAgent(tmpDir, "acme-planner", {
      name: "acme-planner",
      description: "Planning agent",
      tools: "read, write",
    });
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-1": "acme-planner" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findOptSection(report, "Agent-role capability fit");
    assert.ok(!section.items.some((i) => i.message.includes("looks like a planner")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scout-3 mapped to a planner-style agent gets a planner warning", () => {
    const tmpDir = makeTmpDir("doctor-scout3-planner-");
    writeAgent(tmpDir, "acme-planner", {
      name: "acme-planner",
      description: "Planning agent",
      tools: "read, write",
    });
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-3": "acme-planner" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findOptSection(report, "Agent-role capability fit");
    const warning = section.items.find((i) => i.message.includes("looks like a planner"));
    assert.ok(warning, "scout-3 mapped to a planner agent should warn");
    assert.strictEqual(warning.status, "warning");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full-test mapped to an agent with write+bash is accepted; missing write is an error", () => {
    const tmpDir = makeTmpDir("doctor-fulltest-write-");
    writeAgent(tmpDir, "write-tester", {
      name: "write-tester",
      description: "Tester that can write",
      tools: "read, write, bash",
    });
    saveAgentConfig(tmpDir, { version: 1, agents: { "full-test": "write-tester" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findOptSection(report, "Agent-role capability fit");
    const warning = section.items.find(
      (i) => i.message.includes("write-tester") && i.message.includes("has write tool but role is read-only"),
    );
    assert.ok(!warning, "full-test with write is correct since generator v3 — no read-only warning");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full-test mapped to an agent without write gets a missing-tools error", () => {
    const tmpDir = makeTmpDir("doctor-fulltest-nowrite-");
    writeAgent(tmpDir, "no-write-tester", {
      name: "no-write-tester",
      description: "Tester that cannot write",
      tools: "read, bash",
    });
    saveAgentConfig(tmpDir, { version: 1, agents: { "full-test": "no-write-tester" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findOptSection(report, "Agent-role capability fit");
    const error = section.items.find(
      (i) => i.message.includes("no-write-tester") && i.message.includes("MISSING REQUIRED TOOLS"),
    );
    assert.ok(error, "full-test without write should error — this was the real full-test bug");
    assert.ok(error.details?.some((d) => d.includes("write")), "names the missing write tool");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scout-2 custom agent with only read gets a missing-tools error naming write", () => {
    const tmpDir = makeTmpDir("doctor-scout2-read-");
    writeAgent(tmpDir, "readonly-scout", {
      name: "readonly-scout",
      description: "Scout that can only read",
      tools: "read",
    });
    saveAgentConfig(tmpDir, { version: 1, agents: { "scout-2": "readonly-scout" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findOptSection(report, "Agent-role capability fit");
    const error = section.items.find(
      (i) => i.message.includes("readonly-scout") && i.message.includes("MISSING REQUIRED TOOLS"),
    );
    assert.ok(error, "scout-2 without write should error");
    assert.strictEqual(error.status, "error");
    assert.ok(error.details?.some((d) => d.includes("Missing: write")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("security-gate with read+write gets no missing-tools error (regression)", () => {
    const tmpDir = makeTmpDir("doctor-gate-write-");
    writeAgent(tmpDir, "writing-gate", {
      name: "writing-gate",
      description: "Gate that writes its report",
      tools: "read, write",
    });
    saveAgentConfig(tmpDir, { version: 1, agents: { "security-gate": "writing-gate" } });

    const report = runSenaiDiagnostic(tmpDir);
    const section = findOptSection(report, "Agent-role capability fit");
    assert.ok(
      !section.items.some(
        (i) => i.message.includes("writing-gate") && i.message.includes("MISSING REQUIRED TOOLS"),
      ),
      "security-gate with write must not error (it writes security-report.md)",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("retry environment item matches the machine's settings.json", () => {
    const tmpDir = makeTmpDir("doctor-env-retry-");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findOptSection(report, "Runtime environment");

    const settingsPath = path.join(getAgentDir(), "settings.json");
    const retryItem = section.items.find((i) => i.message.toLowerCase().includes("retry"));
    if (fs.existsSync(settingsPath)) {
      assert.ok(retryItem, "retry item expected when settings.json exists");
      assert.ok(
        retryItem.status === "ok" || retryItem.status === "warning",
        `retry item should be ok or warning, got ${retryItem.status}`,
      );
    } else {
      assert.ok(!retryItem, "no retry item expected without settings.json");
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("doctor strictness — collision warning and run artifact audit", () => {
  const PLAN_ARTIFACTS = [
    "plan/plan.md",
    "plan/plan-overview.md",
    "plan/discussion-notes.md",
    "plan/scouts/scout-angle_1.md",
    "plan/scouts/scout-angle_2.md",
    "plan/scouts/scout-angle_3.md",
    "plan/scouts/scout-angle_4.md",
    "plan/reviews/review-correctness.md",
    "plan/reviews/review-security.md",
    "plan/reviews/review-tests.md",
  ];

  function writeAllPlanArtifacts(tmpDir: string, runId: string, except?: string): void {
    for (const rel of PLAN_ARTIFACTS) {
      if (rel === except) continue;
      writeFile(tmpDir, `.IDE_Plans/senai/runs/${runId}/${rel}`, "content");
    }
  }

  it("warns when a role remaps a built-in default name (bare name loads the read-only built-in)", () => {
    const tmpDir = makeTmpDir("doctor-collision-");
    writeAgent(tmpDir, "proj-arch-planner", { name: "proj-arch-planner", description: "planner" });
    saveAgentConfig(tmpDir, { version: 1, agents: { planner: "proj-arch-planner" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Agent mapping sources");
    const warning = section?.items.find(
      (i) => i.status === "warning" && i.message.includes("remap a built-in default name"),
    );
    assert.ok(warning, "collision warning present");
    assert.ok(
      warning.details?.some((d) => d.includes("proj-arch-planner") && d.includes('"planner"')),
      "warning names both the mapped and the bare name",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits no collision warning when roles stay on built-in defaults", () => {
    const tmpDir = makeTmpDir("doctor-no-collision-");
    saveAgentConfig(tmpDir, { version: 1, agents: {} });
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Agent mapping sources");
    const warning = section?.items.find(
      (i) => i.status === "warning" && i.message.includes("remap a built-in default name"),
    );
    assert.ok(!warning, "no collision warning on defaults");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run artifact audit is clean when all plan artifacts exist", () => {
    const tmpDir = makeTmpDir("doctor-audit-clean-");
    saveState(tmpDir, { ...defaultState(), currentStage: "implementing", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    assert.ok(
      section?.items.some(
        (i) => i.status === "ok" && i.message.includes("All 10 plan-stage artifacts"),
      ),
      "clean audit reported",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns when a completed plan stage has a missing artifact", () => {
    const tmpDir = makeTmpDir("doctor-audit-missing-");
    saveState(tmpDir, { ...defaultState(), currentStage: "implementing", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1", "plan/reviews/review-tests.md");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    const warning = section?.items.find(
      (i) => i.status === "warning" && i.message.includes("missing or empty"),
    );
    assert.ok(warning, "missing artifact warning present");
    assert.ok(
      warning.details?.some((d) => d.includes("review-tests.md")),
      "warning names the missing file",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports a planning-stage run with missing artifacts as possibly stuck", () => {
    const tmpDir = makeTmpDir("doctor-audit-stuck-");
    saveState(tmpDir, { ...defaultState(), currentStage: "planning", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1", "plan/scouts/scout-angle_3.md");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    assert.ok(
      section?.items.some(
        (i) => i.status === "info" && i.message.includes("artifacts still missing"),
      ),
      "stuck-run info present",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("treats a 0-byte artifact as missing", () => {
    const tmpDir = makeTmpDir("doctor-audit-empty-");
    saveState(tmpDir, { ...defaultState(), currentStage: "implementing", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/plan/plan-overview.md", "");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    const warning = section?.items.find((i) => i.status === "warning");
    assert.ok(warning, "empty artifact flagged");
    assert.ok(
      warning.details?.some((d) => d.includes("plan-overview.md")),
      "warning names the empty file",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips the audit cleanly when no run exists", () => {
    const tmpDir = makeTmpDir("doctor-audit-none-");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    assert.ok(
      section?.items.some(
        (i) => i.status === "info" && i.message.includes("No senai run recorded"),
      ),
      "no-run info present",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns when a delivered run is missing deliver artifacts", () => {
    const tmpDir = makeTmpDir("doctor-audit-deliver-");
    saveState(tmpDir, { ...defaultState(), currentStage: "delivered", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/security-report.md", "content");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    // A delivered run without its artifacts is an inconsistency — reported
    // as an error since the run-audit strictness pass.
    const finding = section?.items.find(
      (i) => i.status === "error" && i.message.includes("deliver artifact"),
    );
    assert.ok(finding, "deliver artifact error present");
    assert.ok(
      finding.details?.some((d) => d.includes("deliver-summary.md")),
      "error names the missing deliver file",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports corrupted state.json as skipped without crashing", () => {
    const tmpDir = makeTmpDir("doctor-audit-corrupt-");
    writeFile(tmpDir, ".IDE_Plans/senai/state.json", "{not valid json");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    assert.ok(
      section?.items.some((i) => i.status === "info" && i.message.includes("unreadable")),
      "corrupted state reported as skipped",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports clean when runId is set but the stage is none", () => {
    const tmpDir = makeTmpDir("doctor-audit-none-stage-");
    saveState(tmpDir, { ...defaultState(), currentStage: "none", runId: "r1" });
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    assert.ok(section, "section exists");
    assert.ok(
      !section.items.some((i) => i.status === "warning"),
      "no warnings when the run never started a stage",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports two ok items for a fully delivered run", () => {
    const tmpDir = makeTmpDir("doctor-audit-full-");
    saveState(tmpDir, { ...defaultState(), currentStage: "delivered", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/security-report.md", "content");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/deliver-summary.md", "content");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    const oks = section?.items.filter((i) => i.status === "ok") ?? [];
    assert.strictEqual(oks.length, 2, "plan ok + deliver ok");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports no stuck info when a planning-stage run already has all artifacts", () => {
    const tmpDir = makeTmpDir("doctor-audit-planning-full-");
    saveState(tmpDir, { ...defaultState(), currentStage: "planning", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    assert.ok(
      !section?.items.some((i) => i.message.includes("still missing")),
      "no stuck info when everything is written",
    );
    assert.ok(
      section?.items.some((i) => i.status === "ok" && i.message.includes("audit clean")),
      "audit clean reported",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("counts every remapped role in the collision warning", () => {
    const tmpDir = makeTmpDir("doctor-collision-3-");
    for (const name of ["proj-planner", "proj-scout", "proj-worker"]) {
      writeAgent(tmpDir, name, { name, description: name });
    }
    saveAgentConfig(tmpDir, {
      version: 1,
      agents: { planner: "proj-planner", "scout-1": "proj-scout", implementer: "proj-worker" },
    });
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Agent mapping sources");
    const warning = section?.items.find(
      (i) => i.status === "warning" && i.message.includes("remap a built-in default name"),
    );
    assert.ok(warning, "collision warning present");
    assert.ok(warning.message.startsWith("3 role(s)"), `counts 3 roles, got: ${warning.message}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not warn when a project agent shadows a built-in under the same name", () => {
    const tmpDir = makeTmpDir("doctor-shadow-");
    writeAgent(tmpDir, "planner", { name: "planner", description: "project planner override" });
    saveAgentConfig(tmpDir, { version: 1, agents: { planner: "planner" } });
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Agent mapping sources");
    const warning = section?.items.find(
      (i) => i.status === "warning" && i.message.includes("remap a built-in default name"),
    );
    assert.ok(!warning, "same-name override is not a collision");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("survives a garbage stage string in state.json", () => {
    const tmpDir = makeTmpDir("doctor-audit-garbage-");
    writeFile(
      tmpDir,
      ".IDE_Plans/senai/state.json",
      JSON.stringify({ version: 1, mission: "m", runId: "r1", currentStage: "bogus", startedAt: "", updatedAt: "", stageResults: {} }),
    );
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    assert.ok(section, "section exists");
    assert.ok(
      !section.items.some((i) => i.status === "warning"),
      "garbage stage resets to none — no warnings",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists all 10 plan artifacts when the run directory does not exist at all", () => {
    const tmpDir = makeTmpDir("doctor-audit-nodir-");
    saveState(tmpDir, { ...defaultState(), currentStage: "implementing", runId: "ghost-run" });
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    const warning = section?.items.find(
      (i) => i.status === "warning" && i.message.includes("10 artifact(s)"),
    );
    assert.ok(warning, "all-missing warning present");
    assert.ok(
      warning.details?.some((d) => d.includes("plan/plan.md")),
      "details list the missing files",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("errors when a delivered run has an empty document/ directory", () => {
    const tmpDir = makeTmpDir("doctor-audit-docdir-");
    saveState(tmpDir, { ...defaultState(), currentStage: "delivered", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/security-report.md", "content");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/deliver-summary.md", "content");
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/senai/runs/r1/document"), { recursive: true });
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    const finding = section?.items.find(
      (i) => i.status === "error" && i.message.includes("document/ directory is empty or missing"),
    );
    assert.ok(finding, "empty document/ on a delivered run must be an error");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("errors when deliver/ contains an implement-stage file", () => {
    const tmpDir = makeTmpDir("doctor-audit-misplaced-");
    saveState(tmpDir, { ...defaultState(), currentStage: "delivered", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/security-report.md", "content");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/deliver-summary.md", "content");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/lint-report.md", "misplaced");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/document/README.md", "content");
    const report = runSenaiDiagnostic(tmpDir);
    const section = report.sections.find((s) => s.title === "Run artifacts");
    const finding = section?.items.find(
      (i) => i.status === "error" && i.message.includes("implement-stage file(s): lint-report.md"),
    );
    assert.ok(finding, "misplaced lint-report.md must be an error");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns when plan.md exceeds 50KB but not at exactly 50KB", () => {
    const tmpDir = makeTmpDir("doctor-audit-plansize-");
    saveState(tmpDir, { ...defaultState(), currentStage: "delivered", runId: "r1" });
    writeAllPlanArtifacts(tmpDir, "r1");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/security-report.md", "content");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/deliver/deliver-summary.md", "content");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/document/README.md", "content");

    // 51KB -> warning.
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/plan/plan.md", "x".repeat(51 * 1024));
    let section = runSenaiDiagnostic(tmpDir).sections.find((s) => s.title === "Run artifacts");
    let sizeWarning = section?.items.find(
      (i) => i.status === "warning" && i.message.includes("plan.md is 51KB"),
    );
    assert.ok(sizeWarning, "51KB plan.md must warn");

    // Exactly 50KB (the check is strictly greater) -> no size warning.
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/plan/plan.md", "x".repeat(50 * 1024));
    section = runSenaiDiagnostic(tmpDir).sections.find((s) => s.title === "Run artifacts");
    sizeWarning = section?.items.find((i) => i.message.includes("token bloat"));
    assert.ok(!sizeWarning, "exactly 50KB plan.md must not warn");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});


describe("doctor documentation factory", () => {
  function findDocsFactory(report: ReturnType<typeof runSenaiDiagnostic>) {
    const section = report.sections.find((s) => s.title === "Documentation factory");
    assert.ok(section, "Documentation factory section should exist");
    return section;
  }

  it("reports info when no skeleton was generated", () => {
    const tmpDir = makeTmpDir("doctor-docfactory-");
    const section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    assert.ok(
      section.items.some((i) => i.status === "info" && i.message.includes("No docs skeleton generated")),
    );
    assert.ok(!section.items.some((i) => i.status === "error"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns when a filled doc exceeds its length cap", () => {
    const tmpDir = makeTmpDir("doctor-docfactory-");
    generateDocsStructure(tmpDir);
    const lines = ["# Demo", "", "## Install", "", "x", "", "## Usage", "", "y"];
    while (lines.length <= 150) lines.push("filler line");
    writeFile(tmpDir, "README.md", lines.join("\n"));

    const section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    const warning = section.items.find(
      (i) => i.status === "warning" && i.message.includes("over the 150-line cap"),
    );
    assert.ok(warning, "length-cap warning expected");
    assert.ok(warning.message.includes("README.md"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns when a required template section is missing", () => {
    const tmpDir = makeTmpDir("doctor-docfactory-");
    writeFile(
      tmpDir,
      "docs/adr/0001-use-x.md",
      "# Use X\n\n## Status\n\naccepted\n\n## Context\n\nBecause.\n\n## Consequences\n\nFine.\n",
    );
    writeFile(
      tmpDir,
      ".pi/senai/docs-structure.json",
      JSON.stringify({
        version: 1,
        targets: [{ path: "docs/adr/0001-use-x.md", docType: "adr", maxLines: 120 }],
      }),
    );

    const section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    const warning = section.items.find(
      (i) => i.status === "warning" && i.message.includes('missing required section "## Decision"'),
    );
    assert.ok(warning, "missing-section warning expected");
    assert.ok(warning.message.includes("docs/adr/0001-use-x.md"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns on a deleted stub and reports stray docs as info", () => {
    const tmpDir = makeTmpDir("doctor-docfactory-");
    writeFile(tmpDir, "package.json", JSON.stringify({ name: "demo", version: "1.0.0", main: "dist/index.js" }));
    generateDocsStructure(tmpDir);
    fs.rmSync(path.join(tmpDir, "docs", "reference", "README.md"));
    writeFile(tmpDir, "docs/how-to/mine.md", "# My own guide\n\nHand-written.\n");

    const section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    assert.ok(
      section.items.some(
        (i) => i.status === "warning" && i.message.includes("Skeleton doc missing: docs/reference/README.md"),
      ),
    );
    assert.ok(
      section.items.some((i) => i.status === "info" && i.message.includes("not part of the generated skeleton")),
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes when the skeleton is intact and filled docs are within limits", () => {
    const tmpDir = makeTmpDir("doctor-docfactory-");
    generateDocsStructure(tmpDir);

    const section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    assert.ok(section.items.some((i) => i.status === "ok"));
    assert.ok(!section.items.some((i) => i.status === "warning" || i.status === "error"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns on a corrupt docs-structure manifest", () => {
    const tmpDir = makeTmpDir("doctor-docfactory-corrupt-");
    writeFile(tmpDir, ".pi/senai/docs-structure.json", "{not json");

    const section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    const warning = section.items.find(
      (i) => i.status === "warning" && i.message.startsWith("Docs structure manifest is corrupt:"),
    );
    assert.ok(warning, "corrupt manifest warning expected");
    assert.ok(
      warning.details?.some((d) => d.includes("re-run /senai-generate-docs-structure")),
      "fix hint present",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns when required sections are present but out of order", () => {
    const tmpDir = makeTmpDir("doctor-docfactory-order-");
    // All four ADR sections present, but ## Decision comes before ## Context.
    writeFile(
      tmpDir,
      "docs/adr/0001-use-x.md",
      "# Use X\n\n## Status\n\naccepted\n\n## Decision\n\nWe decided.\n\n## Context\n\nBecause.\n\n## Consequences\n\nFine.\n",
    );
    writeFile(
      tmpDir,
      ".pi/senai/docs-structure.json",
      JSON.stringify({
        version: 1,
        targets: [{ path: "docs/adr/0001-use-x.md", docType: "adr", maxLines: 120 }],
      }),
    );

    const section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    const warning = section.items.find(
      (i) => i.status === "warning" && i.message.includes('missing required section "## Decision"'),
    );
    assert.ok(warning, "out-of-order section must warn as missing");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("no length-cap warning at exactly the cap; warning one line over", () => {
    const tmpDir = makeTmpDir("doctor-docfactory-boundary-");
    generateDocsStructure(tmpDir);

    // Exactly 150 split-lines (no trailing newline), required sections in order.
    const atCap = ["# Demo", "", "## Install", "", "x", "", "## Usage", "", "y"];
    while (atCap.length < 150) atCap.push("filler line");
    writeFile(tmpDir, "README.md", atCap.join("\n"));
    assert.strictEqual(atCap.length, 150);

    let section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.message.includes("over the 150-line cap")),
      "exactly 150 lines must not warn",
    );

    // 151 split-lines -> warning.
    const overCap = [...atCap, "one more line"];
    writeFile(tmpDir, "README.md", overCap.join("\n"));
    section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    assert.ok(
      section.items.some((i) => i.status === "warning" && i.message.includes("over the 150-line cap")),
      "151 lines must warn",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips a manifest target with an unknown docType", () => {
    const tmpDir = makeTmpDir("doctor-docfactory-unknowntype-");
    writeFile(tmpDir, "docs/weird.md", "# Weird\n\nFilled content, not a stub.\n");
    writeFile(
      tmpDir,
      ".pi/senai/docs-structure.json",
      JSON.stringify({
        version: 1,
        targets: [{ path: "docs/weird.md", docType: "nope", maxLines: 10 }],
      }),
    );

    const section = findDocsFactory(runSenaiDiagnostic(tmpDir));
    assert.ok(
      !section.items.some((i) => i.message.includes("docs/weird.md")),
      "unknown docType target must be skipped silently",
    );
    assert.ok(
      !section.items.some((i) => i.status === "warning" || i.status === "error"),
      "no warnings or errors for an unknown docType",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("doctor stray files and subagent extension", () => {
  function findSectionOpt(report: ReturnType<typeof runSenaiDiagnostic>, title: string) {
    const section = report.sections.find((s) => s.title === title);
    assert.ok(section, `section "${title}" should exist`);
    return section;
  }

  it("warns on stray tmp_* files in the project root and run directories", () => {
    const tmpDir = makeTmpDir("doctor-stray-");
    writeFile(tmpDir, "tmp_fix.sh", "#!/bin/sh\n");
    writeFile(tmpDir, ".IDE_Plans/senai/runs/r1/tmp_x.ts", "// helper");

    const section = findSectionOpt(runSenaiDiagnostic(tmpDir), "Stray files");
    const warning = section.items.find(
      (i) => i.status === "warning" && i.message.includes("2 stray tmp_* helper file(s) found"),
    );
    assert.ok(warning, "stray warning expected");
    assert.ok(warning.details?.some((d) => d === "tmp_fix.sh"), "root stray named");
    assert.ok(
      warning.details?.some((d) => d === ".IDE_Plans/senai/runs/r1/tmp_x.ts"),
      "run-dir stray named with forward slashes",
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports ok for a clean project", () => {
    const tmpDir = makeTmpDir("doctor-stray-clean-");
    const section = findSectionOpt(runSenaiDiagnostic(tmpDir), "Stray files");
    assert.ok(section.items.some((i) => i.status === "ok" && i.message === "No stray tmp_* helper files."));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("compareVersions compares dotted versions numerically", () => {
    assert.strictEqual(compareVersions("3.7.2", "3.7.2"), 0);
    assert.ok(compareVersions("3.7.1", "3.7.2") < 0);
    assert.ok(compareVersions("3.10.0", "3.7.2") > 0, "numeric segment compare, not string compare");
    assert.ok(compareVersions("3.7", "3.7.0") === 0, "missing segments count as 0");
  });

  it("subagent extension section exists and matches the machine's settings.json", () => {
    const tmpDir = makeTmpDir("doctor-subagent-ext-");
    const section = findSectionOpt(runSenaiDiagnostic(tmpDir), "Subagent extension");
    for (const item of section.items) {
      assert.ok(
        ["ok", "warning", "error", "info"].includes(item.status),
        `valid status, got ${item.status}`,
      );
      assert.ok(item.message.length > 0, "non-empty message");
    }

    // Branch on the machine's real settings (same precedent as the
    // retry-environment test): the section content depends on user-level config.
    const settingsPath = path.join(getAgentDir(), "settings.json");
    let packages: string[] | null = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { packages?: unknown };
      packages = Array.isArray(parsed.packages) ? (parsed.packages as string[]) : [];
    } catch {
      packages = null;
    }
    if (packages === null) {
      assert.ok(
        section.items.some((i) => i.status === "info" && i.message.includes("Could not read pi settings.json")),
        "unreadable settings -> info skip",
      );
    } else if (packages.some((p) => p.includes("pi-interactive-subagents"))) {
      assert.ok(
        section.items.some((i) => i.message.includes("pi-interactive-subagents") && i.status !== "error"),
        "installed provider must not be an error",
      );
    } else {
      assert.ok(
        section.items.some(
          (i) => i.status === "error" && i.message.includes("pi-interactive-subagents is not in pi's packages list."),
        ),
        "missing provider must be an error",
      );
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
