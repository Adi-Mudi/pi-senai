import { describe, it } from "node:test";
import assert from "node:assert";
import {
	createWebFetcherPlan,
	SOURCE_PICKER_OPTIONS,
	RESEARCH_SOURCES,
} from "../../src/scouts/web-fetcher.js";
import type { ResearchSource } from "../../src/scouts/community-research.js";

describe("web-fetcher plan", () => {
	it("produces a non-empty plan for every source key", () => {
		for (const source of RESEARCH_SOURCES) {
			const plan = createWebFetcherPlan(source as ResearchSource);
			assert.ok(plan, `plan must exist for source "${source}"`);
			assert.ok(plan.searchPrompt.length > 0, `${source}.searchPrompt must be a function`);
			assert.ok(plan.fetchPrompt.length > 0, `${source}.fetchPrompt must be a function`);
			assert.match(plan.label, /\w/, `${source}.label must be non-empty`);
		}
	});

	it("embeds the user query in the search prompt verbatim", () => {
		const plan = createWebFetcherPlan("web");
		const prompt = plan.searchPrompt("Apps Script 6-minute execution limit");
		assert.match(prompt, /Apps Script 6-minute execution limit/);
		assert.match(prompt, /WebSearch\(/);
	});

	it("embeds the URL in the fetch prompt verbatim", () => {
		const plan = createWebFetcherPlan("official");
		const prompt = plan.fetchPrompt("https://developers.google.com/apps-script/guides/services/quotas");
		assert.match(prompt, /https:\/\/developers\.google\.com\/apps-script\/guides\/services\/quotas/);
		assert.match(prompt, /FetchURL\(/);
		assert.match(prompt, /title/);
		assert.match(prompt, /HTTP status/);
	});

	it("applies the source-specific domain bias", () => {
		// web has no bias — prompt must NOT contain a domain hint.
		const webPrompt = createWebFetcherPlan("web").searchPrompt("foo");
		assert.ok(!/Prefer /.test(webPrompt), "web plan must not add a domain bias");

		// official biases toward .gov / .edu / RFC / W3C / official docs.
		const officialPrompt = createWebFetcherPlan("official").searchPrompt("foo");
		assert.match(officialPrompt, /\.gov/);
		assert.match(officialPrompt, /\.edu/);
		assert.match(officialPrompt, /RFC\/IEEE\/W3C\/ISO/);

		// community biases toward Stack Overflow + GitHub.
		const communityPrompt = createWebFetcherPlan("community").searchPrompt("foo");
		assert.match(communityPrompt, /Stack Overflow/);
		assert.match(communityPrompt, /GitHub/);

		// similar biases toward open-source projects.
		const similarPrompt = createWebFetcherPlan("similar").searchPrompt("foo");
		assert.match(similarPrompt, /open-source/);
	});

	it("trims whitespace in the search prompt query", () => {
		const plan = createWebFetcherPlan("web");
		const prompt = plan.searchPrompt("  hello world  ");
		assert.match(prompt, /hello world/);
		assert.ok(!/^\s*hello/.test(prompt), "leading whitespace must be stripped");
	});

	it("SOURCE_PICKER_OPTIONS has exactly 4 entries (one per source) and ends with `?`", () => {
		assert.strictEqual(SOURCE_PICKER_OPTIONS.length, 4);
		for (const opt of SOURCE_PICKER_OPTIONS) {
			assert.match(opt.label, /\?$/, `option label "${opt.label}" must end with ?`);
			assert.ok(opt.description.length > 0, "description must be non-empty");
		}
	});

	it("SOURCE_PICKER_OPTIONS labels are unique", () => {
		const labels = SOURCE_PICKER_OPTIONS.map((o) => o.label);
		assert.strictEqual(new Set(labels).size, labels.length, "all labels must be distinct");
	});

	it("RESEARCH_SOURCES has all 4 keys in canonical order", () => {
		assert.deepStrictEqual(
			[...RESEARCH_SOURCES],
			["web", "official", "community", "similar"],
		);
	});
});
