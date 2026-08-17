import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import piSenaiExtension from "../src/index.js";
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
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/senai/state.json"), JSON.stringify(state));

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
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/senai/state.json"), JSON.stringify(state));

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
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/senai/state.json"), JSON.stringify(state));

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

  it("before_agent_start rejects when state.json is corrupted", async () => {
    const api = makeApi();
    piSenaiExtension(api);

    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/senai/state.json"), "{ not valid json");

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
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/senai/state.json"), JSON.stringify(state));

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
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/senai/state.json"), JSON.stringify(state));

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
    assert.ok(fs.existsSync(path.join(tmpDir, ".IDE_Plans", "senai")));
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
