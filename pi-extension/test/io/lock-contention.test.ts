import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lockInfo } from "../../src/io/lock.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD_PATH = path.join(HERE, "..", "helpers", "lock-child.js");

interface ChildResult {
	ok: boolean;
	pid?: number;
	reason?: string;
	released?: boolean;
	holder?: unknown;
}

function runChild(args: string[]): Promise<{ code: number | null; result: ChildResult | null }> {
	return new Promise((resolve, reject) => {
		const child: ChildProcess = spawn(process.execPath, [CHILD_PATH, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", reject);
		child.on("close", (code) => {
			const line = stdout.trim().split("\n").at(-1) ?? "";
			let parsed: ChildResult | null = null;
			try {
				parsed = JSON.parse(line) as ChildResult;
			} catch {
				parsed = null;
			}
			if (!parsed && stderr) {
				reject(new Error(`child failed (code=${code}): ${stderr}`));
				return;
			}
			resolve({ code, result: parsed });
		});
	});
}

function killChild(child: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		child.once("close", () => resolve());
		child.kill("SIGKILL");
	});
}

function acquireChild(args: string[]): Promise<{ child: ChildProcess; pid: number }> {
	return new Promise((resolve, reject) => {
		const child: ChildProcess = spawn(process.execPath, [CHILD_PATH, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			// Resolve as soon as we see the first JSON line.
			if (!stdout.includes("\n")) return;
			const line = stdout.trim().split("\n").at(-1) ?? "";
			try {
				const parsed = JSON.parse(line) as ChildResult;
				if (parsed.ok && parsed.pid) {
					resolve({ child, pid: parsed.pid });
				}
			} catch {
				// not yet
			}
		});
		child.once("error", reject);
		child.once("close", (code) => {
			reject(new Error(`acquire child exited early code=${code} stdout=${stdout}`));
		});
	});
}

function makeTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-lock-contention-"));
}

describe("lock cross-process contention", () => {
	let cwd: string;
	beforeEach(() => {
		cwd = makeTmp();
	});

	it("two processes serialize through the lock; second waits then succeeds", async () => {
		// First child holds the lock for 600ms.
		const { child: holder, pid: holderPid } = await acquireChild([
			"--cwd",
			cwd,
			"--action",
			"acquire-and-hold",
			"--holdMs",
			"600",
			"--command",
			"/senai-approve",
			"--runId",
			"hold-run",
		]);
		assert.ok(holderPid > 0);
		assert.strictEqual(lockInfo(cwd)?.pid, holderPid, "parent sees the holder");

		try {
			// Second child tries with a generous 2000ms timeout — should wait
			// for the holder to release, then succeed.
			const second = await runChild([
				"--cwd",
				cwd,
				"--action",
				"try-acquire",
				"--timeoutMs",
				"2000",
				"--staleMs",
				"60000",
				"--command",
				"/senai-discussion-approve",
				"--mode",
				"discussion-approve",
				"--runId",
				"second-run",
			]);
			assert.strictEqual(second.code, 0, `second child code=${second.code} result=${JSON.stringify(second.result)}`);
			assert.ok(second.result?.ok);
			assert.notStrictEqual(second.result?.pid, holderPid, "second child has its own pid");
			// After the second child releases, the lock should be free again.
			assert.strictEqual(lockInfo(cwd), null);
		} finally {
			await killChild(holder);
		}
	});

	it("a crashed previous holder is auto-stolen after STALE_MS", async () => {
		// Child A acquires and then sleeps forever (simulates a crashed
		// previous session). We kill it ourselves to leave a stale lock.
		const { child } = await acquireChild([
			"--cwd",
			cwd,
			"--action",
			"acquire-and-exit",
			"--command",
			"/senai-approve",
			"--runId",
			"crash-run",
		]);
		await killChild(child);

		const beforeMeta = lockInfo(cwd);
		assert.ok(beforeMeta, "lock is held by the (now-dead) child");

		// Make staleness cheap for this test: overwrite the recorded
		// heartbeat to be 5 seconds in the past.
		const lockPath = path.join(cwd, ".IDE_Plans/pi-senai/.lock/meta.json");
		const raw = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Record<string, unknown>;
		raw.heartbeatAt = new Date(Date.now() - 5_000).toISOString();
		fs.writeFileSync(lockPath, JSON.stringify(raw), "utf8");

		// Second child tries with a 1500ms timeout and staleMs=1000; the
		// recorded heartbeat is now 5 seconds old, well past staleMs, so
		// the auto-steal kicks in and the second child succeeds quickly.
		const second = await runChild([
			"--cwd",
			cwd,
			"--action",
			"try-acquire",
			"--timeoutMs",
			"1500",
			"--staleMs",
			"1000",
			"--command",
			"/senai-approve",
			"--runId",
			"recovery-run",
		]);
		assert.strictEqual(second.code, 0, `recovery child code=${second.code} result=${JSON.stringify(second.result)}`);
		assert.ok(second.result?.ok, "auto-steal should let the second child acquire");
		assert.notStrictEqual(second.result?.pid, beforeMeta.pid, "new holder pid differs from the dead pid");
	});
});
