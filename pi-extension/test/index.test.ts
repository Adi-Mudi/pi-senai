import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import piSenaiExtension from "../src/index.js";
import { resetCompletionGuard } from "../src/hooks/completion-guard.js";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

describe("index", () => {
  let tmpDir: string;
  let registeredCommands: string[];
  let eventHandlers: Record<string, (event: any, ctx: ExtensionContext) => any>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-index-test-"));
    registeredCommands = [];
    eventHandlers = {};
  });

  function makeApi(): ExtensionAPI {
    return {
      registerCommand: (name: string) => {
        registeredCommands.push(name);
      },
      registerTool: () => {},
      registerMessageRenderer: () => {},
      on: (event: string, handler: (event: any, ctx: ExtensionContext) => any) => {
        eventHandlers[event] = handler;
      },
      sendUserMessage: () => {},
      sendMessage: () => {},
    } as unknown as ExtensionAPI;
  }

  function makeCtx(): ExtensionContext {
    return {
      cwd: tmpDir,
      ui: {
        notify: () => {},
        confirm: async (_title: string, _message: string) => true,
        input: async () => "",
        select: async () => "",
      },
    } as unknown as ExtensionContext;
  }

  it("registers all slash commands", () => {
    piSenaiExtension(makeApi());
    assert.ok(registeredCommands.includes("senai-plan"));
    assert.ok(registeredCommands.includes("senai-status"));
  });

  it("injects status block when a run is active", async () => {
    const api = makeApi();
    piSenaiExtension(api);

    // Simulate starting a run through commands by writing state directly.
    const state = {
      version: 1,
      mission: "Test",
      runId: "run-1",
      currentStage: "planning",
      startedAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
      stageResults: {},
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/pi-senai/state.json"), JSON.stringify(state));

    const result = await eventHandlers["before_agent_start"](
      { systemPrompt: "base prompt" },
      makeCtx(),
    );

    assert.ok(result.systemPrompt.includes("base prompt"));
    assert.ok(result.systemPrompt.includes("Active stage: planning"));
    assert.ok(result.systemPrompt.includes("Mission: Test"));
  });

  it("does not inject status block when no run is active", async () => {
    const api = makeApi();
    piSenaiExtension(api);

    const result = await eventHandlers["before_agent_start"](
      { systemPrompt: "base prompt" },
      makeCtx(),
    );

    assert.strictEqual(result.systemPrompt, "base prompt");
  });

  it("injects Plan stage scout rule during planning", async () => {
    const api = makeApi();
    piSenaiExtension(api);

    const state = {
      version: 1,
      mission: "Test",
      runId: "run-1",
      currentStage: "planning",
      startedAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
      stageResults: {},
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/pi-senai/state.json"), JSON.stringify(state));

    const result = await eventHandlers["before_agent_start"](
      { systemPrompt: "base prompt" },
      makeCtx(),
    );

    assert.ok(result.systemPrompt.includes("Plan stage rule"));
    assert.ok(result.systemPrompt.includes("spawn four fresh scout subagents"));
  });

  it("does not inject Plan stage scout rule outside planning", async () => {
    const api = makeApi();
    piSenaiExtension(api);

    const state = {
      version: 1,
      mission: "Test",
      runId: "run-1",
      currentStage: "implementing",
      startedAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
      stageResults: {},
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/pi-senai/state.json"), JSON.stringify(state));

    const result = await eventHandlers["before_agent_start"](
      { systemPrompt: "base prompt" },
      makeCtx(),
    );

    assert.ok(result.systemPrompt.includes("Active stage: implementing"));
    assert.ok(!result.systemPrompt.includes("Plan stage rule"));
  });

  it("does not load inside subagent processes", () => {
    process.env.PI_SUBAGENT_NAME = "worker";
    piSenaiExtension(makeApi());
    assert.strictEqual(registeredCommands.length, 0);
    delete process.env.PI_SUBAGENT_NAME;
  });

  it("session_start cleans up orphan .tmp-* files inside the senai directory", async () => {
    // Plant a fake orphan left over by a previous session that crashed
    // between temp-file write and atomic rename. The cleanup walks the
    // senai root and one level into immediate subdirectories (e.g.
    // runs/<id>/).
    const senaiDir = path.join(tmpDir, ".IDE_Plans/pi-senai");
    fs.mkdirSync(senaiDir, { recursive: true });
    fs.writeFileSync(path.join(senaiDir, "state.json.tmp-9999-deadbeef"), "orphan");
    fs.mkdirSync(path.join(senaiDir, "runs", "orphan-run"), { recursive: true });
    fs.writeFileSync(path.join(senaiDir, "runs", "orphan-run", "plan.md.tmp-1234-aaaa"), "orphan");

    const api = makeApi();
    piSenaiExtension(api);
    await eventHandlers["session_start"]({}, makeCtx());

    // Root-level temp files are removed.
    const leftovers = fs.readdirSync(senaiDir).filter((n) => n.includes(".tmp"));
    assert.deepStrictEqual(leftovers, [], "root-level temp files cleaned");
    // Real files (e.g. the runs/<id> directory itself) are kept.
    assert.ok(fs.existsSync(path.join(senaiDir, "runs", "orphan-run")));
  });

  it("session_start surfaces lock info to the user when a run is active", async () => {
    const api = makeApi();
    piSenaiExtension(api);

    // Plant an active run.
    const state = {
      version: 1,
      mission: "Test",
      runId: "run-lock-surf",
      currentStage: "planning",
      startedAt: "2026-09-02T10:00:00Z",
      updatedAt: "2026-09-02T10:00:00Z",
      stageResults: {},
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/pi-senai/state.json"), JSON.stringify(state));

    // Plant a lock holder whose pid is NOT ours — otherwise the
    // session_start cleanup would release it before lockInfo runs.
    const lockDir = path.join(tmpDir, ".IDE_Plans/pi-senai/.lock");
    fs.mkdirSync(lockDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(lockDir, "meta.json"),
      JSON.stringify({
        pid: 2_000_000_777,
        host: "test-host",
        command: "/senai-approve",
        startedAt: now,
        heartbeatAt: now,
        mode: "approve",
        runId: "run-lock-surf",
      }),
      "utf8",
    );

    const notifications: string[] = [];
    const ctx = makeCtx();
    ctx.ui.notify = (msg: string) => notifications.push(msg);
    await eventHandlers["session_start"]({}, ctx);

    const statusLine = notifications.find((m) => m.includes("Active stage: planning"));
    assert.ok(statusLine, "status line emitted when a run is active");
    const lockLine = notifications.find((m) => m.includes("Lock held by"));
    assert.ok(lockLine, "lock state surfaced to the user");
    assert.ok(lockLine!.includes("pid=2000000777"));
    assert.ok(lockLine!.includes("test-host"));
  });

  it("session_start is silent when no run is active", async () => {
    const api = makeApi();
    piSenaiExtension(api);

    const notifications: string[] = [];
    const ctx = makeCtx();
    ctx.ui.notify = (msg: string) => notifications.push(msg);
    await eventHandlers["session_start"]({}, ctx);

    assert.strictEqual(notifications.length, 0, "no notify when there is no active run");
  });

  it("before_agent_start rejects when state.json is corrupted", async () => {
    const api = makeApi();
    piSenaiExtension(api);

    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/pi-senai/state.json"), "{ not valid json");

    await assert.rejects(
      () => eventHandlers["before_agent_start"]({ systemPrompt: "base prompt" }, makeCtx()),
      /Unexpected token|Expected property name/,
    );
  });

  it("before_agent_start still appends the status block to an empty system prompt", async () => {
    const api = makeApi();
    piSenaiExtension(api);

    const state = {
      version: 1,
      mission: "Test",
      runId: "run-1",
      currentStage: "implementing",
      startedAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
      stageResults: {},
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/pi-senai/state.json"), JSON.stringify(state));

    const result = await eventHandlers["before_agent_start"](
      { systemPrompt: "" },
      makeCtx(),
    );

    assert.ok(result.systemPrompt.includes("<pi-senai_status>"));
    assert.ok(result.systemPrompt.includes("Active stage: implementing"));
    assert.ok(result.systemPrompt.includes("</pi-senai_status>"));
  });

  it("registers a session_before_compact handler", () => {
    piSenaiExtension(makeApi());
    assert.ok(eventHandlers["session_before_compact"]);
  });

  it("session_before_compact returns undefined when no run is active", async () => {
    piSenaiExtension(makeApi());

    const result = await eventHandlers["session_before_compact"](
      { preparation: { firstKeptEntryId: "id-1", tokensBefore: 1000 } },
      makeCtx(),
    );

    assert.strictEqual(result, undefined);
  });

  it("session_before_compact supplies a deterministic summary when a run is active", async () => {
    piSenaiExtension(makeApi());
    const state = {
      version: 1,
      mission: "Test",
      runId: "run-1",
      currentStage: "planning",
      startedAt: "2026-08-12T00:00:00Z",
      updatedAt: "2026-08-12T00:00:00Z",
      stageResults: {},
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/pi-senai/state.json"), JSON.stringify(state));

    const result = await eventHandlers["session_before_compact"](
      { preparation: { firstKeptEntryId: "id-1", tokensBefore: 4321 } },
      makeCtx(),
    );

    assert.ok(result?.compaction);
    assert.strictEqual(result.compaction.firstKeptEntryId, "id-1");
    assert.strictEqual(result.compaction.tokensBefore, 4321);
    assert.ok(result.compaction.summary.includes("Run ID: run-1"));
    assert.ok(result.compaction.summary.includes("Current stage: planning"));
  });

  it("does not register the compaction hook inside subagent processes", () => {
    process.env.PI_SUBAGENT_NAME = "worker";
    try {
      piSenaiExtension(makeApi());
      assert.strictEqual(Object.keys(eventHandlers).length, 0);
    } finally {
      delete process.env.PI_SUBAGENT_NAME;
    }
  });
});

describe("coverage audit gaps", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-index-test-"));
  });

  function makeApi(): ExtensionAPI {
    return {
      registerCommand: () => {},
      registerTool: () => {},
      registerMessageRenderer: () => {},
      on: () => {},
      sendUserMessage: () => {},
      sendMessage: () => {},
    } as unknown as ExtensionAPI;
  }

  it("logs legacy orchestra dir and architect state migrations on load", () => {
    // The extension migrates under process.cwd(), so point it at the tmp dir.
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans", "orchestra"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".pi", "orchestra"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".IDE_Plans", "architect", "architect-report.json"),
      "{}",
    );

    const logs: string[] = [];
    const originalLog = console.log;
    const previousCwd = process.cwd();
    console.log = (msg: any) => {
      logs.push(String(msg));
    };
    try {
      process.chdir(tmpDir);
      piSenaiExtension(makeApi());
    } finally {
      process.chdir(previousCwd);
      console.log = originalLog;
    }

    assert.ok(
      logs.some((l) => l.includes("Migrated 1 architecture file(s) to .pi/architect/.")),
      `expected the architect migration log line, got: ${logs.join(" | ")}`,
    );
    assert.ok(
      logs.some((l) => l.includes("Migrated legacy directories:")),
      `expected the orchestra dir migration log line, got: ${logs.join(" | ")}`,
    );
    assert.ok(fs.existsSync(path.join(tmpDir, ".IDE_Plans", "pi-senai")));
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "senai")));
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "architect", "architect-report.json")));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".IDE_Plans", "orchestra")));
  });

  it("registerArchitectTools registers both architect tools", () => {
    const tools: string[] = [];
    const api = makeApi();
    (api as any).registerTool = (tool: { name: string }) => {
      tools.push(tool.name);
    };

    piSenaiExtension(api);

    assert.ok(tools.includes("senai_merge_architect_drivers"));
    assert.ok(tools.includes("senai_finalize_architecture"));
  });
});

