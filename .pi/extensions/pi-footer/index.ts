/**
 * Pi Footer Extension — consolidated sunset directory + Kimi usage + token stats.
 *
 * Architecture:
 *   sunset-dir.ts    → styledCwd()       — magenta ›› orange ›› white folder
 *   kimi-fetcher.ts  → fetchKimiUsage()  — API fetch + cached data
 *   footer.ts        → buildFooterLines() — assembles the 2-row footer
 *   index.ts         → wires everything together via PI events
 *
 * Toggle: /footer
 */

import type { ExtensionAPI, Model, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import { fetchKimiUsage, isKimiModel, TOKEN } from "./kimi-fetcher";
import { buildFooterLines } from "./footer";

/* ─── state ─── */
let enabled = false;
let showGitDetails = true;
let blinkPhase = false;
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let currentModel: Model<any> | undefined;
let currentThinkingLevel: ThinkingLevel | undefined;
let requestRender: (() => void) | null = null;

/**
 * Starts a timer that toggles the blink phase every 500ms.
 * Calls requestRender to refresh the footer each toggle.
 * @returns {void}
 */
function startBlink() {
	if (blinkTimer) return;
	blinkTimer = setInterval(() => {
		blinkPhase = !blinkPhase;
		requestRender?.();
	}, 500);
}

/**
 * Stops the blink timer and resets the blink phase to false.
 * @returns {void}
 */
function stopBlink() {
	if (blinkTimer) {
		clearInterval(blinkTimer);
		blinkTimer = null;
		blinkPhase = false;
	}
}

/* ─── footer controller ─── */
/**
 * Attaches the consolidated footer renderer to PI's TUI.
 * @param {ExtensionAPI} pi - The PI extension API.
 * @param {object} ctx - Extension context with UI, session, and model access.
 */
function attachFooter(pi: ExtensionAPI, ctx: {
	hasUI: boolean;
	ui: {
		setFooter: (renderer: Parameters<ExtensionAPI["ui"]["setFooter"]>[0]) => void;
		notify: (msg: string, type: string) => void;
	};
	sessionManager: {
		getEntries(): Parameters<typeof buildFooterLines>[3]["getEntries"];
	};
	cwd: string;
	modelRegistry: { isUsingOAuth(model: Model<any>): boolean };
	getContextUsage: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
}) {
	if (!ctx.hasUI) return;

	ctx.ui.setFooter((tui, theme, footerData) => {
		requestRender = () => tui.requestRender();
		const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

		return {
			/**
			 * Cleans up branch change listener when footer is removed.
			 * @returns {void}
			 */
			dispose: unsubBranch,
			/**
			 * Forces a re-render of the footer.
			 * @returns {void}
			 */
			invalidate() {},
			render(width: number): string[] {
				return buildFooterLines(
					width,
					theme,
					footerData,
					ctx.sessionManager,
					ctx.cwd,
					currentModel,
					currentThinkingLevel,
					currentModel ? ctx.modelRegistry.isUsingOAuth(currentModel) : false,
					ctx.getContextUsage(),
					showGitDetails,
					blinkPhase,
				);
			},
		};
	});
}

/* ─── entry ─── */
export default function (pi: ExtensionAPI) {
	const intervals: ReturnType<typeof setInterval>[] = [];

	pi.on("session_shutdown", () => {
		intervals.forEach(clearInterval);
		intervals.length = 0;
	});

	/* skip entirely if no Kimi token (kimi-usage feature disabled) */
	if (!TOKEN) {
		console.warn("[pi-footer] No Kimi token found — Kimi usage disabled");
	}

	pi.registerCommand("footer", {
		description: "Toggle sunset gradient footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				attachFooter(pi, ctx);
				ctx.ui.notify("Sunset footer enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Default footer restored", "info");
			}
		},
	});

	pi.registerCommand("gitfooter", {
		description: "Toggle git branch/uncommitted details in footer",
		handler: async (_args, ctx) => {
			showGitDetails = !showGitDetails;
			if (showGitDetails) {
				startBlink();
			} else {
				stopBlink();
			}
			requestRender?.();
			ctx.ui.notify(showGitDetails ? "Git footer enabled" : "Git footer disabled", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		currentModel = ctx.model;
		currentThinkingLevel = pi.getThinkingLevel();

		if (!enabled && ctx.hasUI) {
			enabled = true;
			attachFooter(pi, ctx);
		}

		if (showGitDetails) {
			startBlink();
		}

		/* refresh Kimi data on start */
		if (TOKEN) {
			await fetchKimiUsage();
			requestRender?.();
		}

		/* poll Kimi usage every 30s */
		const interval = setInterval(async () => {
			if (!isKimiModel(currentModel)) return;
			await fetchKimiUsage();
			requestRender?.();
		}, 30000);
		intervals.push(interval);
	});

	pi.on("model_select", async (_event, ctx) => {
		currentModel = _event.model;
		currentThinkingLevel = pi.getThinkingLevel();
		if (!ctx.hasUI) return;
		await fetchKimiUsage();
		requestRender?.();
	});

	pi.on("thinking_level_select", async (_event, _ctx) => {
		currentThinkingLevel = _event.level;
		requestRender?.();
	});

	pi.on("turn_start", async (_event, _ctx) => {
		await fetchKimiUsage();
		requestRender?.();
	});
}
