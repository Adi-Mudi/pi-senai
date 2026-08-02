import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey } from "@mariozechner/pi-tui";

export interface RolePickerItem {
  id: string;
  label: string;
  agent: string;
  summary: string;
  assigned: boolean;
}

export interface RolePickerOptions {
  title: string;
  items: RolePickerItem[];
  pageSize?: number;
  subtitle?: string;
  initialSelectedId?: string;
}

export type RolePickerResult =
  | { kind: "role"; role: string }
  | { kind: "finish" }
  | { kind: "back" };

function isTui(ctx: ExtensionContext): boolean {
  return (
    (ctx as unknown as { mode?: string }).mode === "tui" &&
    typeof ctx.ui.custom === "function" &&
    !ctx.ui.custom.toString().includes("[native code]")
  );
}

export async function runRolePicker(
  ctx: ExtensionContext,
  options: RolePickerOptions,
): Promise<RolePickerResult> {
  if (!isTui(ctx)) {
    return runFallbackRolePicker(ctx, options);
  }
  return runCustomRolePicker(ctx, options);
}

const FINISH_ID = "__finish__";

function makeFallbackOptions(
  items: RolePickerItem[],
): { options: string[]; idMap: Map<string, string> } {
  const options: string[] = [];
  const idMap = new Map<string, string>();
  for (const item of items) {
    const marker = item.assigned ? "✅" : "⬜";
    const agentPart = item.agent ? ` (${item.agent})` : "";
    const label = `${marker} ${item.id}: ${item.label}${agentPart} — ${item.summary}`;
    options.push(label);
    idMap.set(label, item.id);
  }
  const finishLabel = "⬜ Finish";
  options.push(finishLabel);
  idMap.set(finishLabel, FINISH_ID);
  return { options, idMap };
}

async function runFallbackRolePicker(
  ctx: ExtensionContext,
  options: RolePickerOptions,
): Promise<RolePickerResult> {
  const { options: labels, idMap } = makeFallbackOptions(options.items);
  const choice = await ctx.ui.select(options.title, labels);
  if (!choice) return { kind: "back" };
  const id = idMap.get(choice);
  if (!id || id === FINISH_ID) return { kind: "finish" };
  return { kind: "role", role: id };
}

async function runCustomRolePicker(
  ctx: ExtensionContext,
  options: RolePickerOptions,
): Promise<RolePickerResult> {
  return ctx.ui.custom<RolePickerResult>((tui, theme, _keybindings, done) => {
    const pageSize = options.pageSize ?? 15;
    const items = [...options.items];
    items.push({
      id: FINISH_ID,
      label: "Finish",
      agent: "",
      summary: "",
      assigned: false,
    });

    let selectedIndex = Math.max(
      0,
      options.initialSelectedId
        ? items.findIndex((i) => i.id === options.initialSelectedId)
        : 0,
    );
    let scrollOffset = 0;

    function ensureVisible() {
      if (selectedIndex < scrollOffset) {
        scrollOffset = selectedIndex;
      } else if (selectedIndex >= scrollOffset + pageSize) {
        scrollOffset = selectedIndex - pageSize + 1;
      }
    }

    function renderRow(item: RolePickerItem, focused: boolean): string {
      const prefix = focused ? "→ " : "  ";
      const agentPart = item.agent ? ` (${item.agent})` : "";
      const base = `${item.label}${agentPart} — ${item.summary}`;
      if (item.id === FINISH_ID) {
        return `${prefix}${theme.fg("text", "Finish")}`;
      }
      if (focused) {
        return `${prefix}${theme.fg("accent", theme.bold(base))}`;
      }
      if (item.assigned) {
        return `${prefix}${theme.fg("accent", base)}`;
      }
      return `${prefix}${theme.fg("dim", base)}`;
    }

    function render(width: number): string[] {
      const lines: string[] = [];
      const border = "─".repeat(Math.max(2, width));
      lines.push(theme.fg("accent", border));
      lines.push(theme.fg("accent", theme.bold(` ${options.title}`)));
      const subtitle = options.subtitle ?? " Only roles that read project documents are shown; other roles use stage artifacts.";
      lines.push(theme.fg("warning", subtitle));
      lines.push(theme.fg("accent", border));

      const visible = items.slice(scrollOffset, scrollOffset + pageSize);
      for (let i = 0; i < visible.length; i++) {
        const item = visible[i];
        const focused = scrollOffset + i === selectedIndex;
        lines.push(renderRow(item, focused));
      }

      lines.push(theme.fg("accent", border));
      lines.push(
        theme.fg(
          "dim",
          "↑↓ navigate • enter select • esc cancel",
        ),
      );
      lines.push(theme.fg("accent", border));
      return lines;
    }

    function move(delta: number) {
      selectedIndex = (selectedIndex + delta + items.length) % items.length;
      ensureVisible();
      tui.requestRender();
    }

    ensureVisible();

    return {
      render,
      invalidate: () => {},
      handleInput: (data: string) => {
        if (matchesKey(data, Key.escape)) {
          done({ kind: "back" });
          return;
        }
        if (matchesKey(data, Key.enter)) {
          const item = items[selectedIndex];
          if (item.id === FINISH_ID) {
            done({ kind: "finish" });
          } else {
            done({ kind: "role", role: item.id });
          }
          return;
        }
        if (matchesKey(data, Key.up)) {
          move(-1);
          return;
        }
        if (matchesKey(data, Key.down)) {
          move(1);
          return;
        }
      },
    };
  });
}
