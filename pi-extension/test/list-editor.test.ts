import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExtensionContext, ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import { runListEditor, type ListEditorAction } from "../src/ui/list-editor.js";

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
  capturedSelectOptions?: string[][],
): ExtensionContext {
  let selectIndex = 0;
  let inputIndex = 0;
  return {
    cwd: "/tmp",
    ui: {
      select: async (_title: string, options: string[]) => {
        capturedSelectOptions?.push(options);
        return selects[selectIndex++];
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

  it("paginates suggestions and moves between pages", async () => {
    const captured: string[][] = [];
    const ctx = makeFallbackCtx(
      ["Next page →", "← Previous page", "Back"],
      [],
      captured,
    );
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      kind: "suggestion" as const,
      label: `⬜ Suggest: path${i}`,
      value: `path${i}`,
    }));
    const result = await runListEditor(ctx, { title: "Test", items, pageSize: 2 });

    // First page: no previous-page control, second-page labels absent.
    assert.ok(captured[0].includes("Next page →"));
    assert.ok(!captured[0].includes("← Previous page"));
    assert.ok(captured[0].includes("⬜ Suggest: path0"));
    assert.ok(!captured[0].includes("⬜ Suggest: path2"));
    // Second page: second-page labels shown, both page controls present.
    assert.ok(captured[1].includes("⬜ Suggest: path2"));
    assert.ok(captured[1].includes("⬜ Suggest: path3"));
    assert.ok(captured[1].includes("← Previous page"));
    assert.ok(captured[1].includes("Next page →"));
    // Previous page returns to the first page.
    assert.ok(captured[2].includes("⬜ Suggest: path0"));
    assert.ok(!captured[2].includes("← Previous page"));
    assert.deepStrictEqual(result, { kind: "done", paths: [] });
  });

  it("returns back when the select is cancelled", async () => {
    const ctx = makeFallbackCtx([undefined], []);
    const result = await runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
    });
    assert.deepStrictEqual(result, { kind: "back" });
  });

  it("hides non-matching suggestions when a filter query is preset", async () => {
    const captured: string[][] = [];
    const ctx = makeFallbackCtx(["Back"], [], captured);
    const result = await runListEditor(ctx, {
      title: "Test",
      items: [
        { id: "s1", kind: "suggestion", label: "⬜ Suggest: src/a.ts", value: "src/a.ts" },
        { id: "s2", kind: "suggestion", label: "⬜ Suggest: docs/b.md", value: "docs/b.md" },
      ],
      filterQuery: "src",
    });
    assert.ok(captured[0].includes("⬜ Suggest: src/a.ts"));
    assert.ok(!captured[0].includes("⬜ Suggest: docs/b.md"));
    assert.deepStrictEqual(result, { kind: "done", paths: [] });
  });

  it("clears the preset filter via the clear label and empty input", async () => {
    const ctx = makeFallbackCtx(["Filter: src (clear)"], [""]);
    const result = await runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: src/a.ts", value: "src/a.ts" }],
      enableFilter: true,
      filterQuery: "src",
    });
    assert.deepStrictEqual(result, { kind: "filter", query: "", paths: [] });
  });

  it("offers only Back when there are no suggestions or selected items", async () => {
    const captured: string[][] = [];
    const ctx = makeFallbackCtx(["Back"], [], captured);
    const result = await runListEditor(ctx, { title: "Test", items: [] });
    assert.deepStrictEqual(captured[0], ["Back"]);
    assert.deepStrictEqual(result, { kind: "done", paths: [] });
  });

  it("uses the fallback select path when forceFallback is true in TUI mode", async () => {
    let customCalled = false;
    const ctx = {
      cwd: "/tmp",
      mode: "tui",
      ui: {
        select: async () => "Back",
        input: async () => "",
        custom: async () => {
          customCalled = true;
          return { kind: "back" };
        },
      } as unknown as ExtensionUIContext,
    } as unknown as ExtensionContext;
    const result = await runListEditor(ctx, {
      title: "Test",
      items: [],
      forceFallback: true,
    });
    assert.strictEqual(customCalled, false);
    assert.deepStrictEqual(result, { kind: "done", paths: [] });
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
    // The top action bar starts focused on Back; just confirm it.
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
    // Move focus from the action bar into the content list, then add the suggestion.
    comp.handleInput(DOWN);
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
    // Move from the action bar into the content list, then down to "b" and remove it.
    comp.handleInput(DOWN);
    comp.handleInput(DOWN);
    comp.handleInput(ENTER);

    const line = selectedLine(comp.render(80));
    assert.ok(line?.includes("c"), `expected cursor on c after removing b, got: ${line}`);

    // Remove c as well, then move back up to Back and finish.
    comp.handleInput(ENTER);
    comp.handleInput(UP);
    comp.handleInput(ENTER);

    const result = await promise;
    assert.deepStrictEqual(result, { kind: "done", paths: ["a"] });
  });

  it("keeps action bar visible while scrolling a long list", async () => {
    const { ctx, getComponent, getDone } = makeTuiCtx();
    const items = Array.from({ length: 15 }, (_, i) => ({
      id: `s${i}`,
      kind: "suggestion" as const,
      label: `⬜ Suggest: path${i}`,
      value: `path${i}`,
    }));
    const promise = runListEditor(ctx, {
      title: "Test",
      items,
      pageSize: 5,
    });
    const comp = getComponent() as {
      handleInput: (data: string) => void;
      render: (width: number) => string[];
    };

    // Move into the list and scroll down well past the visible window.
    comp.handleInput(DOWN);
    for (let i = 0; i < 12; i++) {
      comp.handleInput(DOWN);
    }

    const lines = comp.render(80);
    assert.ok(
      lines.some((line) => line.includes("Back")),
      `expected action bar to stay visible, got:\n${lines.join("\n")}`,
    );

    getDone()({ kind: "back" });
    await promise;
  });

  it("triggers Filter from the top action bar", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
      enableFilter: true,
    });
    const comp = getComponent() as { handleInput: (data: string) => void };
    // Focus starts on Back; move down to Filter and confirm.
    comp.handleInput(DOWN);
    comp.handleInput(ENTER);

    const result = await promise;
    assert.deepStrictEqual(result, { kind: "filter", query: "", paths: [] });
  });

  it("triggers Add custom path from the top action bar", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
      enableFilter: true,
      customActions: [{ id: "add-custom", label: "Add custom path" }],
    });
    const comp = getComponent() as { handleInput: (data: string) => void };
    // Focus starts on Back; move down past Filter to Add custom path and confirm.
    comp.handleInput(DOWN);
    comp.handleInput(DOWN);
    comp.handleInput(ENTER);

    const result = await promise;
    assert.deepStrictEqual(result, { kind: "custom", id: "add-custom", paths: [] });
  });

  it("returns back on escape", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
    });
    const comp = getComponent() as { handleInput: (data: string) => void };
    comp.handleInput("\x1b");
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "back" });
  });

  it("renders a placeholder when there is no content", async () => {
    const { ctx, getComponent, getDone } = makeTuiCtx();
    const promise = runListEditor(ctx, { title: "Test", items: [] });
    const comp = getComponent() as { render: (width: number) => string[] };
    const lines = comp.render(80);
    assert.ok(
      lines.some((line) => line.includes("(no items)")),
      `expected a (no items) placeholder, got:\n${lines.join("\n")}`,
    );
    getDone()({ kind: "back" });
    await promise;
  });

  it("moves focus to the bottom of the content list on UP from the first action row", async () => {
    const { ctx, getComponent, getDone } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [
        { id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" },
        { id: "s2", kind: "suggestion", label: "⬜ Suggest: b", value: "b" },
        { id: "s3", kind: "suggestion", label: "⬜ Suggest: c", value: "c" },
      ],
    });
    const comp = getComponent() as {
      handleInput: (data: string) => void;
      render: (width: number) => string[];
    };
    comp.handleInput(UP);
    const line = selectedLine(comp.render(80));
    assert.ok(line?.includes("c"), `expected focus on last content item c, got: ${line}`);
    getDone()({ kind: "back" });
    await promise;
  });

  it("returns focus to the action bar on DOWN past the last content item", async () => {
    const { ctx, getComponent, getDone } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
    });
    const comp = getComponent() as {
      handleInput: (data: string) => void;
      render: (width: number) => string[];
    };
    // Into the content list, then past its single item.
    comp.handleInput(DOWN);
    comp.handleInput(DOWN);
    const lines = comp.render(80);
    assert.ok(
      lines.some((line) => line.includes("→ Back")),
      `expected focus back on the Back action, got:\n${lines.join("\n")}`,
    );
    getDone()({ kind: "back" });
    await promise;
  });

  it("clamps the cursor and shows the placeholder after removing the last item", async () => {
    const { ctx, getComponent, getDone } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "r1", kind: "selected", label: "✅ Remove: a", value: "a" }],
    });
    const comp = getComponent() as {
      handleInput: (data: string) => void;
      render: (width: number) => string[];
    };
    // Move into the content list and remove the only item.
    comp.handleInput(DOWN);
    comp.handleInput(ENTER);
    const lines = comp.render(80);
    assert.ok(
      lines.some((line) => line.includes("(no items)")),
      `expected a (no items) placeholder, got:\n${lines.join("\n")}`,
    );
    getDone()({ kind: "back" });
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "back" });
  });

  it("keeps a suggestion only once after it is added", async () => {
    const { ctx, getComponent } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
    });
    const comp = getComponent() as {
      handleInput: (data: string) => void;
      render: (width: number) => string[];
    };
    // Add the suggestion, then it is no longer offered in the content list.
    comp.handleInput(DOWN);
    comp.handleInput(ENTER);
    const lines = comp.render(80);
    assert.ok(!lines.some((line) => line.includes("⬜ Suggest: a")));
    // Back out: UP returns to the action bar, ENTER on Back finishes.
    comp.handleInput(UP);
    comp.handleInput(ENTER);
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "done", paths: ["a"] });
  });

  it("shows the preset filter query in the action bar", async () => {
    const { ctx, getComponent, getDone } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: src/a", value: "src/a" }],
      enableFilter: true,
      filterQuery: "src",
    });
    const comp = getComponent() as { render: (width: number) => string[] };
    const lines = comp.render(80);
    assert.ok(
      lines.some((line) => line.includes("Filter: src (clear)")),
      `expected the action bar to show the preset filter, got:\n${lines.join("\n")}`,
    );
    getDone()({ kind: "back" });
    await promise;
  });

  it("ignores an unrecognized key and keeps rendering", async () => {
    const { ctx, getComponent, getDone } = makeTuiCtx();
    const promise = runListEditor(ctx, {
      title: "Test",
      items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
    });
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });
    const comp = getComponent() as {
      handleInput: (data: string) => void;
      render: (width: number) => string[];
    };
    comp.handleInput("x");
    const lines = comp.render(80);
    assert.ok(lines.length > 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(resolved, false);
    getDone()({ kind: "back" });
    const result = await promise;
    assert.deepStrictEqual(result, { kind: "back" });
  });
});
