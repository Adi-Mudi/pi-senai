// Lock child helper used by lock-contention.test.ts.
//
// This file is run as a child Node process via child_process.spawn. It
// imports the real lock module from the compiled extension (so any drift
// in the lock implementation is caught by this test, not bypassed by a
// stub) and runs one of three actions based on the `--action` argument:
//
//   acquire-and-hold:  acquire the lock, hold it for `--holdMs`, release.
//   acquire-and-exit:  acquire the lock and exit without releasing
//                      (simulates a crashed previous session).
//   try-acquire:       try to acquire with the given timeouts, exit 0 on
//                      success and 2 on busy.
//
// Output: a single JSON line on stdout with the action result. Exit code
// is 0 on success and 2 on busy (so the parent test can assert).

import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as lock from "../../src/io/lock.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The compiled extension sits at dist/pi-extension/src/lock.js. This helper
// sits at dist/pi-extension/test/helpers/lock-child.js, so go up two levels.
void fileURLToPath;
void pathToFileURL;

function arg(name: string, fallback?: string): string | undefined {
	const idx = process.argv.indexOf(name);
	if (idx === -1) return fallback;
	return process.argv[idx + 1];
}

function out(obj: Record<string, unknown>): void {
	process.stdout.write(JSON.stringify(obj) + "\n");
}

const cwd = arg("--cwd");
if (!cwd) {
	console.error("missing --cwd");
	process.exit(3);
}
const action = arg("--action");
const command = arg("--command", "/senai-approve")!;
const mode = (arg("--mode", "approve") === "discussion-approve"
	? "discussion-approve"
	: "approve") as "approve" | "discussion-approve";
const runId = arg("--runId", "child-run")!;
const holdMs = Number.parseInt(arg("--holdMs", "0")!, 10);
const timeoutMs = Number.parseInt(arg("--timeoutMs", "500")!, 10);
const staleMs = Number.parseInt(arg("--staleMs", "60000")!, 10);

void HERE;

const opts = {
	cwd,
	mode,
	command,
	runId,
	timeoutMs,
	staleMs,
	heartbeatMs: 1_000_000, // effectively disable heartbeat for short tests
};

if (action === "acquire-and-hold") {
	const r = lock.acquireLock(opts);
	if (!r.ok) {
		out({ ok: false, reason: r.reason });
		process.exit(2);
	}
	out({ ok: true, pid: process.pid });
	await new Promise((resolve) => setTimeout(resolve, holdMs));
	r.release();
	out({ ok: true, released: true });
	process.exit(0);
}

if (action === "acquire-and-exit") {
	const r = lock.acquireLock(opts);
	if (!r.ok) {
		out({ ok: false, reason: r.reason });
		process.exit(2);
	}
	out({ ok: true, pid: process.pid });
	// Deliberately do NOT release — simulate a crashed previous session.
	await new Promise(() => {});
}

if (action === "try-acquire") {
	const r = lock.acquireLock(opts);
	if (!r.ok) {
		out({ ok: false, reason: r.reason, holder: r.holder });
		process.exit(2);
	}
	out({ ok: true, pid: process.pid });
	r.release();
	process.exit(0);
}

console.error(`unknown --action: ${action}`);
process.exit(3);
