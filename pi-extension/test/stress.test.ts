import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { guardSpawnCall } from "../src/spawn-guard.js";
import { saveAgentConfig } from "../src/agent-config.js";
import { SENAI_ROLES, DEFAULT_AGENTS } from "../src/agent-suggestions.js";
import { defaultState, saveState } from "../src/state.js";
import { runSenaiDiagnostic } from "../src/doctor.js";

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
        // Sanity: zero-byte plan files and missing deliver files must be flagged.
        const flagged = section.items.filter((item) => item.status === "warning");
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
