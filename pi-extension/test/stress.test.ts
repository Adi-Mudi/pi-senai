import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { guardSpawnCall } from "../src/spawn-guard.js";
import {
  completionWarning,
  recordSpawnArtifacts,
  resetCompletionGuard,
} from "../src/completion-guard.js";
import { saveAgentConfig } from "../src/agent-config.js";
import { SENAI_ROLES, DEFAULT_AGENTS } from "../src/agent-suggestions.js";
import { defaultState, saveState } from "../src/state.js";
import { runSenaiDiagnostic } from "../src/doctor.js";
import { buildDocWritePlan, generateDocsStructure } from "../src/doc-selection.js";
import { DOC_TYPES, isDocStub, renderTemplateStub, type DocTypeId } from "../src/doc-catalog.js";
import { listMissingStageArtifacts } from "../src/commands.js";
import { makeRunId } from "../src/constants.js";
import { saveArchitectProfile } from "../src/architect.js";
import { createHash } from "node:crypto";

/**
 * Stress tests for the hot paths added with the spawn guard and the doctor
 * run-artifact audit. The guard hook runs on EVERY tool call during an active
 * run, and the audit scans run artifacts — both must stay fast and correct
 * under volume.
 *
 * Correctness is asserted strictly. Timing bounds are generous (well above
 * the expected real time) so the suite never goes flaky; the actual timings
 * are printed so regressions are visible in the output.
 */

