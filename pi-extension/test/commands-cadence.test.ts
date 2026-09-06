import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerCommands } from "../src/commands/index.js";
import {
  loadCadenceState,
  record429,
  saveCadenceState,
  defaultCadenceState,
} from "../src/implement/cadence.js";
import { getCadencePath } from "../src/core/paths.js";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

describe("commands — cadence", () => {
  let tmpDir: string;
  let notifications: Array<{ message: string; type: string }>;
  let confirmResults: boolean[];
  let confirmIndex: number;
  let commandHandlers: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-cmd-cadence-"));
    notifications = [];
    confirmResults = [];
    confirmIndex = 0;
    commandHandlers = {};
  });

  function makeCtx(): ExtensionContext {
    return {
      cwd: tmpDir,
      ui: {
        notify: (message: string, type: string) => {
          notifications.push({ message, type });
        },
        confirm: async (_title: string, _message: string) => {
          if (confirmIndex >= confirmResults.length) return true;
          return confirmResults[confirmIndex++];
        },
        input: async () => "",
        editor: async () => "",
        select: async (_title: string, options: string[]) => options[0],
      },
      getContextUsage: () => undefined,
      compact: () => {},
    } as unknown as ExtensionContext;
  }

  function makeApi(): ExtensionAPI {
    return {
      registerCommand: (
        name: string,
        cmd: { handler: (args: string, ctx: ExtensionContext) => Promise<void> },
      ) => {
        commandHandlers[name] = cmd.handler;
      },
      registerTool: () => {},
      on: () => {},
      registerMessageRenderer: () => {},
      sendUserMessage: () => {},
      sendMessage: () => {},
    } as unknown as ExtensionAPI;
  }

  it("registers /senai-cadence-status and /senai-cadence-reset alongside the existing commands", () => {
    registerCommands(makeApi());
    assert.ok(commandHandlers["senai-cadence-status"], "missing senai-cadence-status");
    assert.ok(commandHandlers["senai-cadence-reset"], "missing senai-cadence-reset");
  });

  it("/senai-cadence-status is read-only — does not mutate the cadence file", async () => {
    saveCadenceState(tmpDir, { ...defaultCadenceState(), tier: "C" });
    registerCommands(makeApi());
    await commandHandlers["senai-cadence-status"]("", makeCtx());

    const after = loadCadenceState(tmpDir);
    assert.strictEqual(after.tier, "C", "tier should be unchanged");
    assert.strictEqual(after.history.length, 0, "no history should be added by status");
    assert.ok(notifications.length >= 1);
    assert.ok(notifications[0].message.includes("C (batch-2)"));
  });

  it("/senai-cadence-reset asks for confirm and writes a manual-reset history entry when confirmed", async () => {
    saveCadenceState(tmpDir, { ...defaultCadenceState(), tier: "D", consecutiveCleanRuns: 5 });
    confirmResults.push(true);
    registerCommands(makeApi());
    await commandHandlers["senai-cadence-reset"]("", makeCtx());

    const after = loadCadenceState(tmpDir);
    assert.strictEqual(after.tier, "A");
    assert.strictEqual(after.consecutiveCleanRuns, 0);
    assert.strictEqual(after.history.length, 1);
    assert.strictEqual(after.history[0].reason, "reset:manual");
    assert.strictEqual(after.history[0].from, "D");
  });

  it("/senai-cadence-reset is a no-op when the user cancels", async () => {
    saveCadenceState(tmpDir, { ...defaultCadenceState(), tier: "D" });
    confirmResults.push(false);
    registerCommands(makeApi());
    await commandHandlers["senai-cadence-reset"]("", makeCtx());

    const after = loadCadenceState(tmpDir);
    assert.strictEqual(after.tier, "D", "tier must be preserved on cancel");
    assert.strictEqual(after.history.length, 0);
  });

  it("both commands handle a missing cadence file without throwing", async () => {
    // No saveCadenceState — file does not exist on disk.
    assert.ok(!fs.existsSync(getCadencePath(tmpDir)));
    registerCommands(makeApi());
    await commandHandlers["senai-cadence-status"]("", makeCtx());
    assert.ok(notifications.length >= 1);
    assert.ok(notifications[0].message.includes("A (parallel burst)"));

    confirmResults.push(true);
    await commandHandlers["senai-cadence-reset"]("", makeCtx());
    const after = loadCadenceState(tmpDir);
    assert.strictEqual(after.tier, "A");
  });

  it("/senai-cadence-status surfaces a demoted tier after record429", async () => {
    record429(tmpDir);
    record429(tmpDir);
    registerCommands(makeApi());
    await commandHandlers["senai-cadence-status"]("", makeCtx());

    assert.ok(
      notifications.some((n) => n.message.includes("C (batch-2)")),
      "should report the demoted tier",
    );
    assert.ok(
      notifications.some((n) => n.message.includes("Last rate-limit error")),
      "should report the last 429 timestamp",
    );
  });
});
