import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateLegacyOrchestraDirs } from "../src/migrate.js";

describe("migrateLegacyOrchestraDirs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-migrate-test-"));
  });

  it("migrates .IDE_Plans/orchestra to .IDE_Plans/senai", () => {
    const legacyDir = path.join(tmpDir, ".IDE_Plans", "orchestra");
    const targetDir = path.join(tmpDir, ".IDE_Plans", "senai");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "state.json"), JSON.stringify({ version: 1 }));

    const moved = migrateLegacyOrchestraDirs(tmpDir);

    assert.strictEqual(moved.length, 1);
    assert.ok(!fs.existsSync(legacyDir));
    assert.ok(fs.existsSync(path.join(targetDir, "state.json")));
  });

  it("migrates .pi/orchestra to .pi/senai", () => {
    const legacyDir = path.join(tmpDir, ".pi", "orchestra");
    const targetDir = path.join(tmpDir, ".pi", "senai");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "agents.json"), JSON.stringify({ agents: {} }));

    const moved = migrateLegacyOrchestraDirs(tmpDir);

    assert.strictEqual(moved.length, 1);
    assert.ok(!fs.existsSync(legacyDir));
    assert.ok(fs.existsSync(path.join(targetDir, "agents.json")));
  });

  it("does nothing when no legacy directories exist", () => {
    const moved = migrateLegacyOrchestraDirs(tmpDir);
    assert.deepStrictEqual(moved, []);
    assert.ok(!fs.existsSync(path.join(tmpDir, ".IDE_Plans", "senai")));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".pi", "senai")));
  });

  it("skips migration when the new directory already exists", () => {
    const legacyDir = path.join(tmpDir, ".IDE_Plans", "orchestra");
    const targetDir = path.join(tmpDir, ".IDE_Plans", "senai");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "state.json"), JSON.stringify({ version: 1 }));
    fs.writeFileSync(path.join(targetDir, "state.json"), JSON.stringify({ version: 2 }));

    const moved = migrateLegacyOrchestraDirs(tmpDir);

    assert.deepStrictEqual(moved, []);
    assert.ok(fs.existsSync(legacyDir));
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(targetDir, "state.json"), "utf8")).version,
      2,
    );
  });

  it("migrates both directories in one call", () => {
    const legacyIde = path.join(tmpDir, ".IDE_Plans", "orchestra");
    const legacyPi = path.join(tmpDir, ".pi", "orchestra");
    fs.mkdirSync(legacyIde, { recursive: true });
    fs.mkdirSync(legacyPi, { recursive: true });
    fs.writeFileSync(path.join(legacyIde, "state.json"), "{}");
    fs.writeFileSync(path.join(legacyPi, "agents.json"), "{}");

    const moved = migrateLegacyOrchestraDirs(tmpDir);

    assert.strictEqual(moved.length, 2);
    assert.ok(!fs.existsSync(legacyIde));
    assert.ok(!fs.existsSync(legacyPi));
    assert.ok(fs.existsSync(path.join(tmpDir, ".IDE_Plans", "senai", "state.json")));
    assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "senai", "agents.json")));
  });

  it("preserves nested directory contents during migration", () => {
    const legacyIde = path.join(tmpDir, ".IDE_Plans", "orchestra");
    const nested = path.join(legacyIde, "runs", "2026-01-01-test", "plan", "scouts");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "scout-angle_1.md"), "# scout notes");

    migrateLegacyOrchestraDirs(tmpDir);

    const movedFile = path.join(tmpDir, ".IDE_Plans", "senai", "runs", "2026-01-01-test", "plan", "scouts", "scout-angle_1.md");
    assert.ok(fs.existsSync(movedFile));
    assert.strictEqual(fs.readFileSync(movedFile, "utf8"), "# scout notes");
  });

  it("migrates only the legacy directory that exists", () => {
    const legacyPi = path.join(tmpDir, ".pi", "orchestra");
    fs.mkdirSync(legacyPi, { recursive: true });

    const moved = migrateLegacyOrchestraDirs(tmpDir);

    assert.deepStrictEqual(moved, [".pi/senai"]);
    assert.ok(!fs.existsSync(legacyPi));
    assert.ok(!fs.existsSync(path.join(tmpDir, ".IDE_Plans", "senai")), "IDE senai dir should not be created");
  });
});
