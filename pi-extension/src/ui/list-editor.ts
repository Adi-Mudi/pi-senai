import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  SelectList,
  Text,
  type SelectItem,
} from "@mariozechner/pi-tui";

export type ListEditorItemKind = "suggestion" | "selected" | "action";

export interface ListEditorItem {
  id: string;
  kind: ListEditorItemKind;
  label: string;
  description?: string;
  value: string;
}

export interface ListEditorCustomAction {
  id: string;
  label: string;
}

export interface ListEditorOptions {
  title: string;
  items: ListEditorItem[];
  filterQuery?: string;
  enableFilter?: boolean;
  customActions?: ListEditorCustomAction[];
  pageSize?: number;
  /** Force the simple ctx.ui.select fallback even in TUI mode. */
  forceFallback?: boolean;
}

export type ListEditorAction =
  | { kind: "done"; paths: string[] }
  | { kind: "back" }
  | { kind: "filter"; query: string; paths: string[] }
  | { kind: "custom"; id: string; paths: string[] };

const FILTER_ID = "__filter__";
const BACK_ID = "__back__";
const PAGE_PREV_ID = "__page-prev__";
const PAGE_NEXT_ID = "__page-next__";

function isTui(ctx: ExtensionContext): boolean {
  return (
    (ctx as unknown as { mode?: string }).mode === "tui" &&
    typeof ctx.ui.custom === "function" &&
    !ctx.ui.custom.toString().includes("[native code]")
  );
}

function matchesFilter(path: string, query: string): boolean {
  if (!query) return true;
  return path.toLowerCase().includes(query.toLowerCase());
}

/** Build the ordered item list shown by both renderers. */
function buildEditorItems(
  options: ListEditorOptions,
  currentPaths: string[],
  suggestions: string[],
): ListEditorItem[] {
  const items: ListEditorItem[] = [];
  const query = options.filterQuery ?? "";

  if (options.enableFilter) {
    items.push({
      id: FILTER_ID,
      kind: "action",
      label: query ? `Filter: ${query} (clear)` : "Filter suggestions...",
      value: FILTER_ID,
    });
  }

  for (const path of suggestions) {
    if (currentPaths.includes(path)) continue;
    if (matchesFilter(path, query)) {
      items.push({
        id: `suggest:${path}`,
        kind: "suggestion",
        label: `⬜ Suggest: ${path}`,
        value: path,
      });
    }
  }

  for (const action of options.customActions ?? []) {
    items.push({
      id: `custom:${action.id}`,
      kind: "action",
      label: action.label,
      value: action.id,
    });
  }

  for (const path of currentPaths) {
    items.push({
      id: `selected:${path}`,
      kind: "selected",
      label: `✅ Remove: ${path}`,
      value: path,
    });
  }

  items.push({
    id: BACK_ID,
    kind: "action",
    label: "Back",
    value: BACK_ID,
  });

  return items;
}

/** Pure state manager. Keeps selection stable when the item list changes. */
class ListEditorState {
  private items: ListEditorItem[];
  private selectedId: string;

  constructor(items: ListEditorItem[], selectedId?: string) {
    this.items = items;
    this.selectedId = selectedId ?? items[0]?.id ?? "";
  }

  getItems(): ListEditorItem[] {
    return this.items;
  }

  getSelectedIndex(): number {
    const idx = this.items.findIndex((i) => i.id === this.selectedId);
    return idx >= 0 ? idx : 0;
  }

  getSelectedItem(): ListEditorItem | undefined {
    return this.items[this.getSelectedIndex()];
  }

  move(delta: number): void {
    const idx = this.getSelectedIndex();
    const newIndex = (idx + delta + this.items.length) % this.items.length;
    this.selectedId = this.items[newIndex]?.id ?? "";
  }

  setSelectedId(id: string): void {
    if (this.items.some((i) => i.id === id)) {
      this.selectedId = id;
    }
  }

  updateItems(items: ListEditorItem[]): void {
    const oldIndex = this.getSelectedIndex();
    this.items = items;
    if (!this.items.some((i) => i.id === this.selectedId)) {
      const newIndex = Math.max(0, Math.min(oldIndex, this.items.length - 1));
      this.selectedId = this.items[newIndex]?.id ?? "";
    }
  }
}

export async function runListEditor(
  ctx: ExtensionContext,
  options: ListEditorOptions,
): Promise<ListEditorAction> {
  if (!options.forceFallback && isTui(ctx)) {
    return runCustomListEditor(ctx, options);
  }
  return runFallbackListEditor(ctx, options);
}

