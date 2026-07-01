import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runOrchestraDiagnostic, formatDiagnosticReport } from "../src/doctor.js";
import { saveAgentConfig } from "../src/agent-config.js";
import { saveFilesConfig } from "../src/files-config.js";
import { saveAgentsFilesConfig } from "../src/agents-files-config.js";

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
    const report = runOrchestraDiagnostic(tmpDir);

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

    const report = runOrchestraDiagnostic(tmpDir);

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

    const report = runOrchestraDiagnostic(tmpDir);

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

    const report = runOrchestraDiagnostic(tmpDir);

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

    const report = runOrchestraDiagnostic(tmpDir);

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

    const report = runOrchestraDiagnostic(tmpDir);

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

    const report = runOrchestraDiagnostic(tmpDir);

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

    const report = runOrchestraDiagnostic(tmpDir);
    const text = formatDiagnosticReport(report);

    assert.ok(text.includes("Pi Orchestra Diagnostic Report"));
    assert.ok(text.includes("Configuration files"));
    assert.ok(text.includes("Agent mapping sources"));
    assert.ok(text.includes("Agent-role capability fit"));
    assert.ok(text.includes("Project file scope"));
    assert.ok(text.includes("Agent document assignments"));
    assert.ok(text.includes("Runtime environment"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