const GENEROUS_GUARD_BUDGET_MS = 10_000;
const GENEROUS_DOCTOR_BUDGET_MS = 60_000;
const GENEROUS_MISC_BUDGET_MS = 30_000;

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(cwd: string, relPath: string, content = ""): void {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

const PLAN_ARTIFACTS = [
  "plan/plan.md",
  "plan/plan-overview.md",
  "plan/discussion-notes.md",
  "plan/scouts/scout-angle_1.md",
  "plan/scouts/scout-angle_2.md",
  "plan/scouts/scout-angle_3.md",
  "plan/scouts/scout-angle_4.md",
  "plan/reviews/review-correctness.md",
  "plan/reviews/review-security.md",
  "plan/reviews/review-tests.md",
];

describe("guardSpawnCall stress", () => {
  it("10,000 mixed calls stay correct and fast", () => {
    const cwd = makeTmp("stress-guard-mixed-");
    saveState(cwd, { ...defaultState(), currentStage: "planning", runId: "r1" });
    saveAgentConfig(cwd, {
      version: 1,
      agents: {
        planner: "proj-arch-planner",
        discussion: "proj-arch-planner",
        "scout-2": "proj-scout-2",
      },
    });

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      switch (i % 4) {
        case 0: {
          const r = guardSpawnCall("subagent", { agent: "planner" }, cwd);
          assert.ok(r?.block, `call ${i}: bare planner must be blocked`);
          assert.ok(r.reason.includes("proj-arch-planner"));
          break;
        }
        case 1:
          assert.strictEqual(
            guardSpawnCall("subagent", { agent: "proj-arch-planner" }, cwd),
            undefined,
            `call ${i}: mapped name must pass`,
          );
          break;
        case 2:
          assert.strictEqual(
            guardSpawnCall("bash", { command: "ls" }, cwd),
            undefined,
            `call ${i}: non-guarded tool must pass`,
          );
          break;
        default:
          assert.ok(
            guardSpawnCall("subagent", {}, cwd)?.block,
            `call ${i}: missing agent must be blocked`,
          );
      }
    }
    const elapsed = performance.now() - start;
    console.log(
      `guardSpawnCall: 10,000 mixed calls in ${elapsed.toFixed(0)} ms ` +
        `(${(elapsed / 10_000).toFixed(3)} ms/call)`,
    );
    assert.ok(
      elapsed < GENEROUS_GUARD_BUDGET_MS,
      `10k guard calls took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_GUARD_BUDGET_MS} ms)`,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("max realistic config (every role custom-mapped) stays correct and fast", () => {
    const cwd = makeTmp("stress-guard-maxcfg-");
    saveState(cwd, { ...defaultState(), currentStage: "planning", runId: "r1" });
    const agents: Record<string, string> = {};
    for (const role of SENAI_ROLES) agents[role] = `proj-arch-${role}`;
    saveAgentConfig(cwd, { version: 1, agents });

    const start = performance.now();
    // 5,000 allowed spawns of exact mapped names.
    for (let i = 0; i < 5_000; i++) {
      const role = SENAI_ROLES[i % SENAI_ROLES.length];
      assert.strictEqual(
        guardSpawnCall("subagent", { agent: `proj-arch-${role}` }, cwd),
        undefined,
        `mapped name for ${role} must pass`,
      );
    }
    // 5,000 blocked spawns of bare role / built-in names.
    const bareNames = [...SENAI_ROLES, ...new Set(Object.values(DEFAULT_AGENTS))];
    for (let i = 0; i < 5_000; i++) {
      const bare = bareNames[i % bareNames.length];
      const r = guardSpawnCall("subagent", { agent: bare }, cwd);
      assert.ok(r?.block, `bare name ${bare} must be blocked with full mapping`);
      assert.ok(r.reason.includes("proj-arch-"), "reason names a mapped agent");
    }
    const elapsed = performance.now() - start;
    console.log(
      `guardSpawnCall: 10,000 max-config calls in ${elapsed.toFixed(0)} ms ` +
        `(${(elapsed / 10_000).toFixed(3)} ms/call)`,
    );
    assert.ok(
      elapsed < GENEROUS_GUARD_BUDGET_MS,
      `10k max-config guard calls took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_GUARD_BUDGET_MS} ms)`,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("1,000 calls with corrupt state.json step aside every time and never throw", () => {
    const cwd = makeTmp("stress-guard-corrupt-");
    fs.mkdirSync(path.join(cwd, ".IDE_Plans", "senai"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".IDE_Plans", "senai", "state.json"),
      "{not json",
      "utf8",
    );

    const start = performance.now();
    for (let i = 0; i < 1_000; i++) {
      assert.strictEqual(
        guardSpawnCall("subagent", { agent: "planner" }, cwd),
        undefined,
        `call ${i}: corrupt state must step aside`,
      );
    }
    const elapsed = performance.now() - start;
    console.log(`guardSpawnCall: 1,000 corrupt-state calls in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      elapsed < GENEROUS_GUARD_BUDGET_MS,
      `1k corrupt-state calls took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_GUARD_BUDGET_MS} ms)`,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("doctor run-audit stress", () => {
  function findAuditSection(report: ReturnType<typeof runSenaiDiagnostic>) {
    const section = report.sections.find((s) => s.title === "Run artifacts");
    assert.ok(section, "Run artifacts section must exist");
    return section;
  }

  it("25 full diagnostics over an active run stay clean and fast", () => {
    const cwd = makeTmp("stress-doctor-repeat-");
    saveState(cwd, { ...defaultState(), currentStage: "planning", runId: "r1" });
    for (const rel of PLAN_ARTIFACTS) {
      writeFile(cwd, `.IDE_Plans/senai/runs/r1/${rel}`, "content");
    }

    const start = performance.now();
    for (let i = 0; i < 25; i++) {
      const section = findAuditSection(runSenaiDiagnostic(cwd));
      const fails = section.items.filter((item) => item.status === "error");
      assert.strictEqual(fails.length, 0, `diagnostic ${i}: audit must be clean`);
    }
    const elapsed = performance.now() - start;
    console.log(
      `doctor: 25 full diagnostics in ${elapsed.toFixed(0)} ms ` +
        `(${(elapsed / 25).toFixed(0)} ms/run)`,
    );
    assert.ok(
      elapsed < GENEROUS_DOCTOR_BUDGET_MS,
      `25 diagnostics took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_DOCTOR_BUDGET_MS} ms)`,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("100 old run folders on disk do not slow or confuse the audit", () => {
    const cwd = makeTmp("stress-doctor-manyruns-");
    for (let i = 0; i < 100; i++) {
      writeFile(cwd, `.IDE_Plans/senai/runs/old-run-${i}/plan/plan.md`, "stale");
    }
    saveState(cwd, { ...defaultState(), currentStage: "implementing", runId: "active-run" });
    for (const rel of PLAN_ARTIFACTS) {
      writeFile(cwd, `.IDE_Plans/senai/runs/active-run/${rel}`, "content");
    }

    const start = performance.now();
    const section = findAuditSection(runSenaiDiagnostic(cwd));
    const elapsed = performance.now() - start;
    console.log(`doctor: audit with 100 sibling run folders in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      section.items.some(
        (item) => item.status === "ok" && item.message.includes("All 10 plan-stage artifacts"),
      ),
      "audit reports the active run clean despite 100 stale siblings",
    );
    assert.ok(
      !section.items.some((item) => item.message.includes("old-run-")),
      "audit never mentions sibling runs",
    );
    assert.ok(
      elapsed < 30_000,
      `audit with 100 sibling runs took ${elapsed.toFixed(0)} ms (budget 30000 ms)`,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("mixed present/zero-byte/missing artifacts give identical output across 10 runs", () => {
    const cwd = makeTmp("stress-doctor-determinism-");
    // 'delivered' audits both the plan list and the deliver list.
    saveState(cwd, { ...defaultState(), currentStage: "delivered", runId: "r1" });
    // 5 plan artifacts with content, 5 zero-byte, deliver artifacts missing.
    PLAN_ARTIFACTS.forEach((rel, i) => {
      writeFile(cwd, `.IDE_Plans/senai/runs/r1/${rel}`, i < 5 ? "content" : "");
    });

    let first: string | undefined;
    for (let i = 0; i < 10; i++) {
      const section = findAuditSection(runSenaiDiagnostic(cwd));
      const snapshot = JSON.stringify(section.items);
      if (first === undefined) {
        first = snapshot;
        // Sanity: zero-byte plan files and missing deliver files must be
        // flagged (warnings for zero-byte, errors for the missing deliver
        // artifacts since the run-audit strictness pass).
        const flagged = section.items.filter(
          (item) => item.status === "warning" || item.status === "error",
        );
        assert.ok(flagged.length >= 2, "zero-byte and missing artifacts must be flagged");
        assert.ok(
          flagged.some((item) => item.details?.includes("deliver/security-report.md")),
          "missing deliver artifacts are named",
        );
      } else {
        assert.strictEqual(snapshot, first, `diagnostic ${i}: output must be deterministic`);
      }
    }
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("completion-guard stress", () => {
  it("2,000 spawns + 2,000 completions: every decision correct", () => {
    const cwd = makeTmp("stress-cguard-volume-");
    resetCompletionGuard();
    saveState(cwd, { ...defaultState(), currentStage: "planning", runId: "r1" });

    const start = performance.now();
    for (let i = 0; i < 2_000; i++) {
      const name = `agent-${i}`;
      const rel = `.IDE_Plans/senai/runs/r1/plan/scouts/scout-angle_${i}.md`;
      recordSpawnArtifacts("subagent", { name, task: `Write ${rel}` }, cwd);
      if (i % 2 === 0) {
        writeFile(cwd, rel, "content"); // even i: artifact written
      }
      const warning = completionWarning(`Sub-agent "${name}" completed (1s).`, cwd);
      if (i % 2 === 0) {
        assert.strictEqual(warning, undefined, `agent ${i}: artifact written, no warning`);
      } else {
        assert.ok(warning, `agent ${i}: artifact missing, warning expected`);
        assert.ok(warning.includes(`scout-angle_${i}.md`), `agent ${i}: warning names its artifact`);
      }
    }
    const elapsed = performance.now() - start;
    console.log(`completion-guard: 2,000 spawn+completion pairs in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      elapsed < GENEROUS_GUARD_BUDGET_MS,
      `2k pairs took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_GUARD_BUDGET_MS} ms)`,
    );
    resetCompletionGuard();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("1,000 cycles with corrupt state.json never throw and always step aside", () => {
    const cwd = makeTmp("stress-cguard-corrupt-");
    resetCompletionGuard();
    fs.mkdirSync(path.join(cwd, ".IDE_Plans", "senai"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".IDE_Plans", "senai", "state.json"), "{not json", "utf8");

    const start = performance.now();
    for (let i = 0; i < 1_000; i++) {
      recordSpawnArtifacts(
        "subagent",
        { name: `agent-${i}`, task: `Write .IDE_Plans/senai/runs/r1/plan/scouts/scout-angle_${i}.md` },
        cwd,
      );
      assert.strictEqual(
        completionWarning(`Sub-agent "agent-${i}" completed (1s).`, cwd),
        undefined,
        `cycle ${i}: corrupt state must step aside`,
      );
    }
    const elapsed = performance.now() - start;
    console.log(`completion-guard: 1,000 corrupt-state cycles in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      elapsed < GENEROUS_GUARD_BUDGET_MS,
      `1k corrupt cycles took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_GUARD_BUDGET_MS} ms)`,
    );
    resetCompletionGuard();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("doc-selection stress", () => {
  it("500-file project x 500 iterations: deterministic identical output", () => {
    const cwd = makeTmp("stress-docsel-");
    for (let i = 0; i < 500; i++) {
      writeFile(cwd, `src/module${String(i).padStart(3, "0")}.ts`, "// noise");
    }
    writeFile(cwd, "package.json", JSON.stringify({ name: "demo", version: "1.0.0", main: "dist/index.js" }));
    writeFile(cwd, "CONTRIBUTING.md", "# Contributing\n");
    saveArchitectProfile(cwd, {
      projectName: "Demo",
      projectSlug: "demo",
      selectedArchitecture: "gas-monolith",
    } as Parameters<typeof saveArchitectProfile>[1]);

    const start = performance.now();
    const first = JSON.stringify(buildDocWritePlan(cwd));
    assert.strictEqual(JSON.parse(first).tasks.length, 5, "all five signals selected");
    for (let i = 0; i < 499; i++) {
      assert.strictEqual(JSON.stringify(buildDocWritePlan(cwd)), first, `iteration ${i}: output must be identical`);
    }
    const elapsed = performance.now() - start;
    console.log(`buildDocWritePlan: 500 iterations over a 500-file project in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      elapsed < GENEROUS_MISC_BUDGET_MS,
      `500 iterations took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_MISC_BUDGET_MS} ms)`,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("doc-catalog stress", () => {
  it("9 templates x 1,000 renders: all pass isDocStub, required sections, and caps", () => {
    const start = performance.now();
    const ids = Object.keys(DOC_TYPES) as DocTypeId[];
    assert.strictEqual(ids.length, 9, "catalog has 9 templates");
    for (let r = 0; r < 1_000; r++) {
      for (const id of ids) {
        const spec = DOC_TYPES[id];
        const stub = renderTemplateStub(id);
        assert.ok(isDocStub(stub), `${id} render ${r}: must be a stub`);
        for (const section of spec.requiredSections) {
          assert.ok(stub.includes(section), `${id} render ${r}: contains ${section}`);
        }
        assert.ok(
          stub.split("\n").length <= spec.maxLines,
          `${id} render ${r}: within ${spec.maxLines}-line cap`,
        );
      }
    }
    const elapsed = performance.now() - start;
    console.log(`renderTemplateStub: 9,000 renders in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      elapsed < GENEROUS_MISC_BUDGET_MS,
      `9k renders took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_MISC_BUDGET_MS} ms)`,
    );
  });
});

describe("generateDocsStructure stress", () => {
  it("50 consecutive runs: kept set identical, non-stub bytes never change", () => {
    const cwd = makeTmp("stress-docstruct-");
    writeFile(cwd, "package.json", JSON.stringify({ name: "demo", version: "1.0.0", main: "dist/index.js" }));
    writeFile(cwd, "README.md", "# My real README\n\nHand-written.\n");
    const readmeHash = createHash("sha256")
      .update(fs.readFileSync(path.join(cwd, "README.md")))
      .digest("hex");

    const start = performance.now();
    let keptFirst: string | undefined;
    let manifestFirst: string | undefined;
    for (let i = 0; i < 50; i++) {
      const result = generateDocsStructure(cwd);
      assert.deepStrictEqual(result.kept, ["README.md"], `run ${i}: real README always kept`);
      const keptSnap = JSON.stringify(result.kept);
      if (keptFirst === undefined) keptFirst = keptSnap;
      assert.strictEqual(keptSnap, keptFirst, `run ${i}: kept set identical`);

      const manifestBytes = fs.readFileSync(result.manifestPath, "utf8");
      if (manifestFirst === undefined) manifestFirst = manifestBytes;
      assert.strictEqual(manifestBytes, manifestFirst, `run ${i}: manifest bytes identical`);

      const hash = createHash("sha256")
        .update(fs.readFileSync(path.join(cwd, "README.md")))
        .digest("hex");
      assert.strictEqual(hash, readmeHash, `run ${i}: non-stub README bytes unchanged`);
    }
    const elapsed = performance.now() - start;
    console.log(`generateDocsStructure: 50 idempotent runs in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      elapsed < GENEROUS_MISC_BUDGET_MS,
      `50 runs took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_MISC_BUDGET_MS} ms)`,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("approve verification stress", () => {
  it("100 sibling run folders x 100 iterations: exact labels every time", () => {
    const cwd = makeTmp("stress-approveverify-");
    for (let i = 0; i < 100; i++) {
      writeFile(cwd, `.IDE_Plans/senai/runs/old-run-${i}/plan/plan.md`, "stale");
    }
    // The active run exists but has NO artifacts written.
    fs.mkdirSync(path.join(cwd, ".IDE_Plans", "senai", "runs", "active-run"), { recursive: true });

    const expected: Record<string, string[]> = {
      plan: [
        "plan/plan.md",
        "plan/scouts/scout-angle_1.md",
        "plan/scouts/scout-angle_2.md",
        "plan/scouts/scout-angle_3.md",
        "plan/scouts/scout-angle_4.md",
      ],
      implement: ["implement/ (no files)"],
      document: ["document/ (no files)"],
      deliver: ["deliver/security-report.md", "deliver/deliver-summary.md"],
    };

    const start = performance.now();
    const stages = ["plan", "implement", "document", "deliver"] as const;
    for (let i = 0; i < 100; i++) {
      for (const stage of stages) {
        assert.deepStrictEqual(
          listMissingStageArtifacts(cwd, "active-run", stage),
          expected[stage],
          `iteration ${i} stage ${stage}: exact labels, siblings ignored`,
        );
      }
    }
    const elapsed = performance.now() - start;
    console.log(`listMissingStageArtifacts: 400 calls with 100 sibling runs in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      elapsed < GENEROUS_MISC_BUDGET_MS,
      `400 calls took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_MISC_BUDGET_MS} ms)`,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("makeRunId stress", () => {
  it("10,000 pathological missions: format holds, slug <= 40, no hex/UUID residue", () => {
    const pool = [
      "C:\\Users\\foo\\bar fix",
      "D:/work/temp/logs cleanup",
      "/tmp/pi-clipboard-cbcbf548-849e-4918-a927-x/y fix",
      "cbcbf548-849e-4918-a927-2f9e0c1d3b4a",
      "fix cbcbf548-849e-4918-a927-2f9e0c1d3b4a now",
      "deadbeefdeadbeefdeadbeef12 noise",
      "a".repeat(200),
      "日本語のみ",
      "./relative",
      "",
      "!!!",
      "Feature @ #1: API & Auth!!!",
      "q1 /tmp/pi-clipboard-cbcbf548-849e-4918-a927-x/y fix",
      "x".repeat(39) + "!bbbb",
    ];
    const FORMAT = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-[a-z0-9-]+$/;
    const UUID_FRAGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/;
    const LONG_HEX_WITH_DIGIT = /(^|-)(?=[0-9a-f]*[0-9])[0-9a-f]{16,}(-|$)/;

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const mission = pool[i % pool.length];
      const runId = makeRunId(mission);
      assert.ok(FORMAT.test(runId), `mission ${i}: format broken for ${JSON.stringify(mission)} -> ${runId}`);
      const slug = runId.split("-").slice(5).join("-");
      assert.ok(slug.length <= 40, `mission ${i}: slug ${slug.length} chars > 40`);
      assert.ok(slug.length > 0, `mission ${i}: slug never empty (run fallback)`);
      assert.ok(!UUID_FRAGMENT.test(slug), `mission ${i}: UUID residue in ${slug}`);
      assert.ok(!LONG_HEX_WITH_DIGIT.test(slug), `mission ${i}: hex residue in ${slug}`);
    }
    const elapsed = performance.now() - start;
    console.log(`makeRunId: 10,000 pathological missions in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      elapsed < GENEROUS_GUARD_BUDGET_MS,
      `10k makeRunId calls took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_GUARD_BUDGET_MS} ms)`,
    );
  });
});

describe("doctor docs-factory stress", () => {
  it("200 filled docs (100 over cap, 100 missing sections): every violation reported exactly once, deterministic x10", () => {
    const cwd = makeTmp("stress-docfactory-");
    const targets: Array<{ path: string; docType: string; maxLines: number }> = [];

    // 100 over-cap explanation docs (no required sections, 150-line cap).
    const overLines = ["# Topic", ""];
    while (overLines.length < 152) overLines.push(`filler ${overLines.length}`);
    for (let i = 0; i < 100; i++) {
      const rel = `docs/explanation/over-${String(i).padStart(3, "0")}.md`;
      writeFile(cwd, rel, overLines.join("\n"));
      targets.push({ path: rel, docType: "explanation", maxLines: 150 });
    }
    // 100 ADR docs missing ## Decision (well under the 120-line cap).
    const adrBody = "# Use X\n\n## Status\n\naccepted\n\n## Context\n\nBecause.\n\n## Consequences\n\nFine.\n";
    for (let i = 0; i < 100; i++) {
      const rel = `docs/adr/missing-${String(i).padStart(3, "0")}.md`;
      writeFile(cwd, rel, adrBody);
      targets.push({ path: rel, docType: "adr", maxLines: 120 });
    }
    writeFile(cwd, ".pi/senai/docs-structure.json", JSON.stringify({ version: 1, targets }));

    const start = performance.now();
    let first: string | undefined;
    for (let run = 0; run < 10; run++) {
      const report = runSenaiDiagnostic(cwd);
      const section = report.sections.find((s) => s.title === "Documentation factory");
      assert.ok(section, "Documentation factory section must exist");
      const snapshot = JSON.stringify(section.items);
      if (first === undefined) {
        first = snapshot;
        const warnings = section.items.filter((i) => i.status === "warning");
        assert.strictEqual(warnings.length, 200, "exactly 200 violations");
        assert.strictEqual(
          warnings.filter((i) => i.message.includes("over the 150-line cap")).length,
          100,
          "100 over-cap warnings",
        );
        assert.strictEqual(
          warnings.filter((i) => i.message.includes('missing required section "## Decision"')).length,
          100,
          "100 missing-section warnings",
        );
        // Every violating file is named in exactly one warning.
        const named = warnings.map((i) => i.message.split(" ")[0]);
        assert.strictEqual(new Set(named).size, 200, "no duplicate reports");
        for (const t of targets) {
          assert.ok(named.includes(t.path), `${t.path} reported`);
        }
      } else {
        assert.strictEqual(snapshot, first, `run ${run}: output must be deterministic`);
      }
    }
    const elapsed = performance.now() - start;
    console.log(`doctor docs-factory: 200 violations x 10 deterministic runs in ${elapsed.toFixed(0)} ms`);
    assert.ok(
      elapsed < GENEROUS_DOCTOR_BUDGET_MS,
      `10 diagnostics took ${elapsed.toFixed(0)} ms (budget ${GENEROUS_DOCTOR_BUDGET_MS} ms)`,
    );
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
