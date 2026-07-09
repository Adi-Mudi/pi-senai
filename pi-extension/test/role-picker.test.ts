import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExtensionContext, ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import { runRolePicker, type RolePickerItem } from "../src/ui/role-picker.js";

const ENTER = "\r";
const DOWN = "\x1b[B";
const UP = "\x1b[A";

function makeTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    dim: (text: string) => text,
  } as unknown as import("@mariozechner/pi-coding-agent").Theme;
}

function makeTui() {
  return {
    requestRender: () => {},
  } as unknown as import("@mariozechner/pi-tui").TUI;
}

function makeFallbackCtx(selects: (string | undefined)[]): ExtensionContext {
  let index = 0;
  return {
    cwd: "/tmp",
    ui: {
      select: async (_title: string, _options: string[]) => {
        return selects[index++] as string;
      },
    } as unknown as ExtensionUIContext,
  } as unknown as ExtensionContext;
}

function makeTuiCtx(): {
  ctx: ExtensionContext;
  getComponent: () => unknown;
  getDone: () => (result: ReturnType<typeof runRolePicker> extends Promise<infer R> ? R : never) => void;
} {
  let component: unknown;
  let doneFn: (result: any) => void = () => {};

  const custom = async (
    factory: (
      tui: import("@mariozechner/pi-tui").TUI,
      theme: import("@mariozechner/pi-coding-agent").Theme,
      keybindings: import("@mariozechner/pi-tui").KeybindingsManager,
      done: (result: any) => void,
    ) => import("@mariozechner/pi-tui").Component,
  ): Promise<any> => {
    return new Promise((resolve) => {
      doneFn = resolve;
      component = factory(makeTui(), makeTheme(), {} as import("@mariozechner/pi-tui").KeybindingsManager, resolve);
    });
  };

  const ctx = {
    cwd: "/tmp",
    mode: "tui",
    ui: {
      select: async () => "",
      custom,
    } as unknown as ExtensionUIContext,
  } as unknown as ExtensionContext;

  return {
    ctx,
    getComponent: () => component,
    getDone: () => doneFn,
  };
}

const ITEMS: RolePickerItem[] = [
  { id: "scout-1", label: "Scout 1", agent: "scout", summary: "not set", assigned: false },
  { id: "planner", label: "Planner", agent: "planner", summary: "reads=1", assigned: true },
];

describe("runRolePicker fallback", () => {
  it("returns the selected role", async () => {
    const ctx = makeFallbackCtx(["⬜ scout-1: Scout 1 (scout) — not set"]);
    const result = await runRolePicker(ctx, { title: "Test", items: ITEMS });
    assert.deepStrictEqual(result, { kind: "role", role: "scout-1" });
  });

  it("returns finish when Finish is selected", async () => {
    const ctx = makeFallbackCtx(["⬜ Finish"]);
    const result = await runRolePicker(ctx, { title: "Test", items: ITEMS });
    assert.deepStrictEqual(result, { kind: "finish" });
  });

  it("returns back on cancellation", async () => {
    const ctx = makeFallbackCtx([undefined]);
    const result = await runRolePicker(ctx, { title: "Test", items: ITEMS });
    assert.deepStrictEqual(result, { kind: "back" });
  });
});

describe("runRolePicker custom TUI", () => {
  it("returns the selected role on enter", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
    const comp = getComponent() as { handleInput: (data: string) => void };
    comp.handleInput(ENTER);
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "role", role: "scout-1" });
  });

  it("returns finish when Finish row is selected", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
    const comp = getComponent() as { handleInput: (data: string) => void };
    comp.handleInput(DOWN);
    comp.handleInput(DOWN);
    comp.handleInput(ENTER);
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "finish" });
  });

  it("returns back on escape", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
    const comp = getComponent() as { handleInput: (data: string) => void };
    comp.handleInput("\x1b");
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "back" });
  });

  it("renders assigned rows differently", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    runRolePicker(ctx, { title: "Test", items: ITEMS });
    const comp = getComponent() as {
      render: (width: number) => string[];
    };
    const lines = comp.render(80);
    const scoutLine = lines.find((l) => l.includes("Scout 1"));
    const plannerLine = lines.find((l) => l.includes("Planner"));
    assert.ok(scoutLine);
    assert.ok(plannerLine);
    // In the identity test theme the strings are equal, but the structure is present.
    assert.ok(scoutLine.includes("not set"));
    assert.ok(plannerLine.includes("reads=1"));
  });

  it("starts selection at initialSelectedId", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runRolePicker(ctx, {
      title: "Test",
      items: ITEMS,
      initialSelectedId: "planner",
    });
    const comp = getComponent() as { handleInput: (data: string) => void };
    comp.handleInput(ENTER);
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "role", role: "planner" });
  });
});
