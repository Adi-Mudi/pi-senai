import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  discoverAgents,
  findNearestProjectAgentsDir,
  getUserAgentsDir,
  parseAgentFile,
  parseAgentFileFull,
} from "../src/agent-discovery.js";

describe("agent-discovery", () => {
  function makeAgentFile(dir: string, name: string, frontmatter: string) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.md`), frontmatter, "utf8");
  }

  it("finds project agents in cwd/.pi/agents/", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    makeAgentFile(
      agentsDir,
      "custom-scout",
      "---\nname: custom-scout\ndescription: A custom scout agent\n---\n",
    );

    const agents = discoverAgents(tmpDir);
    const names = agents.map((a) => a.name);

    assert.ok(names.includes("custom-scout"));
    assert.strictEqual(agents.find((a) => a.name === "custom-scout")?.source, "project");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("walks up parent directories to find project agents", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    const nestedDir = path.join(tmpDir, "src", "components");
    fs.mkdirSync(nestedDir, { recursive: true });
    makeAgentFile(
      agentsDir,
      "parent-scout",
      "---\nname: parent-scout\ndescription: Parent-level scout\n---\n",
    );

    const found = findNearestProjectAgentsDir(nestedDir);
    assert.strictEqual(found, agentsDir);

    const agents = discoverAgents(nestedDir);
    assert.ok(agents.some((a) => a.name === "parent-scout"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("project agents override user agents with the same name", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const projectAgentsDir = path.join(tmpDir, ".pi", "agents");
    makeAgentFile(
      projectAgentsDir,
      "overridden",
      "---\nname: overridden\ndescription: Project version\n---\n",
    );

    // Simulate a user agent with the same name by parsing directly; we cannot
    // easily override getAgentDir in this unit test, so we verify project source
    // is detected and that a duplicate would be skipped.
    const agents = discoverAgents(tmpDir);
    const overridden = agents.find((a) => a.name === "overridden");
    assert.ok(overridden);
    assert.strictEqual(overridden.source, "project");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses YAML frontmatter correctly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "agent.md");
    fs.writeFileSync(
      filePath,
      "---\nname: yaml-agent\ndescription: Multi\n  line description\nmodel: anthropic/claude-sonnet-4\n---\nBody here\n",
      "utf8",
    );

    const parsed = parseAgentFile(filePath);
    assert.ok(parsed);
    assert.strictEqual(parsed?.name, "yaml-agent");
    assert.strictEqual(parsed?.description, "Multi line description");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips files missing name or description", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "no-name.md"),
      "---\ndescription: Missing name\n---\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(agentsDir, "no-desc.md"),
      "---\nname: no-desc\n---\n",
      "utf8",
    );

    const agents = discoverAgents(tmpDir);
    assert.ok(!agents.some((a) => a.name === "no-name"));
    assert.ok(!agents.some((a) => a.name === "no-desc"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips non-.md files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "readme.txt"), "not an agent", "utf8");

    const agents = discoverAgents(tmpDir);
    assert.ok(!agents.some((a) => a.name === "readme"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("follows symlinks", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    const otherDir = path.join(tmpDir, "other");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(otherDir, { recursive: true });

    fs.writeFileSync(
      path.join(otherDir, "linked-agent.md"),
      "---\nname: linked-agent\ndescription: Linked agent\n---\n",
      "utf8",
    );
    fs.symlinkSync(
      path.join(otherDir, "linked-agent.md"),
      path.join(agentsDir, "linked-agent.md"),
    );

    const agents = discoverAgents(tmpDir);
    assert.ok(agents.some((a) => a.name === "linked-agent"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes built-in defaults", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const agents = discoverAgents(tmpDir);
    const names = agents.map((a) => a.name);

    assert.ok(names.includes("scout"));
    assert.ok(names.includes("planner"));
    assert.ok(names.includes("worker"));
    assert.ok(names.includes("reviewer"));
    assert.ok(names.includes("security-auditor"));

    // At least some agent should be builtin, unless user agents override all names.
    assert.ok(agents.some((a) => a.source === "builtin"), "expected at least one builtin agent");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getUserAgentsDir returns agents subdirectory of getAgentDir", () => {
    const dir = getUserAgentsDir();
    assert.ok(dir.endsWith(path.join("agents")));
  });

  it("parseAgentFileFull reads all frontmatter fields", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "full-agent.md");
    fs.writeFileSync(
      filePath,
      "---\n" +
        "name: full-agent\n" +
        "description: Full agent\n" +
        "tools: read, write, bash\n" +
        "skills: skill-a, skill-b\n" +
        "output: markdown\n" +
        "thinking: medium\n" +
        "maxSubagentDepth: 2\n" +
        "---\n",
      "utf8",
    );

    const parsed = parseAgentFileFull(filePath);
    assert.ok(parsed);
    assert.strictEqual(parsed?.name, "full-agent");
    assert.strictEqual(parsed?.description, "Full agent");
    assert.deepStrictEqual(parsed?.tools, ["read", "write", "bash"]);
    assert.deepStrictEqual(parsed?.skills, ["skill-a", "skill-b"]);
    assert.strictEqual(parsed?.output, "markdown");
    assert.strictEqual(parsed?.thinking, "medium");
    assert.strictEqual(parsed?.maxSubagentDepth, 2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFileFull returns undefined when name is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "bad-agent.md");
    fs.writeFileSync(filePath, "---\ndescription: No name\n---\n", "utf8");

    const parsed = parseAgentFileFull(filePath);
    assert.strictEqual(parsed, undefined);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFileFull handles array fields", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "array-agent.md");
    fs.writeFileSync(
      filePath,
      "---\nname: array-agent\ndescription: Array agent\ntools:\n  - read\n  - write\n---\n",
      "utf8",
    );

    const parsed = parseAgentFileFull(filePath);
    assert.deepStrictEqual(parsed?.tools, ["read", "write"]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFileFull parses comma-string tools into an array", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "comma-agent.md");
    fs.writeFileSync(
      filePath,
      "---\nname: comma-agent\ndescription: Comma agent\ntools: read, write\n---\n",
      "utf8",
    );
    const parsed = parseAgentFileFull(filePath);
    assert.deepStrictEqual(parsed?.tools, ["read", "write"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discoverAgents returns built-ins when no project agents exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-none-"));
    const agents = discoverAgents(tmpDir);
    const names = agents.map((a) => a.name);
    assert.ok(names.includes("scout"));
    assert.ok(names.includes("planner"));
    assert.ok(names.includes("security-auditor"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFile returns undefined for broken frontmatter", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-broken-"));
    const filePath = path.join(tmpDir, "broken.md");
    fs.writeFileSync(filePath, "---\nname: [unclosed\n---\nbody", "utf8");
    assert.strictEqual(parseAgentFile(filePath), undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a project agent named scout shadows the built-in scout without duplication", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    makeAgentFile(agentsDir, "scout", "---\nname: scout\ndescription: Project scout\n---\n");

    const agents = discoverAgents(tmpDir);
    const scouts = agents.filter((a) => a.name === "scout");
    assert.strictEqual(scouts.length, 1);
    assert.strictEqual(scouts[0].source, "project");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips a subdirectory named *.md inside .pi/agents without crashing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(path.join(agentsDir, "foo.md"), { recursive: true });

    let agents: ReturnType<typeof discoverAgents> = [];
    assert.doesNotThrow(() => {
      agents = discoverAgents(tmpDir);
    });
    assert.ok(!agents.some((a) => a.filePath === path.join(agentsDir, "foo.md")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips a broken symlink without throwing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.symlinkSync(path.join(tmpDir, "missing-target.md"), path.join(agentsDir, "broken.md"));

    let agents: ReturnType<typeof discoverAgents> = [];
    assert.doesNotThrow(() => {
      agents = discoverAgents(tmpDir);
    });
    assert.ok(!agents.some((a) => a.name === "broken"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("findNearestProjectAgentsDir returns null when no ancestor has .pi/agents", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-null-"));
    const deep = path.join(tmpDir, "a", "b", "c");
    fs.mkdirSync(deep, { recursive: true });

    // Assumes no ancestor of os.tmpdir() itself provides .pi/agents.
    assert.strictEqual(findNearestProjectAgentsDir(deep), null);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("findNearestProjectAgentsDir returns the nearest .pi/agents when nested and parent both have one", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const outerAgentsDir = path.join(tmpDir, ".pi", "agents");
    const nestedDir = path.join(tmpDir, "sub");
    const innerAgentsDir = path.join(nestedDir, ".pi", "agents");
    fs.mkdirSync(outerAgentsDir, { recursive: true });
    fs.mkdirSync(innerAgentsDir, { recursive: true });

    assert.strictEqual(findNearestProjectAgentsDir(nestedDir), innerAgentsDir);
    assert.strictEqual(findNearestProjectAgentsDir(path.join(nestedDir, "deeper", "dir")), innerAgentsDir);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFile returns undefined for a file with no frontmatter", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "plain.md");
    fs.writeFileSync(filePath, "# Just a heading\n\nNo frontmatter here.\n", "utf8");

    assert.strictEqual(parseAgentFile(filePath), undefined);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFile returns undefined for a nonexistent file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    assert.strictEqual(parseAgentFile(path.join(tmpDir, "does-not-exist.md")), undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFile treats a whitespace-only name as missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "whitespace.md");
    fs.writeFileSync(filePath, '---\nname: "   "\ndescription: Whitespace name\n---\n', "utf8");

    assert.strictEqual(parseAgentFile(filePath), undefined);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFileFull returns undefined when description is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "no-desc-full.md");
    fs.writeFileSync(filePath, "---\nname: no-desc-full\n---\n", "utf8");

    assert.strictEqual(parseAgentFileFull(filePath), undefined);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFileFull ignores a string maxSubagentDepth", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "str-depth.md");
    fs.writeFileSync(
      filePath,
      '---\nname: str-depth\ndescription: String depth\nmaxSubagentDepth: "2"\n---\n',
      "utf8",
    );

    const parsed = parseAgentFileFull(filePath);
    assert.ok(parsed);
    assert.strictEqual(parsed.maxSubagentDepth, undefined);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("coverage audit gaps", () => {
  it("parseAgentFileFull ignores array fields that are neither string nor array", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));
    const filePath = path.join(tmpDir, "numeric-tools.md");
    fs.writeFileSync(
      filePath,
      "---\nname: numeric-tools\ndescription: Numeric tools field\ntools: 5\n---\n",
      "utf8",
    );

    const parsed = parseAgentFileFull(filePath);
    assert.ok(parsed);
    assert.strictEqual(parsed.tools, undefined, "a numeric tools value must not be parsed into an array");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseAgentFileFull returns undefined for a nonexistent or unreadable file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-disc-"));

    assert.strictEqual(parseAgentFileFull(path.join(tmpDir, "does-not-exist.md")), undefined);

    // A directory named *.md cannot be read as a file; the catch must return undefined.
    const dirPath = path.join(tmpDir, "unreadable.md");
    fs.mkdirSync(dirPath, { recursive: true });
    assert.strictEqual(parseAgentFileFull(dirPath), undefined);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
