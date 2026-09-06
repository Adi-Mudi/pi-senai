import type { ResearchSource } from "./community-research.js";

/**
 * Real ResearchFetcher plan for the community-research scout.
 *
 * The actual tool calls are made by the parent LLM (which holds the
 * WebSearch + FetchURL tools). This module composes the structured prompts
 * the parent should issue, biased per source to push toward trusted URLs.
 *
 * Usage flow:
 *   1. The parent reads the source picker output (from the discussion skill).
 *   2. Parent calls `createWebFetcherPlan(source)` to get the prompt templates.
 *   3. Parent issues `WebSearch(searchPrompt(query))` and pipes candidate URLs
 *      back through `scoreEntry` or directly into the scout's `ResearchFetcher`.
 *   4. For each candidate URL, parent issues `FetchURL(fetchPrompt(url))` to
 *      confirm the page renders the topic content.
 *   5. Parent assembles the `ResearchSourceEntry[]` and hands the structured
 *      result back to `runCommunityResearch()` via the `ResearchFetcher` seam.
 *
 * This module is the structured-research bridge between the discussion flow
 * and the parent LLM's web tools. It does NOT spawn a sub-agent — the
 * discussion sub-agent (when invoked) has the same tools and the same plan.
 */

export interface WebFetcherPlan {
	/** Prompt the parent should send when calling `WebSearch` for the given source. */
	searchPrompt: (query: string) => string;
	/** Prompt the parent should send when calling `FetchURL` for a candidate URL. */
	fetchPrompt: (url: string) => string;
	/** Human-readable label for the source (used in UI / log lines). */
	label: string;
}

/**
 * Per-source domain bias. Empty string for `web` means no bias; the parent
 * uses its default WebSearch ranking.
 */
const DOMAIN_BIAS: Record<ResearchSource, string> = {
	web: "",
	official: " Prefer developers.google.com, .gov, .edu, RFC/IEEE/W3C/ISO, and the official documentation site of the library or tool.",
	community: " Prefer Stack Overflow accepted answers (≥10 votes), GitHub issues on the official repository, and recognized community forums.",
	similar: " Prefer open-source Apps Script / Node / Python projects on GitHub with active maintenance, and reference architectures that match the project's stack.",
};

const SOURCE_LABEL: Record<ResearchSource, string> = {
	web: "Web (general)",
	official: "Official documentation",
	community: "Community (forums / Stack Overflow / GitHub)",
	similar: "Similar projects",
};

/**
 * Build the source-specific prompt templates the parent should use when
 * invoking `WebSearch` and `FetchURL`. The returned object is pure data —
 * no tool calls happen here.
 */
export function createWebFetcherPlan(source: ResearchSource): WebFetcherPlan {
	return {
		searchPrompt: (query: string) => {
			const trimmed = query.trim();
			const bias = DOMAIN_BIAS[source];
			return (
				`WebSearch("${trimmed}").` +
				(bias ? ` ${bias}` : "") +
				` Return up to 10 candidate URLs as a JSON array.`
			);
		},
		fetchPrompt: (url: string) =>
			`FetchURL("${url}"). Return the page title, the HTTP status code, and the first 300 chars of body text. If the page is JS-rendered and empty, say so explicitly.`,
		label: SOURCE_LABEL[source],
	};
}

/**
 * All four source keys in their canonical order. Useful when the discussion
 * handler needs to enumerate them (e.g. for the source picker).
 */
export const RESEARCH_SOURCES = ["web", "official", "community", "similar"] as const satisfies readonly ResearchSource[];

/**
 * Human-readable source picker options. The discussion handler embeds these
 * verbatim in the AskUserQuestion call.
 */
export const SOURCE_PICKER_OPTIONS: ReadonlyArray<{ label: string; description: string }> = [
	{ label: "Web search (general)?", description: "Broad web search with no domain bias — good for general exploration." },
	{ label: "Official documentation?", description: "Prefer developers.google.com, .gov, .edu, RFC/IEEE/W3C/ISO." },
	{ label: "Community (forums / Stack Overflow / GitHub)?", description: "Prefer Stack Overflow accepted answers, GitHub issues, recognized forums." },
	{ label: "Similar projects?", description: "Prefer open-source projects with active maintenance, reference architectures." },
];
