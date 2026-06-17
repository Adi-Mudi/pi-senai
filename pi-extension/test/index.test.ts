import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import piOrchestraExtension from "../src/index.js";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

describe("index", () => {
  let tmpDir: string;
  let registeredCommands: string[];
  let eventHandlers: Record<string, (event: any, ctx: ExtensionContext) => any>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orchestra-index-test-"));
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
    piOrchestraExtension(makeApi());
    assert.ok(registeredCommands.includes("orchestra-plan"));
    assert.ok(registeredCommands.includes("orchestra-status"));
  });

  it("injects status block when a run is active", async () => {
    const api = makeApi();
    piOrchestraExtension(api);

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
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/orchestra"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/orchestra/state.json"), JSON.stringify(state));

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
    piOrchestraExtension(api);

    const result = await eventHandlers["before_agent_start"](
      { systemPrompt: "base prompt" },
      makeCtx(),
    );

    assert.strictEqual(result.systemPrompt, "base prompt");
  });

  it("injects Plan stage scout rule during planning", async () => {
    const api = makeApi();
    piOrchestraExtension(api);

    const state = {
      version: 1,
      mission: "Test",
      runId: "run-1",
      currentStage: "planning",
      startedAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
      stageResults: {},
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/orchestra"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/orchestra/state.json"), JSON.stringify(state));

    const result = await eventHandlers["before_agent_start"](
      { systemPrompt: "base prompt" },
      makeCtx(),
    );

    assert.ok(result.systemPrompt.includes("Plan stage rule"));
    assert.ok(result.systemPrompt.includes("spawn three fresh scout subagents"));
  });

  it("does not inject Plan stage scout rule outside planning", async () => {
    const api = makeApi();
    piOrchestraExtension(api);

    const state = {
      version: 1,
      mission: "Test",
      runId: "run-1",
      currentStage: "implementing",
      startedAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
      stageResults: {},
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans/orchestra"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans/orchestra/state.json"), JSON.stringify(state));

    const result = await eventHandlers["before_agent_start"](
      { systemPrompt: "base prompt" },
      makeCtx(),
    );

    assert.ok(result.systemPrompt.includes("Active stage: implementing"));
    assert.ok(!result.systemPrompt.includes("Plan stage rule"));
  });

  it("does not load inside subagent processes", () => {
    process.env.PI_SUBAGENT_NAME = "worker";
    piOrchestraExtension(makeApi());
    assert.strictEqual(registeredCommands.length, 0);
    delete process.env.PI_SUBAGENT_NAME;
  });
});