async function runFallbackListEditor(
  ctx: ExtensionContext,
  options: ListEditorOptions,
): Promise<ListEditorAction> {
  const pageSize = options.pageSize ?? 10;
  let currentPaths = options.items
    .filter((i) => i.kind === "selected")
    .map((i) => i.value);
  const allSuggestions = options.items
    .filter((i) => i.kind === "suggestion")
    .map((i) => i.value);
  let filterQuery = options.filterQuery ?? "";
  let page = 0;

  while (true) {
    const available = allSuggestions.filter(
      (s) => !currentPaths.includes(s) && matchesFilter(s, filterQuery),
    );
    const pageCount = Math.max(1, Math.ceil(available.length / pageSize));
    page = Math.max(0, Math.min(page, pageCount - 1));
    const start = page * pageSize;
    const pageSuggestions = available.slice(start, start + pageSize);

    const labels: string[] = [];
    const labelToId = new Map<string, string>();

    if (options.enableFilter) {
      const label = filterQuery
        ? `Filter: ${filterQuery} (clear)`
        : "Filter suggestions...";
      labels.push(label);
      labelToId.set(label, FILTER_ID);
    }

    for (const path of pageSuggestions) {
      const label = `⬜ Suggest: ${path}`;
      labels.push(label);
      labelToId.set(label, `suggest:${path}`);
    }

    if (pageCount > 1) {
      if (page > 0) {
        labels.push("← Previous page");
        labelToId.set("← Previous page", PAGE_PREV_ID);
      }
      if (page < pageCount - 1) {
        labels.push("Next page →");
        labelToId.set("Next page →", PAGE_NEXT_ID);
      }
    }

    for (const action of options.customActions ?? []) {
      labels.push(action.label);
      labelToId.set(action.label, `custom:${action.id}`);
    }

    for (const path of currentPaths) {
      const label = `✅ Remove: ${path}`;
      labels.push(label);
      labelToId.set(label, `selected:${path}`);
    }

    labels.push("Back");
    labelToId.set("Back", BACK_ID);

    const choice = await ctx.ui.select(options.title, labels);
    if (choice === undefined) {
      return { kind: "back" };
    }

    const id = labelToId.get(choice);
    if (!id) {
      return { kind: "back" };
    }

    if (id === FILTER_ID) {
      const input = await ctx.ui.input("Filter by name (empty clears):");
      const query = (input ?? "").trim().toLowerCase();
      return { kind: "filter", query, paths: currentPaths };
    }

    if (id === PAGE_PREV_ID) {
      page--;
      continue;
    }
    if (id === PAGE_NEXT_ID) {
      page++;
      continue;
    }

    if (id === BACK_ID) {
      return { kind: "done", paths: currentPaths };
    }

    if (id.startsWith("custom:")) {
      return {
        kind: "custom",
        id: id.replace("custom:", ""),
        paths: currentPaths,
      };
    }

    if (id.startsWith("suggest:")) {
      const path = id.replace("suggest:", "");
      if (!currentPaths.includes(path)) {
        currentPaths.push(path);
      }
      continue;
    }

    if (id.startsWith("selected:")) {
      const path = id.replace("selected:", "");
      currentPaths = currentPaths.filter((p) => p !== path);
      continue;
    }

    return { kind: "back" };
  }
}

async function runCustomListEditor(
  ctx: ExtensionContext,
  options: ListEditorOptions,
): Promise<ListEditorAction> {
  return ctx.ui.custom<ListEditorAction>((tui, theme, _keybindings, done) => {
    let currentPaths = options.items
      .filter((i) => i.kind === "selected")
      .map((i) => i.value);
    const allSuggestions = options.items
      .filter((i) => i.kind === "suggestion")
      .map((i) => i.value);

    const container = new Container();
    container.addChild(
      new DynamicBorder((s: string) => theme.fg("accent", s)),
    );
    container.addChild(
      new Text(theme.fg("accent", theme.bold(options.title)), 1, 0),
    );

    let state = new ListEditorState(
      buildEditorItems(options, currentPaths, allSuggestions),
    );

    const selectListTheme = {
      selectedPrefix: (t: string) => theme.fg("accent", t),
      selectedText: (t: string) => theme.fg("accent", t),
      description: (t: string) => theme.fg("muted", t),
      scrollInfo: (t: string) => theme.fg("dim", t),
      noMatch: (t: string) => theme.fg("warning", t),
    };

    let selectList = new SelectList(
      toSelectItems(state.getItems()),
      options.pageSize ?? 10,
      selectListTheme,
    );
    selectList.setSelectedIndex(state.getSelectedIndex());
    selectList.onSelectionChange = (item) => state.setSelectedId(item.value);
    container.addChild(selectList);

    container.addChild(
      new Text(
        theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
        1,
        0,
      ),
    );
    container.addChild(
      new DynamicBorder((s: string) => theme.fg("accent", s)),
    );

    function rebuild() {
      const items = buildEditorItems(options, currentPaths, allSuggestions);
      state.updateItems(items);
      const newList = new SelectList(
        toSelectItems(state.getItems()),
        options.pageSize ?? 10,
        selectListTheme,
      );
      newList.setSelectedIndex(state.getSelectedIndex());
      newList.onSelectionChange = (item) => state.setSelectedId(item.value);
      newList.onSelect = handleSelect;
      newList.onCancel = () => done({ kind: "back" });
      container.removeChild(selectList);
      container.addChild(newList);
      selectList = newList;
      tui.requestRender();
    }

    async function handleSelect(item: SelectItem) {
      const editorItem = state.getItems().find((i) => i.id === item.value);
      if (!editorItem) return;

      if (editorItem.id === BACK_ID) {
        done({ kind: "done", paths: currentPaths });
        return;
      }

      if (editorItem.id === FILTER_ID) {
        const input = await ctx.ui.input("Filter by name (empty clears):");
        const query = (input ?? "").trim().toLowerCase();
        done({ kind: "filter", query, paths: currentPaths });
        return;
      }

      if (editorItem.id.startsWith("custom:")) {
        done({
          kind: "custom",
          id: editorItem.value,
          paths: currentPaths,
        });
        return;
      }

      if (editorItem.kind === "suggestion") {
        if (!currentPaths.includes(editorItem.value)) {
          currentPaths.push(editorItem.value);
          rebuild();
        }
        return;
      }

      if (editorItem.kind === "selected") {
        currentPaths = currentPaths.filter((p) => p !== editorItem.value);
        rebuild();
        return;
      }
    }

    selectList.onSelect = handleSelect;
    selectList.onCancel = () => done({ kind: "back" });

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

function toSelectItems(items: ListEditorItem[]): SelectItem[] {
  return items.map((i) => ({
    value: i.id,
    label: i.label,
    description: i.description,
  }));
}
