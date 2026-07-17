import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerCommands } from "../src/commands.js";
import { saveAgentConfig } from "../src/agent-config.js";
import { saveFilesConfig } from "../src/files-config.js";
import { saveAgentsFilesConfig } from "../src/agents-files-config.js";
import { DEFAULT_AGENTS } from "../src/agent-suggestions.js";
import { loadState } from "../src/state.js";
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * End-to-end smoke test.
 *
 * Simulates a full Plan → Implement → Document → Deliver run by:
 * 1. Starting a plan.
 * 2. Creating the artifacts the Plan stage agents would produce.
 * 3. Approving through each stage.
 *
 * This does not spawn real subagents; it verifies that the extension's
 * state machine, artifact checks, and auto-advance behavior work end-to-end.
 */
describe("smoke", () => {
  let tmpDir: string;
  let notifications: Array<{ message: string; type: string }>;
  let sentMessages: string[];
  let commandHandlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-smoke-"));
    notifications = [];
    sentMessages = [];
    commandHandlers = {};
    saveAgentConfig(tmpDir, { version: 1, agents: { ...DEFAULT_AGENTS } });
    saveFilesConfig(tmpDir, {
      version: 2,
      codePaths: [],
      inputDocuments: [],
      testPaths: [],
      excludedPaths: [".git/", "node_modules/"],
    });
    saveAgentsFilesConfig(tmpDir, { version: 2, documents: {} });
  });

  function makeCtx(): ExtensionContext {
    return {
      cwd: tmpDir,
      ui: {
        notify: (message: string, type: string) => {
          notifications.push({ message, type });
        },
        confirm: async (_title: string, _message: string) => true,
        input: async () => "",
        select: async () => "",
      },
    } as unknown as ExtensionContext;
  }

  function makeApi(): ExtensionAPI {
    return {
      registerCommand: (name: string, cmd: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
        commandHandlers[name] = cmd.handler;
      },
      registerTool: () => {},
      on: () => {},
      registerMessageRenderer: () => {},
      sendUserMessage: (message: string) => {
        sentMessages.push(message);
      },
      sendMessage: () => {},
    } as unknown as ExtensionAPI;
  }

  function getRunDir(): string {
    const state = loadState(tmpDir);
    return path.join(tmpDir, ".IDE_Plans/senai/runs", state.runId);
  }

  it("full Plan → Implement → Document → Deliver lifecycle", async () => {
    registerCommands(makeApi());

    // 1. Plan
    await commandHandlers["senai-plan"]("Add a hello world CLI", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "planning");
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Plan Stage"));

    // Simulate Plan stage agents writing artifacts.
    const runDir = getRunDir();
    fs.writeFileSync(path.join(runDir, "plan/scouts/scout-angle_1.md"), "# Scout 1\n");
    fs.writeFileSync(path.join(runDir, "plan/scouts/scout-angle_2.md"), "# Scout 2\n");
    fs.writeFileSync(path.join(runDir, "plan/scouts/scout-angle_3.md"), "# Scout 3\n");
    fs.writeFileSync(path.join(runDir, "plan/scouts/scout-angle_4.md"), "# Scout 4\n");
    fs.writeFileSync(path.join(runDir, "plan/discussion-notes.md"), "# Discussion\n");
    fs.writeFileSync(path.join(runDir, "plan/plan.md"), "# Plan\n");
    fs.writeFileSync(path.join(runDir, "plan/plan-overview.md"), "# Overview\n");
    fs.writeFileSync(path.join(runDir, "plan/reviews/review-correctness.md"), "# Correctness\n");
    fs.writeFileSync(path.join(runDir, "plan/reviews/review-security.md"), "# Security\n");
    fs.writeFileSync(path.join(runDir, "plan/reviews/review-tests.md"), "# Tests\n");

    // 2. Approve plan → auto-starts Implement
    sentMessages.length = 0;
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "implementing");
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Implement Stage"));

    // Simulate Implement stage agents.
    fs.mkdirSync(path.join(runDir, "implement/src"), { recursive: true });
    fs.mkdirSync(path.join(runDir, "implement/test"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "implement/src/index.ts"), "console.log('hello');\n");
    fs.writeFileSync(path.join(runDir, "implement/test/index.test.ts"), "// tests\n");

    // 3. Approve implement → auto-starts Document
    sentMessages.length = 0;
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "documenting");
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Document Stage"));

    // Simulate Document stage agents.
    fs.writeFileSync(path.join(runDir, "document/README.md"), "# README\n");
    fs.writeFileSync(path.join(runDir, "document/CHANGELOG.md"), "# CHANGELOG\n");

    // 4. Approve document → auto-starts Deliver
    sentMessages.length = 0;
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "delivering");
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].includes("Deliver Stage"));

    // Simulate Deliver stage agents.
    fs.writeFileSync(path.join(runDir, "deliver/security-report.md"), "# Security Report\n");
    fs.writeFileSync(path.join(runDir, "deliver/deliver-summary.md"), "# Deliver Summary\n");

    // 5. Approve deliver → run delivered
    sentMessages.length = 0;
    await commandHandlers["senai-approve"]("", makeCtx());
    assert.strictEqual(loadState(tmpDir).currentStage, "delivered");
    assert.strictEqual(sentMessages.length, 0);

    // Verify all expected artifacts exist.
    const expected = [
      path.join(runDir, "plan/plan.md"),
      path.join(runDir, "plan/plan-overview.md"),
      path.join(runDir, "plan/discussion-notes.md"),
      path.join(runDir, "plan/scouts/scout-angle_1.md"),
      path.join(runDir, "plan/scouts/scout-angle_2.md"),
      path.join(runDir, "plan/scouts/scout-angle_3.md"),
      path.join(runDir, "plan/scouts/scout-angle_4.md"),
      path.join(runDir, "plan/reviews/review-correctness.md"),
      path.join(runDir, "plan/reviews/review-security.md"),
      path.join(runDir, "plan/reviews/review-tests.md"),
      path.join(runDir, "implement/src/index.ts"),
      path.join(runDir, "document/README.md"),
      path.join(runDir, "deliver/security-report.md"),
      path.join(runDir, "deliver/deliver-summary.md"),
    ];
    for (const file of expected) {
      assert.ok(fs.existsSync(file), `missing artifact: ${file}`);
    }
  });
});
