import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExtensionContext, ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import { runListEditor, type ListEditorAction, type ListEditorOptions } from "../src/ui/list-editor.js";

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

function makeFallbackCtx(
  selects: (string | undefined)[],
  inputs: (string | undefined)[],
): ExtensionContext {
  let selectIndex = 0;
  let inputIndex = 0;
  return {
    cwd: "/tmp",
    ui: {
      select: async (_title: string, options: string[]) => {
        const choice = selects[selectIndex++];
        return choice ?? options[0];
      },
      input: async () => inputs[inputIndex++] ?? "",
    } as unknown as ExtensionUIContext,
  } as unknown as ExtensionContext;
}

function makeTuiCtx(): {
  ctx: ExtensionContext;
  getComponent: () => unknown;
  getDone: () => (action: ListEditorAction) => void;
} {
  let component: unknown;
  let doneFn: (action: ListEditorAction) => void = () => {};

  const custom = async (
    factory: (
      tui: import("@mariozechner/pi-tui").TUI,
      theme: import("@mariozechner/pi-coding-agent").Theme,
      keybindings: import("@mariozechner/pi-tui").KeybindingsManager,
      done: (result: ListEditorAction) => void,
    ) => import("@mariozechner/pi-tui").Component,
  ): Promise<ListEditorAction> => {
    return new Promise((resolve) => {
      doneFn = resolve;
      component = factory(makeTui(), makeTheme(), {} as import("@mariozechner/pi-tui").KeybindingsManager, resolve);
    });
  };

  const ctx = {
    cwd: "/tmp",
    mode: "tui",
    ui: {
      input: async () => "",
      custom,
    } as unknown as ExtensionUIContext,
  } as unknown as ExtensionContext;

  return {
    ctx,
    getComponent: () => component,
    getDone: () => doneFn,
  };
}

function selectedLine(lines: string[]): string | undefined {
  return lines.find((line) => line.startsWith("→"));
}

describe("runListEditor fallback", () => {
  it("returns done with current paths on Back", async () => {
    const ctx = makeFallbackCtx(["Back"], []);
    const result = await runListEditor(ctx, {
      title: "Test",
      items: [
        { id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" },
        { id: "r1", kind: "selected", label: "✅ Remove: b", value: "b" },
      ],
    });
    assert.deepStrictEqual(result, { kind: "done", paths: ["b"] });
  });

  it("adds a suggestion and returns done with it", async () => {
    const ctx = makeFallbackCtx(["⬜ Suggest: a", "Back"], []);
    const result = await runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
    });
    assert.deepStrictEqual(result, { kind: "done", paths: ["a"] });
  });

  it("removes a selected path and returns done", async () => {
    const ctx = makeFallbackCtx(["✅ Remove: b", "Back"], []);
    const result = await runListEditor(ctx, {
      title: "Test",
      items: [{ id: "r1", kind: "selected", label: "✅ Remove: b", value: "b" }],
    });
    assert.deepStrictEqual(result, { kind: "done", paths: [] });
  });

  it("returns filter action with query", async () => {
    const ctx = makeFallbackCtx(["Filter suggestions..."], ["src"]);
    const result = await runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: src/main.ts", value: "src/main.ts" }],
      enableFilter: true,
    });
    assert.deepStrictEqual(result, { kind: "filter", query: "src", paths: [] });
  });

  it("returns custom action with id and current paths", async () => {
    const ctx = makeFallbackCtx(["Add custom"], []);
    const result = await runListEditor(ctx, {
      title: "Test",
      items: [{ id: "r1", kind: "selected", label: "✅ Remove: b", value: "b" }],
      customActions: [{ id: "add", label: "Add custom" }],
    });
    assert.deepStrictEqual(result, { kind: "custom", id: "add", paths: ["b"] });
  });
});

describe("runListEditor custom TUI", () => {
  it("returns done with paths when Back is selected", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "r1", kind: "selected", label: "✅ Remove: b", value: "b" }],
    });
    const comp = getComponent() as { handleInput: (data: string) => void };
    // Move from the selected item down to Back, then confirm.
    comp.handleInput(DOWN);
    comp.handleInput(ENTER);
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "done", paths: ["b"] });
  });

  it("adds a suggestion without closing", async () => {
    const { ctx, getComponent, getDone } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
    });
    const comp = getComponent() as {
      handleInput: (data: string) => void;
      render: (width: number) => string[];
    };
    comp.handleInput(ENTER);

    const line = selectedLine(comp.render(80));
    assert.ok(line?.includes("✅ Remove: a"), `expected a to be selected after adding, got: ${line}`);

    getDone()({ kind: "back" });
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "back" });
  });

  it("preserves cursor position after removing an item", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [
        { id: "r1", kind: "selected", label: "✅ Remove: a", value: "a" },
        { id: "r2", kind: "selected", label: "✅ Remove: b", value: "b" },
        { id: "r3", kind: "selected", label: "✅ Remove: c", value: "c" },
      ],
    });
    const comp = getComponent() as {
      handleInput: (data: string) => void;
      render: (width: number) => string[];
    };
    // Move to "b" and remove it.
    comp.handleInput(DOWN);
    comp.handleInput(ENTER);

    const line = selectedLine(comp.render(80));
    assert.ok(line?.includes("c"), `expected cursor on c after removing b, got: ${line}`);

    // Remove c as well, then Back.
    comp.handleInput(ENTER);
    comp.handleInput(ENTER);

    const result = await promise;
    assert.deepStrictEqual(result, { kind: "done", paths: ["a"] });
  });
});
