import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  acquireLock,
  forceStealLock,
  lockInfo,
  releaseStaleLockIfHeldByUs,
  withRunLock,
  describeHolder,
  type AcquireOptions,
} from "../../src/lock.js";
import { getLockDir, getLockPath } from "../../src/constants.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-lock-"));
}

function baseOpts(overrides: Partial<AcquireOptions> = {}): AcquireOptions {
  return {
    cwd: "",
    mode: "approve",
    command: "/senai-approve",
    runId: "test-run",
    timeoutMs: 200,
    staleMs: 60_000,
    heartbeatMs: 1_000_000, // effectively disable heartbeat during short tests
    ...overrides,
  };
}

describe("lock", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeTmp();
  });

  it("acquires the lock when no holder exists", () => {
    const result = acquireLock(baseOpts({ cwd }));
    assert.strictEqual(result.ok, true);
    if (result.ok) result.release();
  });

  it("creates the lock directory and meta.json", () => {
    const result = acquireLock(baseOpts({ cwd }));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.existsSync(getLockDir(cwd)), true);
    assert.strictEqual(fs.existsSync(getLockPath(cwd)), true);
    if (result.ok) result.release();
  });

  it("writes holder metadata with the expected shape", () => {
    const result = acquireLock(baseOpts({ cwd, command: "/senai-approve", runId: "run-1" }));
    assert.strictEqual(result.ok, true);
    const meta = lockInfo(cwd);
    assert.ok(meta, "lockInfo should return holder after acquire");
    assert.strictEqual(meta!.pid, process.pid);
    assert.strictEqual(meta!.command, "/senai-approve");
    assert.strictEqual(meta!.mode, "approve");
    assert.strictEqual(meta!.runId, "run-1");
    assert.strictEqual(typeof meta!.startedAt, "string");
    assert.strictEqual(typeof meta!.heartbeatAt, "string");
    if (result.ok) result.release();
  });

  it("release() removes the lock directory", () => {
    const result = acquireLock(baseOpts({ cwd }));
    assert.ok(result.ok);
    if (result.ok) result.release();
    assert.strictEqual(fs.existsSync(getLockDir(cwd)), false);
    assert.strictEqual(lockInfo(cwd), null);
  });

  it("second acquire returns busy when the holder is alive", () => {
    const first = acquireLock(baseOpts({ cwd, timeoutMs: 50 }));
    assert.ok(first.ok);
    const second = acquireLock(baseOpts({ cwd, timeoutMs: 50 }));
    assert.strictEqual(second.ok, false);
    if (!second.ok) {
      assert.strictEqual(second.holder?.pid, process.pid);
    }
    if (first.ok) first.release();
  });

  it("second acquire times out and surfaces the holder info", () => {
    const first = acquireLock(baseOpts({ cwd, timeoutMs: 50 }));
    assert.ok(first.ok);
    const second = acquireLock(baseOpts({ cwd, timeoutMs: 50, staleMs: 60_000 }));
    assert.strictEqual(second.ok, false);
    if (!second.ok) {
      assert.match(second.reason, /Lock busy/);
      assert.ok(second.holder, "holder should be reported on busy");
      assert.strictEqual(second.holder!.pid, process.pid);
    }
    if (first.ok) first.release();
  });

  it("stale-steals when the recorded pid is dead", () => {
    // Plant a meta.json that points at a pid we know does not exist.
    fs.mkdirSync(getLockDir(cwd), { recursive: true });
    const now = new Date().toISOString();
    const fakeMeta = {
      pid: 2_000_000_000, // almost certainly not a live process
      host: "test",
      command: "/senai-approve",
      startedAt: now,
      heartbeatAt: now,
      mode: "approve",
      runId: "stale-run",
    };
    fs.writeFileSync(getLockPath(cwd), JSON.stringify(fakeMeta), "utf8");

    const result = acquireLock(baseOpts({ cwd, staleMs: 60_000, timeoutMs: 50 }));
    assert.strictEqual(result.ok, true, "should steal a lock whose holder is dead");
    if (result.ok) {
      const meta = lockInfo(cwd);
      assert.strictEqual(meta?.pid, process.pid);
      result.release();
    }
  });

  it("stale-steals when the heartbeat is older than staleMs", () => {
    fs.mkdirSync(getLockDir(cwd), { recursive: true });
    const longAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const staleMeta = {
      pid: process.pid, // live pid, so process.kill(pid, 0) succeeds
      host: "test",
      command: "/senai-approve",
      startedAt: longAgo,
      heartbeatAt: longAgo,
      mode: "approve",
    };
    fs.writeFileSync(getLockPath(cwd), JSON.stringify(staleMeta), "utf8");

    const result = acquireLock(baseOpts({ cwd, staleMs: 1_000, timeoutMs: 50 }));
    assert.strictEqual(result.ok, true, "should steal when heartbeat is older than staleMs");
    if (result.ok) result.release();
  });

  it("forceStealLock overwrites any holder", () => {
    fs.mkdirSync(getLockDir(cwd), { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      getLockPath(cwd),
      JSON.stringify({
        pid: 2_000_000_001,
        host: "someone-else",
        command: "/senai-approve",
        startedAt: now,
        heartbeatAt: now,
        mode: "approve",
      }),
      "utf8",
    );
    const meta = forceStealLock(cwd);
    assert.strictEqual(meta.pid, process.pid);
    assert.strictEqual(meta.command, "force-steal");
    assert.strictEqual(lockInfo(cwd)?.pid, process.pid);
  });

  it("releaseStaleLockIfHeldByUs only removes the dir when the recorded pid matches", () => {
    fs.mkdirSync(getLockDir(cwd), { recursive: true });
    const now = new Date().toISOString();
    // Recorded pid is NOT ours.
    fs.writeFileSync(
      getLockPath(cwd),
      JSON.stringify({
        pid: 2_000_000_002,
        host: "stranger",
        command: "/senai-approve",
        startedAt: now,
        heartbeatAt: now,
        mode: "approve",
      }),
      "utf8",
    );
    const removed = releaseStaleLockIfHeldByUs(cwd, process.pid);
    assert.strictEqual(removed, false);
    assert.strictEqual(fs.existsSync(getLockDir(cwd)), true);
  });

  it("describeHolder returns a multi-line string with key fields", () => {
    const now = new Date().toISOString();
    const meta = {
      pid: 999,
      host: "host-A",
      command: "/senai-discussion-approve",
      startedAt: now,
      heartbeatAt: now,
      mode: "discussion-approve" as const,
      runId: "r-2",
    };
    const text = describeHolder(meta);
    assert.match(text, /pid=999/);
    assert.match(text, /host=host-A/);
    assert.match(text, /command=\/senai-discussion-approve/);
    assert.match(text, /mode=discussion-approve/);
    assert.match(text, /runId=r-2/);
    assert.match(text, /startedAt=/);
    assert.match(text, /heartbeatAt=/);
  });

  it("describeHolder handles null gracefully", () => {
    const text = describeHolder(null);
    assert.strictEqual(typeof text, "string");
    assert.match(text, /no holder/);
  });

  it("withRunLock runs the callback and releases the lock", async () => {
    const out = await withRunLock(baseOpts({ cwd, timeoutMs: 1000 }), async () => "ok");
    assert.deepStrictEqual(out, { ok: true, value: "ok" });
    assert.strictEqual(lockInfo(cwd), null);
  });

  it("withRunLock returns ok=false when the lock is held by another live pid", async () => {
    const first = acquireLock(baseOpts({ cwd, timeoutMs: 1000 }));
    assert.ok(first.ok);
    const second = await withRunLock(
      baseOpts({ cwd, timeoutMs: 80, staleMs: 60_000 }),
      async () => "should-not-run",
    );
    assert.strictEqual(second.ok, false);
    if (!second.ok) {
      assert.match(second.reason, /Lock busy/);
      assert.ok(second.holder);
      assert.strictEqual(second.holder!.pid, process.pid);
    }
    if (first.ok) first.release();
  });

  it("withRunLock auto-steals a dead holder and runs the callback", async () => {
    fs.mkdirSync(getLockDir(cwd), { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      getLockPath(cwd),
      JSON.stringify({
        pid: 2_000_000_003,
        host: "ghost",
        command: "/senai-approve",
        startedAt: now,
        heartbeatAt: now,
        mode: "approve",
      }),
      "utf8",
    );
    const out = await withRunLock(
      baseOpts({ cwd, timeoutMs: 1000, staleMs: 60_000 }),
      async () => 42,
    );
    assert.deepStrictEqual(out, { ok: true, value: 42 });
    assert.strictEqual(lockInfo(cwd), null);
  });

  it("lock contention between approve and discussion-approve modes is mutually exclusive", async () => {
    // First, acquire as 'approve'.
    const first = acquireLock(baseOpts({ cwd, mode: "approve", timeoutMs: 500 }));
    assert.ok(first.ok);
    // Now try to acquire as 'discussion-approve' — should fail because the
    // lock file is the same regardless of mode.
    const second = acquireLock(
      baseOpts({ cwd, mode: "discussion-approve", timeoutMs: 80, staleMs: 60_000 }),
    );
    assert.strictEqual(second.ok, false);
    if (first.ok) first.release();
  });
});
