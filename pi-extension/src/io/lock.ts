import * as fs from "node:fs";
import * as os from "node:os";
import { getLockDir, getLockPath } from "../core/paths.js";
import { atomicWriteJson } from "./atomic-write.js";

/**
 * Project-wide run lock.
 *
 * Three Senai commands (`/senai-approve`, `/senai-discussion-approve`,
 * `/senai-purge-community-cache`) share one lock file so they mutually
 * exclude each other. A second Pi session in the same project, or a
 * double-click inside one session, both surface as
 * "Lock busy: holder pid=… command=… started=…". Stale locks (dead pid or
 * heartbeat older than SENAI_LOCK_STALE_MS) are auto-stolen on the next
 * acquire attempt so a crashed previous session never wedges the run.
 *
 * Layout on disk:
 *   .IDE_Plans/pi-senai/.lock/
 *     meta.json      # { pid, host, command, startedAt, heartbeatAt, mode, runId }
 *
 * Algorithm:
 *   1. mkdir(dir) — atomic on POSIX. Success → we hold the lock.
 *   2. If mkdir fails with EEXIST, read meta.json. If the holder's heartbeat
 *      is fresh and the pid is alive, busy-wait up to SENAI_LOCK_TIMEOUT_MS.
 *   3. Otherwise (stale heartbeat or dead pid), steal the lock by
 *      atomically rewriting meta.json with our metadata.
 *   4. While held, refresh heartbeatAt every SENAI_LOCK_HEARTBEAT_MS.
 *   5. Release = atomically rewrite meta.json with pid=-1 (a sentinel that
 *      survives a crash between the rewrite and the directory removal) and
 *      rm the lock dir.
 */

export type LockMode = "approve" | "discussion-approve" | "discussion-research";

export interface LockMeta {
  pid: number;
  host: string;
  command: string;
  startedAt: string;
  heartbeatAt: string;
  mode: LockMode;
  runId?: string;
}

export interface AcquireOptions {
  cwd: string;
  mode: LockMode;
  /** Human-readable label, e.g. "/senai-approve". Shown in busy messages. */
  command: string;
  runId?: string;
  /** Max time to wait for the holder to release. Default SENAI_LOCK_TIMEOUT_MS or 5000ms. */
  timeoutMs?: number;
  /** Heartbeat age that counts as stale. Default SENAI_LOCK_STALE_MS or 60000ms. */
  staleMs?: number;
  /** Heartbeat refresh interval while held. Default SENAI_LOCK_HEARTBEAT_MS or 5000ms. */
  heartbeatMs?: number;
}

export interface AcquireOk {
  ok: true;
  release: () => void;
}

export interface AcquireBusy {
  ok: false;
  reason: string;
  holder: LockMeta | null;
}

export type AcquireResult = AcquireOk | AcquireBusy;

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STALE_MS = 60000;
const DEFAULT_HEARTBEAT_MS = 5000;
const POLL_INTERVAL_MS = 100;
/** Sentinel pid recorded just before we delete the lock dir. Lets a future
 *  acquirer distinguish "previous owner crashed mid-release" from "real
 *  fresh holder". */
const RELEASING_SENTINEL_PID = -1;

function readEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readMeta(filePath: string): LockMeta | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as LockMeta;
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.host === "string" &&
      typeof parsed.command === "string" &&
      typeof parsed.startedAt === "string" &&
      typeof parsed.heartbeatAt === "string" &&
      (parsed.mode === "approve" || parsed.mode === "discussion-approve" || parsed.mode === "discussion-research")
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err && (err.code === "ESRCH" || err.code === "EPERM")) {
      // ESRCH = no such process; EPERM = exists but owned by another user.
      // EPERM still counts as alive for lock purposes (we cannot kill it).
      return err.code === "EPERM";
    }
    return false;
  }
}

function isFresh(meta: LockMeta, staleMs: number): boolean {
  const age = Date.now() - Date.parse(meta.heartbeatAt);
  return Number.isFinite(age) && age >= 0 && age <= staleMs;
}

