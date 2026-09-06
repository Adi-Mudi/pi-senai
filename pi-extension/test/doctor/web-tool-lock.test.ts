import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSenaiDiagnostic } from "../../src/doctor/index.js";
import { saveAgentConfig } from "../../src/agents/config.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface AgentFixture {
  /** Role name as it appears in agents.json (e.g. "scout-2", "discussion"). */
  role: string;
  /** Agent file name (no .md). */
  fileName: string;
  /** Frontmatter tools list. */
  tools: string[];
}

/**
 * Save an agents.json mapping every role to a unique fileName, then write
 * the corresponding .md files. Returns the project root.
 *
 * The doctor resolves a role's agent by config → DEFAULT_AGENTS, so each
 * role needs its own file to set distinct tools. Built-in defaults are
 * deliberately NOT used here because they would clash (multiple roles map
 * to "scout", "planner", "worker", etc. by default).
 */
function setupProject(agents: AgentFixture[]): string {
  const tmpDir = makeTmpDir("web-tool-lock-");
  const agentsDir = path.join(tmpDir, ".pi", "agents");
  fs.mkdirSync(agentsDir, { recursive: true });

  const mapping: Record<string, string> = {};
  for (const a of agents) {
    mapping[a.role] = a.fileName;
    const filePath = path.join(agentsDir, `${a.fileName}.md`);
    const toolsLine = `tools: ${a.tools.join(", ")}`;
    const content = [
      "---",
      `name: ${a.fileName}`,
      `description: ${a.fileName} generated for test.`,
      toolsLine,
      "session-mode: lineage-only",
      "auto-exit: true",
      "spawning: false",
      "---",
      "",
      `# ${a.fileName}`,
      "",
      "Body for testing the web tool lock.",
      "",
    ].join("\n");
    fs.writeFileSync(filePath, content, "utf8");
  }

  saveAgentConfig(tmpDir, { version: 1, agents: mapping });
  return tmpDir;
}

function findSection(report: ReturnType<typeof runSenaiDiagnostic>, title: string) {
  const section = report.sections.find((s) => s.title === title);
  assert.ok(section, `section "${title}" must exist in the doctor report`);
  return section;
}

/** Standard healthy set: only `discussion` carries web tools. */
function healthyAgents(extraDiscussionTools: string[] = ["WebSearch", "FetchURL"]): AgentFixture[] {
  const discussionTools = ["read", "write", ...extraDiscussionTools];
  return [
    { role: "scout-2", fileName: "demo-scout-2", tools: ["read", "write"] },
    { role: "scout-3", fileName: "demo-scout-3", tools: ["read", "write"] },
    { role: "scout-4", fileName: "demo-scout-4", tools: ["read", "write"] },
    { role: "discussion", fileName: "demo-discussion", tools: discussionTools },
    { role: "plan-overview", fileName: "demo-plan-overview", tools: ["read", "write"] },
    { role: "test-skeleton", fileName: "demo-test-skeleton", tools: ["read", "write"] },
    { role: "linter", fileName: "demo-linter", tools: ["read", "bash", "write"] },
    { role: "full-test", fileName: "demo-full-test", tools: ["read", "bash", "write"] },
    { role: "readme-writer", fileName: "demo-readme-writer", tools: ["read", "write"] },
    { role: "changelog-writer", fileName: "demo-changelog-writer", tools: ["read", "write"] },
    { role: "api-docs-writer", fileName: "demo-api-docs-writer", tools: ["read", "write"] },
    { role: "other-docs-writer", fileName: "demo-other-docs-writer", tools: ["read", "write"] },
    { role: "security-gate", fileName: "demo-security-gate", tools: ["read", "write"] },
    { role: "archive", fileName: "demo-archive", tools: ["read", "bash", "write"] },
  ];
}

describe("doctor web tool lock (strict — one sub-agent only)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("web-tool-lock-empty-");
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports OK when only the discussion role carries web tools", () => {
    const project = setupProject(healthyAgents());
    try {
      const report = runSenaiDiagnostic(project);
      const section = findSection(report, "Web tool lock (strict — one sub-agent only)");
      assert.strictEqual(section.items.length, 1, "exactly one item on a clean lock");
      assert.strictEqual(section.items[0].status, "ok");
      assert.match(section.items[0].message, /intact/);
      assert.match(section.items[0].message, /\[discussion\]/);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("ERROR when a non-discussion role carries web tools", () => {
    const agents = healthyAgents();
    const linter = agents.find((a) => a.role === "linter")!;
    linter.tools = [...linter.tools, "WebSearch"]; // violation
    const project = setupProject(agents);
    try {
      const report = runSenaiDiagnostic(project);
      const section = findSection(report, "Web tool lock (strict — one sub-agent only)");
      const errorItem = section.items.find((i) => i.status === "error");
      assert.ok(errorItem, "violator must produce an ERROR item");
      assert.match(errorItem!.message, /VIOLATED/);
      assert.match(errorItem!.message, /1 non-discussion role/);
      const joined = (errorItem!.details ?? []).join("\n");
      assert.match(joined, /\blinter\b/);
      assert.match(joined, /WebSearch/);
      assert.match(joined, /remove from frontmatter/);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("ERROR when the discussion role is missing web tools (post-v7)", () => {
    const agents = healthyAgents([]); // no extra web tools on discussion
    const project = setupProject(agents);
    try {
      const report = runSenaiDiagnostic(project);
      const section = findSection(report, "Web tool lock (strict — one sub-agent only)");
      const errorItem = section.items.find((i) => i.status === "error");
      assert.ok(errorItem, "missing discussion web tools must produce an ERROR");
      assert.match(errorItem!.message, /VIOLATED/);
      assert.match(errorItem!.message, /lack web tools/);
      const joined = (errorItem!.details ?? []).join("\n");
      assert.match(joined, /\bdiscussion\b/);
      assert.match(joined, /regenerate via \/senai-generate-sub-agents/);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("single ERROR lists multiple violators (no per-role spam)", () => {
    const agents = healthyAgents();
    const linter = agents.find((a) => a.role === "linter")!;
    linter.tools = [...linter.tools, "WebSearch"]; // violation 1
    const fullTest = agents.find((a) => a.role === "full-test")!;
    fullTest.tools = [...fullTest.tools, "FetchURL"]; // violation 2
    const project = setupProject(agents);
    try {
      const report = runSenaiDiagnostic(project);
      const section = findSection(report, "Web tool lock (strict — one sub-agent only)");
      const errorItems = section.items.filter((i) => i.status === "error");
      assert.strictEqual(errorItems.length, 1, "one ERROR item covering all violators");
      assert.match(errorItems[0].message, /2 non-discussion role/);
      const joined = (errorItems[0].details ?? []).join("\n");
      assert.match(joined, /\blinter\b/);
      assert.match(joined, /\bfull-test\b/);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
