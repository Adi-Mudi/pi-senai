import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    diffFilesManifest,
    parseFilesManifest,
    type ManifestEntry,
} from "../../src/implement/manifest.js";

const VALID_PLAN = `# Plan

## Steps

1. Do things

## Files

| path | layer | action | reason |
| --- | --- | --- | --- |
| src/foo.ts | commands | create | new command |
| src/bar.ts | core | edit | extend state |
| src/old.ts | io | delete | dead code |

## Verification

- echo ok
`;

describe("parseFilesManifest", () => {
    it("parses a valid manifest", () => {
        const result = parseFilesManifest(VALID_PLAN);
        assert.strictEqual(result.missingSection, false);
        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.entries.length, 3);
        assert.strictEqual(result.entries[0].path, "src/foo.ts");
        assert.strictEqual(result.entries[0].layer, "commands");
        assert.strictEqual(result.entries[0].action, "create");
        assert.strictEqual(result.entries[2].action, "delete");
        assert.ok(result.entries[0].line > 0, "entries carry a 1-based line number");
    });

    it("reports missingSection when the plan has no ## Files section", () => {
        const result = parseFilesManifest("# Plan\n\n## Verification\n\n- echo ok\n");
        assert.strictEqual(result.missingSection, true);
        assert.strictEqual(result.entries.length, 0);
    });

    it("reports an error when the section has no table", () => {
        const result = parseFilesManifest("# Plan\n\n## Files\n\nno table here\n");
        assert.strictEqual(result.missingSection, false);
        assert.ok(result.errors.some((e) => e.message.includes("no manifest table")));
    });

    it("rejects a wrong header", () => {
        const plan = "## Files\n\n| file | layer | action | reason |\n| --- | --- | --- | --- |\n| src/a.ts | core | create | x |\n";
        const result = parseFilesManifest(plan);
        assert.ok(result.errors.some((e) => e.message.includes("header")));
    });

    it("rejects an empty path", () => {
        const plan = "## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n|  | core | create | x |\n";
        const result = parseFilesManifest(plan);
        assert.ok(result.errors.some((e) => e.message.includes("path is empty")));
    });

    it("rejects absolute paths", () => {
        for (const p of ["/etc/passwd", "C:\\\\Windows\\\\system32"]) {
            const plan = `## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| ${p} | core | create | x |\n`;
            const result = parseFilesManifest(plan);
            assert.ok(
                result.errors.some((e) => e.message.includes("absolute")),
                `expected absolute-path error for ${p}`,
            );
        }
    });

    it("rejects paths escaping the project root", () => {
        const plan = "## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| ../outside.ts | core | create | x |\n";
        const result = parseFilesManifest(plan);
        assert.ok(result.errors.some((e) => e.message.includes("..")));
    });

    it("rejects an invalid action", () => {
        const plan = "## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/a.ts | core | move | x |\n";
        const result = parseFilesManifest(plan);
        assert.ok(result.errors.some((e) => e.message.includes('invalid action "move"')));
    });

    it("rejects an empty layer", () => {
        const plan = "## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/a.ts |  | create | x |\n";
        const result = parseFilesManifest(plan);
        assert.ok(result.errors.some((e) => e.message.includes("layer is empty")));
    });

    it("rejects duplicate paths and cites the first line", () => {
        const plan =
            "## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/a.ts | core | create | x |\n| src/a.ts | io | edit | y |\n";
        const result = parseFilesManifest(plan);
        const dup = result.errors.find((e) => e.message.includes("duplicate path"));
        assert.ok(dup, "expected a duplicate-path error");
        assert.ok(dup.message.includes("first listed on line"));
        assert.strictEqual(result.entries.length, 1);
    });

    it("errors carry the plan-document line number", () => {
        const plan = "# Plan\n\n## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| /abs.ts | core | create | x |\n";
        const result = parseFilesManifest(plan);
        assert.strictEqual(result.errors[0].line, 7);
    });

    it("validates layers against an optional layer list (Phase 3 hook)", () => {
        const plan = "## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/a.ts | bogus | create | x |\n";
        const result = parseFilesManifest(plan, { layers: ["core", "io"] });
        assert.ok(result.errors.some((e) => e.message.includes("not in the architecture layer map")));
    });
});

describe("diffFilesManifest", () => {
    function makeDisk(files: string[]): string {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-manifest-"));
        for (const rel of files) {
            const abs = path.join(cwd, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, "// file\n");
        }
        return cwd;
    }

    function entry(p: string, action: ManifestEntry["action"] = "create"): ManifestEntry {
        return { path: p, layer: "core", action, reason: "", line: 1 };
    }

    it("reports missing planned files and unexpected disk files", () => {
        const cwd = makeDisk(["src/a.ts", "src/extra.ts"]);
        try {
            const diff = diffFilesManifest([entry("src/a.ts"), entry("src/b.ts")], cwd);
            assert.deepStrictEqual(diff.missing, ["src/b.ts"]);
            assert.deepStrictEqual(diff.unexpected, ["src/extra.ts"]);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("reports a clean diff when disk matches the manifest", () => {
        const cwd = makeDisk(["src/a.ts", "src/b.ts"]);
        try {
            const diff = diffFilesManifest([entry("src/a.ts"), entry("src/b.ts")], cwd);
            assert.deepStrictEqual(diff.missing, []);
            assert.deepStrictEqual(diff.unexpected, []);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("ignores edit and delete entries", () => {
        const cwd = makeDisk(["src/a.ts"]);
        try {
            const diff = diffFilesManifest(
                [entry("src/a.ts", "edit"), entry("src/gone.ts", "delete")],
                cwd,
            );
            assert.deepStrictEqual(diff.missing, []);
            assert.deepStrictEqual(diff.unexpected, []);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});
