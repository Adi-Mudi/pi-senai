/**
 * Git footer details — branch name + uncommitted file count.
 * Cached for 1s to avoid hammering git during TUI re-renders.
 */
import { execSync } from "node:child_process";

export interface GitInfo {
	branch: string;
	count: number;
	text: string;
	isWorktree: boolean;
}

export interface GitRunner {
	execSync(command: string, options: { cwd?: string; encoding: "utf-8"; stdio: ["pipe", "pipe", "ignore"]; timeout: number }): string;
}

let cached: { info: GitInfo; ts: number } | null = null;
const CACHE_MS = 1000;

const defaultRunner: GitRunner = {
	execSync: (command, options) => execSync(command, options).toString(),
};

/**
 * Resolves current git branch using pi's footer data or a direct git call.
 */
function resolveBranch(
	getBranch: () => string | null,
	cwd: string,
	runner: GitRunner,
): string | null {
	const piBranch = getBranch();
	if (piBranch) return piBranch;

	try {
		return runner
			.execSync("git branch --show-current", {
				cwd,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "ignore"],
				timeout: 500,
			})
			.trim();
	} catch {
		return null;
	}
}

/**
 * Checks if the current directory is inside a git worktree.
 */
function isInWorktree(cwd: string, runner: GitRunner): boolean {
	try {
		const out = runner.execSync("git rev-parse --git-dir", {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
			timeout: 500,
		});
		return out.trim().includes("worktrees");
	} catch {
		return false;
	}
}

/**
 * Runs git status and counts uncommitted files.
 */
function getUncommittedCount(cwd: string, runner: GitRunner): number {
	try {
		const out = runner.execSync("git status --porcelain | wc -l", {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
			timeout: 500,
		});
		return parseInt(out.trim(), 10) || 0;
	} catch {
		return 0;
	}
}

export interface BuildGitDetailsOptions {
	cwd?: string;
	runner?: GitRunner;
}

/**
 * Builds git details for the footer.
 * @param getBranch — footerData.getGitBranch() or another branch provider.
 * @param options — cwd and optional git runner for testing.
 * @returns Branch, uncommitted count, and display text.
 */
export function buildGitDetails(
	getBranch: () => string | null,
	options: BuildGitDetailsOptions = {},
): GitInfo | undefined {
	const now = Date.now();
	if (cached && now - cached.ts < CACHE_MS) {
		return cached.info;
	}

	const cwd = options.cwd || process.cwd();
	const runner = options.runner || defaultRunner;
	const branch = resolveBranch(getBranch, cwd, runner);

	if (!branch) {
		const info = { branch: "", count: 0, text: "no git repo", isWorktree: false };
		cached = { info, ts: now };
		return info;
	}

	const count = getUncommittedCount(cwd, runner);
	const isWorktree = isInWorktree(cwd, runner);
	const branchLabel = isWorktree ? `${branch} [wt]` : branch;
	const text = count > 0 ? `${branchLabel} \u2022 ${count} files` : `${branchLabel} \u2022 clean`;
	const info = { branch, count, text, isWorktree };
	cached = { info, ts: now };
	return info;
}

/**
 * Clears the cached git info. Exported for tests.
 */
export function clearGitCache(): void {
	cached = null;
}
