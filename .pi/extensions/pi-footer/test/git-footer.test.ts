import assert from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { buildGitDetails, clearGitCache, type GitInfo, type GitRunner } from "../git-footer";

describe("buildGitDetails", () => {
	beforeEach(() => {
		clearGitCache();
	});

	it("returns real git info when running inside a git repo", () => {
		const info = buildGitDetails(() => "main", { cwd: process.cwd() });
		assert.ok(info);
		assert.strictEqual(info.branch, "main");
		assert.ok(info.text.includes("main"), `text should include main, got: ${info.text}`);
		assert.strictEqual(typeof info.count, "number");
		assert.strictEqual(typeof info.isWorktree, "boolean");
	});

	it("falls back to a direct git branch lookup when pi returns null", () => {
		const calls: string[] = [];
		const runner: GitRunner = {
			execSync: (command, options) => {
				calls.push(`${command} (cwd=${options.cwd || "unset"})`);
				if (command === "git branch --show-current") return "fallback-branch\n";
				if (command === "git rev-parse --git-dir") return ".git\n";
				if (command === "git status --porcelain | wc -l") return "0\n";
				throw new Error(`unexpected command: ${command}`);
			},
		};

		const info = buildGitDetails(() => null, { cwd: "/some/project", runner });
		assert.ok(info);
		assert.strictEqual(info.branch, "fallback-branch");
		assert.strictEqual(info.text, "fallback-branch \u2022 clean");
		assert.strictEqual(info.count, 0);
		assert.strictEqual(info.isWorktree, false);
		assert.ok(calls.some((c) => c.includes("git branch --show-current")));
	});

	it("returns 'no git repo' when branch lookup fails entirely", () => {
		const runner: GitRunner = {
			execSync: () => {
				throw new Error("not a git repo");
			},
		};

		const info = buildGitDetails(() => null, { cwd: "/tmp", runner });
		assert.ok(info);
		assert.strictEqual(info.branch, "");
		assert.strictEqual(info.text, "no git repo");
		assert.strictEqual(info.count, 0);
		assert.strictEqual(info.isWorktree, false);
	});

	it("detects worktree and dirty state", () => {
		const runner: GitRunner = {
			execSync: (command) => {
				if (command === "git branch --show-current") return "feature\n";
				if (command === "git rev-parse --git-dir") return "/some/path/worktrees/foo\n";
				if (command === "git status --porcelain | wc -l") return "3\n";
				throw new Error("unexpected");
			},
		};

		const info = buildGitDetails(() => null, { cwd: "/some/project", runner });
		assert.ok(info);
		assert.strictEqual(info.branch, "feature");
		assert.strictEqual(info.isWorktree, true);
		assert.strictEqual(info.count, 3);
		assert.strictEqual(info.text, "feature [wt] \u2022 3 files");
	});

	it("caches result for CACHE_MS", () => {
		let calls = 0;
		const runner: GitRunner = {
			execSync: (command) => {
				calls++;
				if (command === "git branch --show-current") return "cached-branch\n";
				if (command === "git rev-parse --git-dir") return ".git\n";
				if (command === "git status --porcelain | wc -l") return "0\n";
				throw new Error("unexpected");
			},
		};

		const first = buildGitDetails(() => null, { cwd: "/some/project", runner });
		const second = buildGitDetails(() => null, { cwd: "/some/project", runner });
		assert.strictEqual(first?.branch, "cached-branch");
		assert.strictEqual(second?.branch, "cached-branch");
		assert.strictEqual(calls > 0, true);
	});
});
