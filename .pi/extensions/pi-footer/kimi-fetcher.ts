/**
 * Kimi API usage fetcher — keeps cached data and exposes current values.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-coding-agent";

/* ─── config ─── */
export const FILLED = "▮";
export const EMPTY = "▯";

/* ─── types ─── */
interface KimiUsageResponse {
	usage?: {
		used?: number | string;
		remaining?: number | string;
		limit?: number | string;
		reset_at?: string;
		resetAt?: string;
		reset_time?: string;
		resetTime?: string;
	};
	limits?: Array<{
		window?: {
			duration?: number | string;
			timeUnit?: string;
		};
		detail?: {
			used?: number | string;
			remaining?: number | string;
			limit?: number | string;
			reset_at?: string;
			resetAt?: string;
			reset_time?: string;
			resetTime?: string;
		};
	}>;
}

export interface KimiData {
	wUsed: number;
	wLimit: number;
	wResetAt: string | undefined;
	hUsed: number;
	hLimit: number;
	hRemaining: string;
}

/* ─── token loader ─── */
/**
 * Retrieves the Kimi API token from auth.json or environment variables.
 * @returns {string | null} The Kimi API key, or null if not found.
 */
function getKimiToken(): string | null {
	try {
		const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
		const authPath = join(agentDir, "auth.json");
		const raw = readFileSync(authPath, "utf-8");
		const auth = JSON.parse(raw);
		return auth["kimi-coding"]?.key || auth["kimi"]?.key || null;
	} catch {
		return process.env.KIMI_API_KEY || process.env.KIMI_AUTH_TOKEN || null;
	}
}

export const TOKEN = getKimiToken();

/* ─── state ─── */
let currentData: KimiData | null = null;

export function getKimiData(): KimiData | null {
	return currentData;
}

/* ─── helpers ─── */
/**
 * Extracts the reset timestamp from a usage data object.
 * @param {Record<string, unknown>} data - Usage response data.
 * @returns {string | undefined} The reset timestamp string, or undefined.
 */
function getResetAt(data: Record<string, unknown>): string | undefined {
	const keys = ["reset_at", "resetAt", "reset_time", "resetTime"];
	for (const key of keys) {
		const val = data[key];
		if (typeof val === "string") return val;
	}
	return undefined;
}

/**
 * Formats the remaining time until a reset timestamp as "hours.minutes".
 * @param {string} [resetAt] - ISO timestamp string.
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

export function isKimiModel(model?: Model<any>): boolean {
	return model?.id?.toLowerCase().includes("kimi") ?? false;
}

/* ─── API ─── */
export async function fetchKimiUsage(): Promise<void> {
	if (!TOKEN) return;
	try {
		const res = await fetch("https://api.kimi.com/coding/v1/usages", {
			headers: { Authorization: `Bearer ${TOKEN}` },
		});
		if (!res.ok) return;
		const data = (await res.json()) as KimiUsageResponse;
		if (!data?.usage) return;

		const wUsed = Number(data.usage.used || 0);
		const wLimit = Number(data.usage.limit || 1);
		const wResetAt = getResetAt(data.usage as Record<string, unknown>);

		const window = data.limits?.[0];
		const hUsed = Number(window?.detail?.used || 0);
		const hLimit = Number(window?.detail?.limit || 1);
		const hRemaining = formatRemaining(getResetAt(window?.detail as Record<string, unknown>));

		currentData = { wUsed, wLimit, wResetAt, hUsed, hLimit, hRemaining };
	} catch {
		currentData = null;
	}
}
