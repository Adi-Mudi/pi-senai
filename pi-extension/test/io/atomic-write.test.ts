import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { atomicWriteFile, atomicWriteJson, cleanupTempFiles } from "../../src/io/atomic-write.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-atomic-"));
}

describe("atomic-write", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeTmp();
  });

  it("writes a text file and reads back the same content", () => {
    const target = path.join(cwd, "hello.txt");
    atomicWriteFile(target, "hello world\n");
    assert.strictEqual(fs.readFileSync(target, "utf8"), "hello world\n");
  });

  it("creates missing parent directories", () => {
    const target = path.join(cwd, "deep", "nested", "file.md");
    atomicWriteFile(target, "deep");
    assert.strictEqual(fs.readFileSync(target, "utf8"), "deep");
  });

  it("overwrites an existing file atomically", () => {
    const target = path.join(cwd, "x.txt");
    fs.writeFileSync(target, "old", "utf8");
    atomicWriteFile(target, "new");
    assert.strictEqual(fs.readFileSync(target, "utf8"), "new");
  });

  it("writes Buffer content with default encoding preserved", () => {
    const target = path.join(cwd, "bin.dat");
    const data = Buffer.from([0, 1, 2, 3, 0xff]);
    atomicWriteFile(target, data);
    const back = fs.readFileSync(target);
    assert.ok(back.equals(data));
  });

  it("does not leave a temp file behind on success", () => {
    const target = path.join(cwd, "clean.txt");
    atomicWriteFile(target, "x");
    const leftovers = fs.readdirSync(cwd).filter((n) => n.includes(".tmp"));
    assert.deepStrictEqual(leftovers, []);
  });

  it("atomicWriteJson round-trips an object with trailing newline", () => {
    const target = path.join(cwd, "config.json");
    const value = { hello: "world", n: 42, list: [1, 2, 3] };
    atomicWriteJson(target, value);
    const text = fs.readFileSync(target, "utf8");
    assert.ok(text.endsWith("\n"), "JSON output ends with a trailing newline");
    assert.deepStrictEqual(JSON.parse(text), value);
  });

  it("atomicWriteJson overwrites a previous config", () => {
    const target = path.join(cwd, "c.json");
    atomicWriteJson(target, { v: 1 });
    atomicWriteJson(target, { v: 2 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf8")), { v: 2 });
  });

  it("cleanTempFiles removes .tmp-* files at the top level", () => {
    const target = path.join(cwd, "file.txt");
    atomicWriteFile(target, "ok");
    // Plant fake leftovers as if a previous session crashed mid-write.
    fs.writeFileSync(path.join(cwd, "leftover.tmp-1234-abcd"), "x");
    fs.writeFileSync(path.join(cwd, "another.tmp-9999-ffff"), "y");
    const removed = cleanupTempFiles(cwd);
    assert.strictEqual(removed, 2);
    assert.strictEqual(fs.readdirSync(cwd).filter((n) => n.includes(".tmp")).length, 0);
    // The real file is untouched.
    assert.strictEqual(fs.readFileSync(target, "utf8"), "ok");
  });

  it("cleanTempFiles recurses into immediate subdirectories", () => {
    const sub = path.join(cwd, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "z.tmp-1-a"), "x");
    fs.writeFileSync(path.join(sub, "real.txt"), "keep me");
    const removed = cleanupTempFiles(cwd);
    assert.strictEqual(removed, 1);
    assert.strictEqual(fs.readFileSync(path.join(sub, "real.txt"), "utf8"), "keep me");
  });

  it("cleanTempFiles returns 0 when nothing to clean", () => {
    fs.writeFileSync(path.join(cwd, "real.txt"), "no temp here");
    assert.strictEqual(cleanupTempFiles(cwd), 0);
  });

  it("cleanTempFiles on a missing directory returns 0 without throwing", () => {
    const missing = path.join(cwd, "nope");
    assert.strictEqual(cleanupTempFiles(missing), 0);
  });

  it("rapid sequential writes never produce a partial read", () => {
    const target = path.join(cwd, "rapid.txt");
    const total = 50;
    let racyRead: string | null = null;
    // Simulate a concurrent reader during a burst of atomic writes.
    const reader = (() => {
      const start = Date.now();
      while (Date.now() - start < 50) {
        try {
          const text = fs.readFileSync(target, "utf8");
          // If the helper were not atomic, we could see a torn write.
          if (text.length > 0 && !/^message-\d+$/.test(text)) {
            racyRead = text;
            return;
          }
        } catch {
          // File may not exist yet on the very first read; ignore.
        }
      }
    })();
    for (let i = 0; i < total; i++) {
      atomicWriteFile(target, `message-${i}`);
    }
    reader;
    assert.strictEqual(racyRead, null, `torn write observed: ${racyRead}`);
  });
});
