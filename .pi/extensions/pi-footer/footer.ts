/**
 * Consolidated footer renderer — builds the full 2-row footer.
 * Row 1: sunset directory (left) + Kimi usage (right)
 * Row 2: token stats (left) + model info (right)
 */
import type { Model, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { styledCwd } from "./sunset-dir";
import { getKimiData, isKimiModel, FILLED, EMPTY } from "./kimi-fetcher";
import { buildGitDetails } from "./git-footer";

/* ─── helpers ─── */
/**
 * Formats a token count into a human-readable string with k/M suffixes.
 * @param {number} count - Raw token count.
 * @returns {string} Formatted string like "1.5k" or "3M".
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/**
 * Calculates hours elapsed since a weekly reset timestamp.
 * @param {string | undefined} resetAt - ISO timestamp of the weekly reset.
 * @returns {number} Hours elapsed since reset (0 if invalid/future).
 */
function hoursElapsedSince(resetAt?: string): number {
	if (!resetAt) return 0;
	try {
		const resetMs = new Date(resetAt).getTime();
		const nowMs = Date.now();
		if (nowMs <= resetMs) return 0;
		return (nowMs - resetMs) / (1000 * 60 * 60);
	} catch {
		return 0;
	}
}

/**
 * Determines weekly bar color based on pace ratio (actual vs expected hourly usage).
 * @param {number} used - Weekly tokens used.
 * @param {number} limit - Weekly token limit.
 * @param {string | undefined} resetAt - Weekly reset ISO timestamp.
 * @returns {"success" | "warning" | "error"} Color key for theming.
 */
function weeklyPaceColor(used: number, limit: number, resetAt?: string): "success" | "warning" | "error" {
	if (limit <= 0) return "success";
	const actualPercent = (used / limit) * 100;
	const elapsedHours = hoursElapsedSince(resetAt);

	if (elapsedHours <= 0) {
		if (actualPercent >= 100) return "error";
		if (actualPercent >= 80) return "warning";
		return "success";
	}

	const expectedPercent = (elapsedHours / 168) * 100;
	if (expectedPercent <= 0) return "success";

	const paceRatio = (actualPercent / expectedPercent) * 100;
	if (paceRatio <= 79) return "success";
	if (paceRatio <= 99) return "warning";
	return "error";
}

/**
 * Determines a status color based on simple usage ratio.
 * @param {number} used - Amount used.
 * @param {number} limit - Total limit.
 * @returns {"success" | "warning" | "error"} Color key for theming.
 */
function usageColor(used: number, limit: number): "success" | "warning" | "error" {
	const p = limit > 0 ? used / limit : 0;
	if (p > 0.8) return "error";
	if (p > 0.5) return "warning";
	return "success";
}

/**
 * Calculates a percentage string from used and limit values.
 * @param {number} used - Amount used.
 * @param {number} limit - Total limit.
 * @returns {string} Percentage rounded to the nearest whole number, e.g. "42%".
 */
function pct(used: number, limit: number): string {
	if (limit <= 0) return "0%";
	return `${Math.round((used / limit) * 100)}%`;
}

/**
 * Builds a vertical block bar string representing usage percentage.
 * @param {number} used - Amount used.
 * @param {number} limit - Total limit.
 * @returns {string} A string of filled and empty block characters.
 */
function vbar(used: number, limit: number): string {
	const BAR_SEGMENTS = 10;
	const p = limit > 0 ? used / limit : 0;
	const filled = Math.min(BAR_SEGMENTS, Math.max(0, Math.ceil(p * BAR_SEGMENTS)));
	return FILLED.repeat(filled) + EMPTY.repeat(BAR_SEGMENTS - filled);
}

/**
 * Renders the colored Kimi usage status string for the footer right side.
 * @param {object} theme - Theme object with fg() color helper.
 * @returns {string | undefined} Styled status line, or undefined if no data.
 */
function buildKimiStatus(
	theme: { fg: (color: string, text: string) => string },
	model?: Model<any>,
): string | undefined {
	if (!isKimiModel(model)) return undefined;
	const data = getKimiData();
	if (!data) return undefined;

	const { wUsed, wLimit, wResetAt, hUsed, hLimit, hRemaining } = data;
	const wColor = weeklyPaceColor(wUsed, wLimit, wResetAt);
	const hColor = usageColor(hUsed, hLimit);
	/**
	 * Applies dim foreground color to text via the theme.
	 * @param {string} t - The text to dim.
	 * @returns {string} The dimmed text string.
	 */
	const dim = (t: string) => theme.fg("dim", t);

	const wRemaining = formatRemaining(wResetAt);
	const wBar = theme.fg(wColor, vbar(wUsed, wLimit));
	const wPct = theme.fg(wColor, pct(wUsed, wLimit));
	const hBar = theme.fg(hColor, vbar(hUsed, hLimit));
	const hPct = theme.fg(hColor, pct(hUsed, hLimit));

	return `${dim("Kimi ")}${wBar}${dim(" ")}${wPct}${dim("/")}${dim(wRemaining)}${dim("  5H:")}${hBar}${dim(" ")}${hPct}${dim("/")}${dim(hRemaining)}`;
}

/**
 * Formats the remaining time until a reset timestamp as "hours.minutes".
 * @param {string | undefined} resetAt - ISO timestamp string.
 * @returns {string} Formatted remaining time, or "?" if invalid.
 */
function formatRemaining(resetAt?: string): string {
	if (!resetAt) return "?";
	try {
		const dt = new Date(resetAt);
		const diffMs = dt.getTime() - Date.now();
		if (diffMs <= 0) return "0.00";
		const totalMinutes = Math.floor(diffMs / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return `${hours}.${String(minutes).padStart(2, "0")}`;
	} catch {
		return "?";
	}
}

/* ─── types ─── */
interface SessionManagerLike {
	getEntries(): Array<{
		type: string;
		message?: {
			role: string;
			usage?: {
				input?: number;
				output?: number;
				cacheRead?: number;
				cacheWrite?: number;
				cost?: { total?: number };
			};
		};
	}>;
}

interface FooterDataLike {
	getGitBranch(): string | null;
	getAvailableProviderCount(): number;
}

/* ─── main builder ─── */
/**
 * Builds the consolidated 2-row footer lines.
 * @param {number} width - Available terminal width.
 * @param {object} theme - TUI theme with fg() color helper.
 * @param {FooterDataLike} footerData - Pi footer data provider.
 * @param {SessionManagerLike} sessionManager - Session state reader.
 * @param {Model<any> | undefined} currentModel - Active model.
 * @param {ThinkingLevel | undefined} currentThinkingLevel - Active thinking level.
 * @param {boolean} usingSubscription - Whether OAuth/subscription pricing is active.
 * @param {object | undefined} contextUsage - Context usage data from PI.
 * @returns {string[]} Array of footer line strings.
 */
export function buildFooterLines(
	width: number,
	theme: { fg: (color: string, text: string) => string },
	footerData: FooterDataLike,
	sessionManager: SessionManagerLike,
	cwd: string,
	currentModel?: Model<any>,
	currentThinkingLevel?: ThinkingLevel,
	usingSubscription: boolean = false,
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null },
	showGitDetails: boolean = false,
	blinkPhase: boolean = false,
): string[] {
	const lines: string[] = [];

	/* --- row 1: sunset directory (left) + Kimi usage (right) --- */
	const left1 = styledCwd(cwd);
	const right1 = buildKimiStatus(theme, currentModel);

	if (right1) {
		const lW = visibleWidth(left1);
		const rW = visibleWidth(right1);
		if (lW + 2 + rW <= width) {
			lines.push(truncateToWidth(left1 + " ".repeat(width - lW - rW) + right1, width));
		} else {
			const avail = Math.max(0, width - 2 - rW);
			lines.push(truncateToWidth(truncateToWidth(left1, avail, theme.fg("dim", "...")) + " " + right1, width));
		}
	} else {
		lines.push(truncateToWidth(left1, width, theme.fg("dim", "...")));
	}

	/* --- row 2: token stats (left) + model info (right) --- */
	let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0, totalCost = 0;

	for (const entry of sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message?.role === "assistant") {
			const m = entry.message;
			totalInput += m.usage?.input ?? 0;
			totalOutput += m.usage?.output ?? 0;
			totalCacheRead += m.usage?.cacheRead ?? 0;
			totalCacheWrite += m.usage?.cacheWrite ?? 0;
			totalCost += m.usage?.cost?.total ?? 0;
		}
	}

	const parts: string[] = [];
	if (totalInput) parts.push(`↑${formatTokens(totalInput)}`);
	if (totalOutput) parts.push(`↓${formatTokens(totalOutput)}`);
	if (totalCacheRead) parts.push(`R${formatTokens(totalCacheRead)}`);
	if (totalCacheWrite) parts.push(`W${formatTokens(totalCacheWrite)}`);

	if (totalCost || usingSubscription) {
		parts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
	}

	const ctxWindow = contextUsage?.contextWindow ?? currentModel?.contextWindow ?? 0;
	const ctxPctVal = contextUsage?.percent ?? 0;
	const ctxPct = contextUsage?.percent !== null ? `${ctxPctVal.toFixed(1)}%` : "?";
	const ctxDisplay = `${ctxPct}/${formatTokens(ctxWindow)}`;

	if (ctxPctVal > 90) parts.push(theme.fg("error", ctxDisplay));
	else if (ctxPctVal > 70) parts.push(theme.fg("warning", ctxDisplay));
	else parts.push(ctxDisplay);

	let statsLeft = parts.join(" ");
	let statsLeftWidth = visibleWidth(statsLeft);
	if (statsLeftWidth > width) {
		statsLeft = truncateToWidth(statsLeft, width, "...");
		statsLeftWidth = visibleWidth(statsLeft);
	}

	const MODEL_DISPLAY_MAP: Record<string, string> = {
		// kimi
		"kimi-for-coding": "kimi-coding",
		"kimi-k1.5": "kimi-k1.5",
		"kimi-k1.6": "kimi-k1.6",
		"kimi-k2-thinking": "kimi-thinking",
		// codex
		"codex": "codex",
		"codex-latest": "codex",
		"codex-mini": "codex-mini",
		"codex-mini-latest": "codex-mini",
		// gpt
		"gpt-4o": "gpt-4o",
		"gpt-4o-latest": "gpt-4o",
		"gpt-4o-mini": "gpt-4o-mini",
		"gpt-4o-mini-latest": "gpt-4o-mini",
		"gpt-4.1": "gpt-4.1",
		"gpt-4.1-mini": "gpt-4.1-mini",
		"gpt-4.1-nano": "gpt-4.1-nano",
		// o-series
		"o1": "o1",
		"o1-mini": "o1-mini",
		"o3-mini": "o3-mini",
		"o3-mini-high": "o3-mini",
		"o4-mini": "o4-mini",
		"o4-mini-high": "o4-mini",
	};
	const rawModelName = currentModel?.id || "no-model";
	const modelName = MODEL_DISPLAY_MAP[rawModelName] || rawModelName;
	let right2 = modelName;
	if (currentModel?.reasoning) {
		const tl = currentThinkingLevel || "off";
		right2 = tl === "off" ? `${modelName} • thinking off` : `${modelName} • ${tl}`;
	}

	if (footerData.getAvailableProviderCount() > 1 && currentModel) {
		const provider = currentModel.provider || "";
		if (!provider.toLowerCase().includes("kimi")) {
			const withProvider = `(${provider}) ${right2}`;
			if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) {
				right2 = withProvider;
			}
		}
	}

	const right2Width = visibleWidth(right2);
	let statsLine: string;
	let leftStr = statsLeft;
	let rightStr = right2;
	let leftPad = "";
	let rightPad = "";

	/* --- row 2: token stats (left) + git details (center) + model info (right) --- */
	const gitDetails = showGitDetails ? buildGitDetails(() => footerData.getGitBranch(), { cwd }) : undefined;
	const gitPlain = gitDetails ? gitDetails.text : "";
	const gitW = gitPlain ? visibleWidth(gitPlain) : 0;

	if (gitDetails && statsLeftWidth + 1 + gitW + 1 + right2Width <= width) {
		const gitStart = Math.floor((width - gitW) / 2);
		const leftAvail = Math.max(0, gitStart - 1);
		const rightAvail = Math.max(0, width - gitStart - gitW - 1);

		if (statsLeftWidth > leftAvail) {
			leftStr = truncateToWidth(statsLeft, leftAvail, "");
		}
		if (right2Width > rightAvail) {
			rightStr = truncateToWidth(right2, rightAvail, "");
		}
		leftPad = " ".repeat(Math.max(0, gitStart - visibleWidth(leftStr)));
		rightPad = " ".repeat(Math.max(0, width - gitStart - gitW - visibleWidth(rightStr)));
		statsLine = leftStr + leftPad + gitPlain + rightPad + rightStr;
	} else {
		if (statsLeftWidth + 2 + right2Width <= width) {
			const pad = " ".repeat(width - statsLeftWidth - right2Width);
			statsLine = statsLeft + pad + right2;
		} else {
			const avail = width - statsLeftWidth - 2;
			if (avail > 0) {
				const truncated = truncateToWidth(right2, avail, "");
				const pad = " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(truncated)));
				statsLine = statsLeft + pad + truncated;
			} else {
				statsLine = statsLeft;
			}
		}
	}

	/* dim row 2; worktree cyan, git count bright red, everything else dimmed */
	if (gitDetails && !blinkPhase && (gitDetails.isWorktree || gitDetails.count > 0)) {
		let centerBright: string;

		if (gitDetails.isWorktree && gitDetails.count > 0) {
			// Both: worktree + dirty files
			centerBright =
				`\u001b[96m\u001b[1m${gitDetails.branch} [wt]\u001b[22m\u001b[39m` +
				theme.fg("dim", " \u2022 ") +
				`\u001b[91m\u001b[1m${gitDetails.count} files\u001b[22m\u001b[39m`;
		} else if (gitDetails.isWorktree) {
			// Worktree only (clean)
			centerBright =
				`\u001b[96m\u001b[1m${gitDetails.branch} [wt]\u001b[22m\u001b[39m` +
				theme.fg("dim", " \u2022 clean");
		} else {
			// Dirty files only (existing behavior, main tree)
			centerBright =
				theme.fg("dim", `${gitDetails.branch} \u2022 `) +
				`\u001b[91m\u001b[1m${gitDetails.count} files\u001b[22m\u001b[39m`;
		}

		lines.push(
			theme.fg("dim", leftStr + leftPad) +
			centerBright +
			theme.fg("dim", rightPad + rightStr),
		);
	} else {
		lines.push(theme.fg("dim", statsLine));
	}

	return lines;
}
