import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

describe("package manifest", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    pi?: { extensions?: string[]; skills?: string[] };
  };

  it("every pi.extensions entry exists on disk", () => {
    const entries = pkg.pi?.extensions ?? [];
    assert.ok(entries.length > 0, "pi.extensions should not be empty");
    for (const entry of entries) {
      assert.ok(fs.existsSync(path.join(repoRoot, entry)), `pi.extensions entry missing: ${entry}`);
    }
  });

  it("every pi.skills entry exists on disk", () => {
    const entries = pkg.pi?.skills ?? [];
    assert.ok(entries.length > 0, "pi.skills should not be empty");
    for (const entry of entries) {
      assert.ok(fs.existsSync(path.join(repoRoot, entry)), `pi.skills entry missing: ${entry}`);
    }
  });
});
