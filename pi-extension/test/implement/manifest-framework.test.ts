import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseFrameworkField } from "../../src/implement/manifest.js";
import { checkPlanVerificationGate } from "../../src/implement/signals.js";
import { getArtifactPaths } from "../../src/core/paths.js";

function makeCwd(files: Record<string, string> = {}): string {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "senai-fwfield-"));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(cwd, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
    }
    return cwd;
}

describe("parseFrameworkField", () => {
    it("reports found=false when the plan has no ## Framework section", () => {
        const cwd = makeCwd();
        try {
            const result = parseFrameworkField("# Plan\n\n## Files\n\n(no table)\n", cwd);
            assert.strictEqual(result.found, false);
            assert.strictEqual(result.value, null);
            assert.strictEqual(result.error, null);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("parses a valid framework id from the section body", () => {
        const cwd = makeCwd();
        try {
            const result = parseFrameworkField("# Plan\n\n## Framework\n\nexpress\n\n## Verification\n", cwd);
            assert.strictEqual(result.found, true);
            assert.strictEqual(result.value, "express");
            assert.strictEqual(result.error, null);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("parses an inline value (`## Framework: nextjs`) and lowercases it", () => {
        const cwd = makeCwd();
        try {
            const result = parseFrameworkField("# Plan\n\n## Framework: NextJS\n", cwd);
            assert.strictEqual(result.found, true);
            assert.strictEqual(result.value, "nextjs");
            assert.strictEqual(result.error, null);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("accepts `none`", () => {
        const cwd = makeCwd();
        try {
            const result = parseFrameworkField("# Plan\n\n## Framework\n\n- `none`\n", cwd);
            assert.strictEqual(result.found, true);
            assert.strictEqual(result.value, "none");
            assert.strictEqual(result.error, null);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("rejects an unknown framework id and lists the known ids", () => {
        const cwd = makeCwd();
        try {
            const result = parseFrameworkField("# Plan\n\n## Framework\n\nruby-on-rails\n", cwd);
            assert.strictEqual(result.found, true);
            assert.ok(result.error && result.error.includes('unknown framework id "ruby-on-rails"'));
            assert.ok(result.error.includes("express"), "known ids are listed");
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("rejects an empty section and a multi-word value", () => {
        const cwd = makeCwd();
        try {
            const empty = parseFrameworkField("# Plan\n\n## Framework\n\n## Verification\n", cwd);
            assert.ok(empty.error && empty.error.includes("empty"));
            const multi = parseFrameworkField("# Plan\n\n## Framework\n\nnext js\n", cwd);
            assert.ok(multi.error && multi.error.includes("single framework id"));
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("honors project-local .pi/framework-library overrides", () => {
        const cwd = makeCwd({
            ".pi/framework-library/typescript/custom-fw.md":
                "---\nid: custom-fw\nlanguage: typescript\nframework: Custom\nofficialDocs: https://example.com\ndetectDeps:\n  - custom-fw\n---\n# Custom\n",
        });
        try {
            const result = parseFrameworkField("# Plan\n\n## Framework\n\ncustom-fw\n", cwd);
            assert.strictEqual(result.error, null);
            assert.strictEqual(result.value, "custom-fw");
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe("checkPlanVerificationGate — framework lock", () => {
    const runId = "2099-01-01-00-00-fw";

    const VALID_MANIFEST_AND_VERIFICATION =
        "## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/a.ts | core | create | x |\n\n## Verification\n\n1. npm test\n";

    function withGate(
        files: Record<string, string>,
        planBody: string,
        fn: (gate: { blocked: boolean; reason: string | null }) => void,
    ) {
        const cwd = makeCwd(files);
        try {
            const ap = getArtifactPaths(cwd, runId);
            fs.mkdirSync(ap.planDir, { recursive: true });
            fs.writeFileSync(ap.plan, `# Plan\n\n${planBody}`);
            fn(checkPlanVerificationGate(cwd, runId));
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    }

    const expressDeps = {
        "package.json": JSON.stringify({ name: "t", dependencies: { express: "^4.0.0" } }),
    };

    it("blocks when a framework is detected but the plan has no ## Framework field", () => {
        withGate(expressDeps, VALID_MANIFEST_AND_VERIFICATION, (gate) => {
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("Framework lock missing"));
            assert.ok(gate.reason.includes("express"));
        });
    });

    it("blocks when the manifest says `none` but a framework is detected", () => {
        withGate(expressDeps, `## Framework\n\nnone\n\n${VALID_MANIFEST_AND_VERIFICATION}`, (gate) => {
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("contradiction"));
        });
    });

    it("blocks when the manifest records a different framework than detected", () => {
        withGate(expressDeps, `## Framework\n\nnextjs\n\n${VALID_MANIFEST_AND_VERIFICATION}`, (gate) => {
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("contradiction"));
            assert.ok(gate.reason.includes("`nextjs`"));
            assert.ok(gate.reason.includes("express"));
        });
    });

    it("blocks on an unknown framework id even when nothing is detected", () => {
        withGate({}, `## Framework\n\nmade-up-fw\n\n${VALID_MANIFEST_AND_VERIFICATION}`, (gate) => {
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("unknown framework id"));
        });
    });

    it("passes when the manifest records the detected framework", () => {
        withGate(expressDeps, `## Framework\n\nexpress\n\n${VALID_MANIFEST_AND_VERIFICATION}`, (gate) => {
            assert.strictEqual(gate.blocked, false);
            assert.strictEqual(gate.reason, null);
        });
    });

    it("passes with `none` when nothing is detected and the tech stack names no framework", () => {
        withGate({}, `## Framework\n\nnone\n\n${VALID_MANIFEST_AND_VERIFICATION}`, (gate) => {
            assert.strictEqual(gate.blocked, false);
            assert.strictEqual(gate.reason, null);
        });
    });

    it("passes with no ## Framework field when nothing is detected (framework optional)", () => {
        withGate({}, VALID_MANIFEST_AND_VERIFICATION, (gate) => {
            assert.strictEqual(gate.blocked, false);
            assert.strictEqual(gate.reason, null);
        });
    });

    it("blocks when the plan's ## Tech Stack names a framework the manifest contradicts", () => {
        const plan = `## Tech Stack\n\n- TypeScript, Next.js, PostgreSQL\n\n## Framework\n\nexpress\n\n${VALID_MANIFEST_AND_VERIFICATION}`;
        withGate({}, plan, (gate) => {
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("contradiction"));
            assert.ok(gate.reason.includes("nextjs"));
        });
    });

    it("passes when the plan's ## Tech Stack and the manifest agree", () => {
        const plan = `## Tech Stack\n\n- TypeScript, Next.js\n\n## Framework\n\nnextjs\n\n${VALID_MANIFEST_AND_VERIFICATION}`;
        withGate({}, plan, (gate) => {
            assert.strictEqual(gate.blocked, false);
            assert.strictEqual(gate.reason, null);
        });
    });

    it("blocks when the tech stack names a framework and the field is missing", () => {
        const plan = `## Tech Stack\n\n- Python, Django\n\n${VALID_MANIFEST_AND_VERIFICATION}`;
        withGate({}, plan, (gate) => {
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("Framework lock missing"));
            assert.ok(gate.reason.includes("django"));
        });
    });
});

describe("checkPlanVerificationGate — chirpi framework lock file", () => {
    const runId = "2099-01-01-00-00-fwlock";

    const VALID_MANIFEST_AND_VERIFICATION =
        "## Files\n\n| path | layer | action | reason |\n| --- | --- | --- | --- |\n| src/a.ts | core | create | x |\n\n## Verification\n\n1. npm test\n";

    function lockFile(id: string): Record<string, string> {
        return {
            ".pi/senai/framework.json": JSON.stringify({ id, source: "manual", setAt: new Date().toISOString() }),
        };
    }

    function withGate(
        files: Record<string, string>,
        planBody: string,
        fn: (gate: { blocked: boolean; reason: string | null }) => void,
    ) {
        const cwd = makeCwd(files);
        try {
            const ap = getArtifactPaths(cwd, runId);
            fs.mkdirSync(ap.planDir, { recursive: true });
            fs.writeFileSync(ap.plan, `# Plan\n\n${planBody}`);
            fn(checkPlanVerificationGate(cwd, runId));
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    }

    it("passes when the plan records the locked framework", () => {
        withGate(lockFile("express"), `## Framework\n\nexpress\n\n${VALID_MANIFEST_AND_VERIFICATION}`, (gate) => {
            assert.strictEqual(gate.blocked, false);
            assert.strictEqual(gate.reason, null);
        });
    });

    it("blocks when the plan records a different framework than the lock", () => {
        withGate(lockFile("express"), `## Framework\n\nnextjs\n\n${VALID_MANIFEST_AND_VERIFICATION}`, (gate) => {
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("Framework lock mismatch"));
            assert.ok(gate.reason.includes("framework.json"));
            assert.ok(gate.reason.includes("`express`"));
            assert.ok(gate.reason.includes("`nextjs`"));
        });
    });

    it("blocks when a framework is locked but the plan has no ## Framework field", () => {
        withGate(lockFile("express"), VALID_MANIFEST_AND_VERIFICATION, (gate) => {
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("Framework lock missing"));
            assert.ok(gate.reason.includes("framework.json"));
            assert.ok(gate.reason.includes("`express`"));
        });
    });

    it("blocks when the lock is `none` but the plan names a framework", () => {
        withGate(lockFile("none"), `## Framework\n\nexpress\n\n${VALID_MANIFEST_AND_VERIFICATION}`, (gate) => {
            assert.strictEqual(gate.blocked, true);
            assert.ok(gate.reason && gate.reason.includes("Framework lock mismatch"));
            assert.ok(gate.reason.includes("`none`"));
        });
    });

    it("passes when the lock is `none` and the plan records `none`", () => {
        withGate(lockFile("none"), `## Framework\n\nnone\n\n${VALID_MANIFEST_AND_VERIFICATION}`, (gate) => {
            assert.strictEqual(gate.blocked, false);
            assert.strictEqual(gate.reason, null);
        });
    });

    it("a malformed lock file never crashes the gate — it is ignored", () => {
        withGate(
            { ".pi/senai/framework.json": "{ not json" },
            VALID_MANIFEST_AND_VERIFICATION,
            (gate) => {
                assert.strictEqual(gate.blocked, false);
                assert.strictEqual(gate.reason, null);
            },
        );
    });
});
