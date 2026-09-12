import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    checkArchRules,
    type ArchRulesExecFn,
} from "../../src/implement/arch-rules-check.js";

function makeProject(files: Record<string, string>): string {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-archrules-"));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(cwd, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
    }
    return cwd;
}

const noopExec: ArchRulesExecFn = async () => ({ code: 0, output: "" });

describe("checkArchRules", () => {
    it("reports configFound=false when no config was emitted", async () => {
        const cwd = makeProject({});
        try {
            const result = await checkArchRules(cwd, noopExec);
            assert.strictEqual(result.configFound, false);
            assert.strictEqual(result.tool, null);
            assert.strictEqual(result.ran, false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("warns (toolAvailable=false, never runs) when dependency-cruiser is not installed", async () => {
        const cwd = makeProject({ ".dependency-cruiser.json": "{}\n" });
        try {
            const result = await checkArchRules(cwd, noopExec);
            assert.strictEqual(result.configFound, true);
            assert.strictEqual(result.tool, "dependency-cruiser");
            assert.strictEqual(result.toolAvailable, false);
            assert.strictEqual(result.ran, false);
            assert.deepStrictEqual(result.violations, []);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("runs dependency-cruiser and collects violations (mocked runner)", async () => {
        const cwd = makeProject({
            ".dependency-cruiser.json": "{}\n",
            "node_modules/.bin/depcruise": "#!/bin/sh\n",
            "src/a.ts": "import '../data/b';\n",
        });
        const mockExec: ArchRulesExecFn = async () => ({
            code: 1,
            output: "error presentation-not-to-data: src/a.ts → src/data/b.ts\n",
        });
        try {
            const result = await checkArchRules(cwd, mockExec);
            assert.strictEqual(result.toolAvailable, true);
            assert.strictEqual(result.ran, true);
            assert.strictEqual(result.violations.length, 1);
            assert.ok(result.violations[0].includes("presentation-not-to-data"));
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("reports zero violations when dependency-cruiser exits clean", async () => {
        const cwd = makeProject({
            ".dependency-cruiser.json": "{}\n",
            "node_modules/.bin/depcruise": "#!/bin/sh\n",
        });
        try {
            const result = await checkArchRules(cwd, noopExec);
            assert.strictEqual(result.ran, true);
            assert.deepStrictEqual(result.violations, []);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("warns when import-linter is not on PATH", async () => {
        const cwd = makeProject({ ".importlinter": "[importlinter]\n" });
        const missingExec: ArchRulesExecFn = async () => ({ code: -1, output: "" });
        try {
            const result = await checkArchRules(cwd, missingExec);
            assert.strictEqual(result.tool, "import-linter");
            assert.strictEqual(result.toolAvailable, false);
            assert.strictEqual(result.ran, false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("collects broken import-linter contracts (mocked runner)", async () => {
        const cwd = makeProject({ ".importlinter": "[importlinter]\n" });
        const mockExec: ArchRulesExecFn = async (_cmd, args) => {
            if (args[0] === "--version") return { code: 0, output: "1.0" };
            return { code: 1, output: "Contracts: 1 kept, 1 broken.\n\nBROKEN: presentation must not import data\n" };
        };
        try {
            const result = await checkArchRules(cwd, mockExec);
            assert.strictEqual(result.ran, true);
            assert.ok(result.violations.some((v) => v.includes("BROKEN")));
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});
