import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSenaiDiagnostic } from "../../src/doctor.js";
import {
  D_FLOOR_CLEAN,
  defaultCadenceState,
  loadCadenceState,
  record429,
  saveCadenceState,
} from "../../src/spawn-cadence.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("doctor — Spawn cadence section", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir("doctor-cadence-");
  });

  function findSection(report: ReturnType<typeof runSenaiDiagnostic>, title: string) {
    return report.sections.find((s) => s.title === title);
  }

  it("renders an ok section for the default (tier A, no errors) state", () => {
    // writeDefaultState may not be needed; the section reads the cadence file
    // directly. No file on disk → default state.
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Spawn cadence");
    assert.ok(section, "Spawn cadence section should exist");
    const okItems = section!.items.filter((i) => i.status === "ok");
    assert.ok(okItems.length >= 1, "should have at least one ok item");
    assert.ok(
      okItems.some((i) => i.message.includes("A (parallel burst)")),
      "should report tier A by default",
    );
    assert.ok(
      section!.items.some((i) => i.message.includes("Tier A is the ceiling")),
      "should explain the A ceiling",
    );
  });

  it("reports the current tier when state is non-default", () => {
    saveCadenceState(tmpDir, { ...defaultCadenceState(), tier: "B", consecutiveCleanRuns: 2 });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Spawn cadence")!;
    assert.ok(
      section.items.some((i) => i.message.includes("B (staggered)") && i.message.includes("2 clean runs")),
      "should report tier B with clean-run counter",
    );
  });

  it("warns when tier D has been stuck long enough to escape", () => {
    saveCadenceState(tmpDir, {
      ...defaultCadenceState(),
      tier: "D",
      consecutiveCleanRuns: D_FLOOR_CLEAN,
    });
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Spawn cadence")!;
    const warnItems = section.items.filter((i) => i.status === "warning");
    assert.ok(warnItems.length >= 1, "should have at least one warning item");
    assert.ok(
      warnItems.some((i) => i.message.includes("eligible to escape")),
      "should warn that D is eligible for reset",
    );
  });

  it("reports the last 429 timestamp and recent history entries", () => {
    record429(tmpDir);
    record429(tmpDir);
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Spawn cadence")!;
    assert.ok(
      section.items.some((i) => i.message.includes("Last rate-limit error")),
      "should report the last 429 timestamp",
    );
    assert.ok(
      section.items.some((i) => i.message.includes("Recent history")),
      "should show recent history entries",
    );
    assert.ok(
      section.items.some((i) => i.message.includes("→ B") || i.message.includes("\u2192 B")),
      "should include a demotion entry",
    );
  });

  it("places the Spawn cadence section between Lock state and Configuration files", () => {
    saveCadenceState(tmpDir, { ...defaultCadenceState(), tier: "A" });
    const report = runSenaiDiagnostic(tmpDir);
    const titles = report.sections.map((s) => s.title);
    const lockIdx = titles.indexOf("Lock state");
    const cadenceIdx = titles.indexOf("Spawn cadence");
    const configIdx = titles.indexOf("Configuration files");
    assert.ok(lockIdx >= 0 && cadenceIdx >= 0 && configIdx >= 0, "all three sections should exist");
    assert.ok(lockIdx < cadenceIdx, "Spawn cadence comes after Lock state");
    assert.ok(cadenceIdx < configIdx, "Spawn cadence comes before Configuration files");
  });

  it("does not lose data when the on-disk file is corrupt", () => {
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans", "pi-senai"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans", "pi-senai", "spawn-cadence.json"), "not json", "utf8");
    const report = runSenaiDiagnostic(tmpDir);
    const section = findSection(report, "Spawn cadence")!;
    assert.ok(section.items.some((i) => i.message.includes("A (parallel burst)")));
    // The corrupt file should be silently treated as default — loadCadenceState
    // does not throw and runSenaiDiagnostic completes.
    assert.ok(loadCadenceState(tmpDir).tier === "A");
  });
});