function formatHolder(meta: LockMeta | null): string {
  if (!meta) return "(no holder info)";
  const started = meta.startedAt ?? "?";
  const heartbeat = meta.heartbeatAt ?? "?";
  const ageSec = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(meta.heartbeatAt)) / 1000),
  );
  return [
    `pid=${meta.pid}`,
    `host=${meta.host}`,
    `command=${meta.command}`,
    `mode=${meta.mode}`,
    `runId=${meta.runId ?? "(none)"}`,
    `startedAt=${started}`,
    `heartbeatAt=${heartbeat} (${ageSec}s ago)`,
  ].join(", ");
}

function makeMeta(opts: { mode: LockMode; command: string; runId?: string }): LockMeta {
  const now = new Date().toISOString();
  return {
    pid: process.pid,
    host: os.hostname(),
    command: opts.command,
    startedAt: now,
    heartbeatAt: now,
    mode: opts.mode,
    runId: opts.runId,
  };
}

function tryAcquire(opts: {
  dir: string;
  file: string;
  meta: LockMeta;
  staleMs: number;
}): { acquired: boolean; holder: LockMeta | null } {
  // Atomic mkdir: success means we are the holder. Failure means someone
  // else holds it (or held it a moment ago — race window is microseconds).
  // recursive: true so the parent .IDE_Plans/pi-senai/ chain is created on
  // first use; the .lock directory itself is still atomic on POSIX (mkdir
  // either creates it or errors with EEXIST).
  try {
    fs.mkdirSync(opts.dir, { recursive: true });
  } catch (err: any) {
    if (!err || err.code !== "EEXIST") throw err;
  }
  // Confirm we actually own the directory (mkdir with recursive:false would
  // throw if the dir already exists; some FS return success anyway). Read
  // the meta file: if it doesn't exist yet, we hold it (race winner); if it
  // exists, we are stealing or waiting.
  const existing = readMeta(opts.file);
  if (!existing) {
    atomicWriteJson(opts.file, opts.meta);
    return { acquired: true, holder: null };
  }
  // Existing meta: decide steal vs wait.
  const alive = isPidAlive(existing.pid);
  const fresh = isFresh(existing, opts.staleMs);
  if (!alive || !fresh) {
    // Stale — steal.
    atomicWriteJson(opts.file, opts.meta);
    return { acquired: true, holder: existing };
  }
  return { acquired: false, holder: existing };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Internal acquire with explicit tunables (for tests). */
export function acquireLock(opts: AcquireOptions): AcquireResult {
  const timeoutMs = opts.timeoutMs ?? readEnv("SENAI_LOCK_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const staleMs = opts.staleMs ?? readEnv("SENAI_LOCK_STALE_MS", DEFAULT_STALE_MS);
  const heartbeatMs =
    opts.heartbeatMs ?? readEnv("SENAI_LOCK_HEARTBEAT_MS", DEFAULT_HEARTBEAT_MS);

  const dir = getLockDir(opts.cwd);
  const file = getLockPath(opts.cwd);
  const meta = makeMeta({ mode: opts.mode, command: opts.command, runId: opts.runId });

  // Tight retry loop on the wait side. The acquire path returns fast when
  // the lock is free or stale.
  const deadline = Date.now() + timeoutMs;
  let firstAttempt = true;
  // On first attempt, do an immediate try. On retries, poll.
  // Use a loop that always at least tries once.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { acquired, holder } = tryAcquire({ dir, file, meta, staleMs });
    if (acquired) {
      const interval = startHeartbeat({ file, heartbeatMs });
      return {
        ok: true,
        release: () => {
          clearInterval(interval);
          releaseLockDir(file, dir);
        },
      };
    }
    if (firstAttempt) {
      firstAttempt = false;
      if (timeoutMs <= 0) {
        return {
          ok: false,
          reason: `Lock busy. Holder: ${formatHolder(holder)}`,
          holder,
        };
      }
    } else if (Date.now() >= deadline) {
      return {
        ok: false,
        reason: `Lock busy after ${timeoutMs}ms. Holder: ${formatHolder(holder)}`,
        holder,
      };
    }
    // Sleep until the next poll, then retry. Re-read meta each iteration
    // so a release during the wait is detected.
    // Note: we never sleep past the deadline.
    const remaining = Math.max(0, deadline - Date.now());
    const wait = Math.min(POLL_INTERVAL_MS, remaining || POLL_INTERVAL_MS);
    // Synchronous sleep via Atomics would be cleaner; for the test surface
    // we keep the loop synchronous. The async variant below covers the
    // withRunLock usage.
    if (remaining <= 0) {
      return {
        ok: false,
        reason: `Lock busy. Holder: ${formatHolder(holder)}`,
        holder,
      };
    }
    // Busy-wait with a tiny sleep. Adequate for ≤5s timeouts.
    const until = Date.now() + wait;
    while (Date.now() < until) {
      // Tight loop; modern schedulers yield on setImmediate naturally.
    }
  }
}

function startHeartbeat(opts: { file: string; heartbeatMs: number }): NodeJS.Timeout {
  return setInterval(() => {
    try {
      const existing = readMeta(opts.file);
      if (!existing) return;
      const fresh: LockMeta = { ...existing, heartbeatAt: new Date().toISOString() };
      atomicWriteJson(opts.file, fresh);
    } catch {
      // Best-effort heartbeat; ignore errors.
    }
  }, opts.heartbeatMs);
}

function releaseLockDir(file: string, dir: string): void {
  // Step 1: write a sentinel (pid=-1) so a future acquirer can detect
  // "previous owner crashed mid-release" even if step 2 is interrupted.
  try {
    const existing = readMeta(file);
    if (existing && existing.pid === process.pid) {
      atomicWriteJson(file, { ...existing, pid: RELEASING_SENTINEL_PID });
    }
  } catch {
    // Best effort.
  }
  // Step 2: remove the lock directory.
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
}

/**
 * Async wrapper: acquire the lock, run `fn`, release in `finally`.
 * Returns `{ ok: true, value }` or `{ ok: false, reason, holder }`.
 */
export async function withRunLock<T>(
  opts: AcquireOptions,
  fn: () => Promise<T> | T,
): Promise<{ ok: true; value: T } | { ok: false; reason: string; holder: LockMeta | null }> {
  const timeoutMs = opts.timeoutMs ?? readEnv("SENAI_LOCK_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const staleMs = opts.staleMs ?? readEnv("SENAI_LOCK_STALE_MS", DEFAULT_STALE_MS);
  const heartbeatMs =
    opts.heartbeatMs ?? readEnv("SENAI_LOCK_HEARTBEAT_MS", DEFAULT_HEARTBEAT_MS);

  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = acquireLock({ ...opts, staleMs, heartbeatMs });
    if (result.ok) {
      try {
        const value = await fn();
        return { ok: true, value };
      } finally {
        result.release();
      }
    }
    if (Date.now() >= deadline) {
      return { ok: false, reason: result.reason, holder: result.holder };
    }
    const remaining = Math.max(0, deadline - Date.now());
    await sleep(Math.min(POLL_INTERVAL_MS, remaining));
  }
}

/** Read-only access to the current lock holder. Returns null when free. */
export function lockInfo(cwd: string): LockMeta | null {
  const file = getLockPath(cwd);
  if (!fs.existsSync(file)) return null;
  return readMeta(file);
}

/** Force-take the lock regardless of holder state. Used by /senai-doctor's
 *  recovery flow when a user explicitly confirms after a stale detection. */
export function forceStealLock(cwd: string): LockMeta {
  const dir = getLockDir(cwd);
  const file = getLockPath(cwd);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err: any) {
    if (!err || err.code !== "EEXIST") throw err;
  }
  const meta = makeMeta({ mode: "approve", command: "force-steal" });
  atomicWriteJson(file, meta);
  return meta;
}

/** Defensive cleanup: if the recorded pid is ours (a previous session of
 *  this process crashed mid-release), remove the lock dir. Returns true
 *  if a removal happened. */
export function releaseStaleLockIfHeldByUs(cwd: string, pid: number): boolean {
  const file = getLockPath(cwd);
  const meta = readMeta(file);
  if (!meta) return false;
  if (meta.pid !== pid) return false;
  const dir = getLockDir(cwd);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Format a holder for user-facing messages. */
export function describeHolder(meta: LockMeta | null): string {
  return formatHolder(meta);
}

/** Generate the heartbeat file path (exported for tests). */
export function lockFilePathForTest(cwd: string): string {
  return getLockPath(cwd);
}