describe("completion-guard hook wiring", () => {
  let tmpDir: string;
  let registeredCommands: string[];
  let eventHandlers: Record<string, (event: any, ctx: ExtensionContext) => any>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-index-guard-"));
    registeredCommands = [];
    eventHandlers = {};
    resetCompletionGuard();
  });

  function makeApi(): ExtensionAPI {
    return {
      registerCommand: (name: string) => {
        registeredCommands.push(name);
      },
      registerTool: () => {},
      registerMessageRenderer: () => {},
      on: (event: string, handler: (event: any, ctx: ExtensionContext) => any) => {
        eventHandlers[event] = handler;
      },
      sendUserMessage: () => {},
      sendMessage: () => {},
    } as unknown as ExtensionAPI;
  }

  function makeCtx(): ExtensionContext {
    return {
      cwd: tmpDir,
      ui: {
        notify: () => {},
        confirm: async (_title: string, _message: string) => true,
        input: async () => "",
        select: async () => "",
      },
    } as unknown as ExtensionContext;
  }

  function writeActiveRun(): void {
    const state = {
      version: 1,
      mission: "Test",
      runId: "run-1",
      currentStage: "planning",
      startedAt: "2026-08-28T00:00:00Z",
      updatedAt: "2026-08-28T00:00:00Z",
      stageResults: {},
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/pi-senai/state.json"), JSON.stringify(state));
  }

  it("input hook appends the artifact warning to an extension-source completion with a missing artifact", async () => {
    piSenaiExtension(makeApi());
    writeActiveRun();

    // Record the spawn through the tool_call hook (name + task carry the artifact path).
    eventHandlers["tool_call"](
      {
        toolName: "subagent",
        input: { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/run-1/plan/scouts/scout-angle_2.md" },
      },
      makeCtx(),
    );

    const result = await eventHandlers["input"](
      { source: "extension", text: 'Sub-agent "scout-2" completed (3s).' },
      makeCtx(),
    );

    assert.ok(result, "transform result expected");
    assert.strictEqual(result.action, "transform");
    assert.ok(result.text.startsWith('Sub-agent "scout-2" completed (3s).'), "original text kept");
    assert.ok(result.text.includes("[pi-senai artifact guard]"), "warning appended");
    assert.ok(result.text.includes("scout-angle_2.md"), "missing artifact named");
  });

  it("input hook ignores non-extension sources even when the text matches a completion", async () => {
    piSenaiExtension(makeApi());
    writeActiveRun();
    eventHandlers["tool_call"](
      {
        toolName: "subagent",
        input: { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/run-1/plan/scouts/scout-angle_2.md" },
      },
      makeCtx(),
    );

    const result = await eventHandlers["input"](
      { source: "user", text: 'Sub-agent "scout-2" completed (3s).' },
      makeCtx(),
    );

    assert.strictEqual(result, undefined, "non-extension input must pass through untouched");
  });

  it("tool_call records spawn artifacts observable via a later input; non-spawn tools record nothing", async () => {
    piSenaiExtension(makeApi());
    writeActiveRun();

    // Non-spawn tool: passes through (no block) and records nothing.
    const bashResult = eventHandlers["tool_call"](
      { toolName: "bash", input: { command: "ls" } },
      makeCtx(),
    );
    assert.strictEqual(bashResult, undefined, "non-spawn tool must pass through");

    const afterBash = await eventHandlers["input"](
      { source: "extension", text: 'Sub-agent "scout-2" completed (3s).' },
      makeCtx(),
    );
    assert.strictEqual(afterBash, undefined, "nothing recorded by the bash call");

    // The full round trip: tool_call records, input observes.
    eventHandlers["tool_call"](
      {
        toolName: "subagent_resume",
        input: { name: "scout-2", task: "Write .IDE_Plans/pi-senai/runs/run-1/plan/scouts/scout-angle_2.md" },
      },
      makeCtx(),
    );
    const afterSpawn = await eventHandlers["input"](
      { source: "extension", text: 'Sub-agent "scout-2" completed (3s).' },
      makeCtx(),
    );
    assert.ok(afterSpawn?.text?.includes("[pi-senai artifact guard]"), "recorded spawn is verified at completion");
  });

  it("registers the senai-generate-docs-structure command", () => {
    piSenaiExtension(makeApi());
    assert.ok(registeredCommands.includes("senai-generate-docs-structure"));
  });
});
