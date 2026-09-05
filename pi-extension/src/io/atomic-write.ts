import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Atomic-write helper.
 *
 * Replaces plain `fs.writeFileSync` for every file the extension owns. The
 * pattern is: write to a temp file in the same directory, fsync the temp file,
 * then `renameSync` over the target. POSIX guarantees the rename is atomic
 * within a single filesystem, so readers never see a half-written file even
 * if the process crashes between the fsync and the rename.
 *
 * On Windows the rename-over-existing semantics differ slightly (Windows
 * fails if the destination is open elsewhere); the helper tolerates that by
 * unlinking the destination first on EEXIST/EPERM. We target Linux/macOS per
 * the project's AGENTS.md, but the fallback keeps dev machines happy.
 *
 * Crash semantics:
 * - Crash before the rename: target keeps its old content; a `.tmp-*` may
 *   linger under the same directory. The session_start hook (see `index.ts`)
 *   cleans orphan `.tmp-*` files on startup.
 * - Crash after the rename (before fsync of the parent dir): readers see the
 *   new content. POSIX guarantees the rename itself is atomic and visible.
 *   The directory fsync only hardens against power loss.
 */

const TMP_SUFFIX = ".tmp";

function uniqueTempName(target: string): string {
  const pid = process.pid;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16);
  return `${target}${TMP_SUFFIX}-${pid}-${rand}`;
}

function tryFsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    // Some filesystems (e.g. Windows FAT, some FUSE mounts) reject dir-fsync.
    // The rename is still atomic; fsync is hardening, not correctness.
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors on best-effort fsync.
      }
    }
  }
}

/**
 * Write `content` to `filePath` atomically: temp file + fsync + rename.
 * Creates parent directories as needed. Returns when the bytes are durable
 * (fsync on the temp file) and visible (rename completed).
 */
export function atomicWriteFile(
  filePath: string,
  content: string | Buffer,
  encoding: BufferEncoding = "utf8",
): void {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });

  const tempPath = uniqueTempName(filePath);
  const data = typeof content === "string" ? Buffer.from(content, encoding) : content;

  let fd: number | undefined;
  try {
    fd = fs.openSync(tempPath, "w");
    fs.writeSync(fd, data, 0, data.length, 0);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors during cleanup.
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Temp file may not exist; nothing to clean.
    }
    throw err;
  }

  try {
    fs.renameSync(tempPath, filePath);
  } catch (err: any) {
    if (err && (err.code === "EEXIST" || err.code === "EPERM")) {
      // Windows: unlink the destination and retry the rename.
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Destination may have already been removed by another process.
      }
      fs.renameSync(tempPath, filePath);
    } else {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Temp file may already be gone.
      }
      throw err;
    }
  }

  tryFsyncDir(parent);
}

/**
 * Serialize `value` as pretty-printed JSON and write it atomically.
 * Centralizes the JSON.stringify settings so every config file matches.
 */
export function atomicWriteJson(filePath: string, value: unknown): void {
  atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Remove every `.tmp-*` file under `dir`. Called from the session_start hook
 * to clean up after a previous session that crashed between temp-file write
 * and rename. Returns the number of files removed.
 */
export function cleanupTempFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.includes(TMP_SUFFIX)) continue;
    const full = path.join(dir, entry);
    try {
      const stat = fs.lstatSync(full);
      if (!stat.isFile()) continue;
      fs.unlinkSync(full);
      removed++;
    } catch {
      // Best-effort cleanup; ignore individual failures.
    }
  }
  // Recurse one level into immediate subdirectories (e.g. runs/<id>/).
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    try {
      if (fs.statSync(full).isDirectory()) {
        removed += cleanupTempFiles(full);
      }
    } catch {
      // Skip unreadable entries.
    }
  }
  return removed;
}

/** Best-effort detection of the platform temp dir (used in tests). */
export function tmpDirForTest(): string {
  return os.tmpdir();
}
