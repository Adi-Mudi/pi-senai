import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createEmptyDrivers,
  findDriverGaps,
  getDriversPath,
  isCriticalDriverPresent,
  loadDrivers,
  mergeDrivers,
  normalizeDrivers,
  saveDrivers,
  validateDrivers,
} from "../src/driver-extractor.js";
import type { ArchitecturalDrivers } from "../src/driver-extractor.js";

describe("driver-extractor", () => {
  it("getDriversPath returns correct path", () => {
    assert.strictEqual(
      getDriversPath("/fake"),
      path.join("/fake", ".IDE_Plans/architect/architectural-drivers.json"),
    );
  });

  it("loadDrivers returns null when missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-drivers-"));
    assert.strictEqual(loadDrivers(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveDrivers and loadDrivers round-trip", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-drivers-"));
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ id: "FR-1", description: "Do X" });
    saveDrivers(tmpDir, drivers);
    const loaded = loadDrivers(tmpDir);
    assert.deepStrictEqual(loaded, drivers);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateDrivers accepts valid drivers", () => {
    assert.doesNotThrow(() => validateDrivers(createEmptyDrivers()));
  });

  it("validateDrivers rejects invalid shape", () => {
    assert.throws(() => validateDrivers({} as any), /functionalRequirements/);
  });

  it("findDriverGaps flags missing scale", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ id: "FR-1", description: "Do X" });
    const gaps = findDriverGaps(drivers);
    assert.ok(gaps.some((g) => g.category === "scale"));
  });

  it("findDriverGaps passes when critical drivers present", () => {
    const drivers: ArchitecturalDrivers = {
      functionalRequirements: [{ id: "FR-1", description: "Web app" }],
      qualityAttributes: [{ id: "QA-1", category: "scale", target: "100 users", description: "Scale" }],
      constraints: [{ id: "C-1", category: "platform", description: "Cloud deployment" }],
      technicalConcerns: [{ id: "TC-1", description: "Web application" }],
      uncertainties: [],
    };
    const gaps = findDriverGaps(drivers);
    assert.strictEqual(gaps.length, 0);
  });

  it("isCriticalDriverPresent checks specific category", () => {
    const drivers = createEmptyDrivers();
    drivers.qualityAttributes.push({ id: "QA-1", category: "scale", description: "Scale" });
    assert.strictEqual(isCriticalDriverPresent(drivers, "scale"), true);
    assert.strictEqual(isCriticalDriverPresent(drivers, "functional"), false);
  });

  it("mergeDrivers combines and deduplicates by id", () => {
    const a = createEmptyDrivers();
    a.functionalRequirements.push({ id: "FR-1", description: "A" });
    a.uncertainties.push("U1");

    const b = createEmptyDrivers();
    b.functionalRequirements.push({ id: "FR-1", description: "B" });
    b.functionalRequirements.push({ id: "FR-2", description: "C" });
    b.uncertainties.push("U1", "U2");

    const merged = mergeDrivers(a, b);
    assert.strictEqual(merged.functionalRequirements.length, 2);
    assert.deepStrictEqual(merged.uncertainties, ["U1", "U2"]);
  });
});

  it("normalizeDrivers converts legacy flat schema to standard schema", () => {
    const legacy = {
      version: 1,
      drivers: [
        { id: "FR-1", category: "functional", name: "Daily Trigger", description: "Run daily at 9 AM" },
        { id: "QA-1", category: "performance", name: "Fast load", description: "Load in <2s" },
        { id: "TC-1", category: "technical", name: "Web app", description: "Built as web app" },
        { id: "C-1", category: "platform", name: "Google Sheets", description: "Must use Google Sheets" },
      ],
      uncertainties: ["Quota limits"],
    };

    const normalized = normalizeDrivers(legacy);
    assert.ok(normalized);
    assert.strictEqual(normalized!.functionalRequirements.length, 1);
    assert.strictEqual(normalized!.qualityAttributes.length, 1);
    assert.strictEqual(normalized!.technicalConcerns.length, 1);
    assert.strictEqual(normalized!.constraints.length, 1);
    assert.deepStrictEqual(normalized!.uncertainties, ["Quota limits"]);
    assert.strictEqual(normalized!.functionalRequirements[0].id, "FR-1");
    assert.strictEqual(normalized!.functionalRequirements[0].description, "Run daily at 9 AM");
  });

  it("loadDrivers tolerates legacy flat driver file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-drivers-legacy-"));
    const legacy = {
      drivers: [
        { id: "FR-1", category: "functional", name: "Daily Trigger", description: "Run daily" },
      ],
    };
    fs.mkdirSync(path.join(tmpDir, ".IDE_Plans", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".IDE_Plans", "architect", "architectural-drivers.json"), JSON.stringify(legacy), "utf8");

    const loaded = loadDrivers(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded!.functionalRequirements.length, 1);
    assert.strictEqual(loaded!.functionalRequirements[0].id, "FR-1");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
