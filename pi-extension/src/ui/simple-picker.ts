import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey } from "@mariozechner/pi-tui";

export interface SimplePickerItem {
  id: string;
  label: string;
  /** Extra context shown dim after the label (custom TUI only). */
  hint?: string;
}

export interface SimplePickerOptions {
  title: string;
  subtitle?: string;
  items: SimplePickerItem[];
  pageSize?: number;
  initialSelectedId?: string;
}

function isTui(ctx: ExtensionContext): boolean {
  return (
    (ctx as unknown as { mode?: string }).mode === "tui" &&
    typeof ctx.ui.custom === "function" &&
    !ctx.ui.custom.toString().includes("[native code]")
  );
}

/** Single-choice picker with the same visual language as the role picker
 *  and list editor (border, title, → cursor, dim footer).
 *  Fallback keeps Pi's built-in select with the exact item labels.
 *  Returns the picked item id, or undefined on cancel. */
export async function runSimplePicker(
  ctx: ExtensionContext,
  options: SimplePickerOptions,
): Promise<string | undefined> {
  if (!isTui(ctx)) {
    const labels = options.items.map((i) => i.label);
    const choice = await ctx.ui.select(options.title, labels);
    if (!choice) return undefined;
    return options.items[labels.indexOf(choice)]?.id;
  }
  return runCustomSimplePicker(ctx, options);
}

/** Yes/no gate in the same visual language. Fallback delegates to
 *  ctx.ui.confirm so non-TUI behavior (and its tests) is unchanged. */
export async function runSimpleConfirm(
  ctx: ExtensionContext,
  title: string,
  message: string,
): Promise<boolean> {
  if (!isTui(ctx)) {
    return ctx.ui.confirm(title, message);
  }
  const picked = await runCustomSimplePicker(ctx, {
    title,
    subtitle: ` ${message}`,
    items: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ],
  });
  return picked === "yes";
}

async function runCustomSimplePicker(
  ctx: ExtensionContext,
  options: SimplePickerOptions,
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const pageSize = options.pageSize ?? 15;
    const items = options.items;
    let selectedIndex = Math.max(
      0,
      options.initialSelectedId
        ? items.findIndex((i) => i.id === options.initialSelectedId)
        : 0,
    );
    let scrollOffset = 0;

    function ensureVisible() {
      if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
      else if (selectedIndex >= scrollOffset + pageSize) {
        scrollOffset = selectedIndex - pageSize + 1;
      }
    }

    function render(width: number): string[] {
      const lines: string[] = [];
      const border = "─".repeat(Math.max(2, width));
      lines.push(theme.fg("accent", border));
      lines.push(theme.fg("accent", theme.bold(` ${options.title}`)));
      if (options.subtitle) {
        lines.push(theme.fg("dim", options.subtitle));
      }
      lines.push(theme.fg("accent", border));

      ensureVisible();
      const visible = items.slice(scrollOffset, scrollOffset + pageSize);
      for (let i = 0; i < visible.length; i++) {
        const item = visible[i];
        const focused = scrollOffset + i === selectedIndex;
        const prefix = focused ? "→ " : "  ";
        const hintPart = item.hint ? ` ${theme.fg("dim", item.hint)}` : "";
        const base = `${item.label}${hintPart}`;
        lines.push(
          focused
            ? `${prefix}${theme.fg("accent", theme.bold(base))}`
            : `${prefix}${theme.fg("text", base)}`,
        );
      }
      if (items.length > pageSize) {
        lines.push(
          theme.fg(
            "dim",
            `  (${scrollOffset + 1}-${Math.min(scrollOffset + pageSize, items.length)}/${items.length})`,
          ),
        );
      }

      lines.push(theme.fg("accent", border));
      lines.push(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"));
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
          done(undefined);
          return;
        }
        if (matchesKey(data, Key.enter)) {
          done(items[selectedIndex]?.id);
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
