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
  normalizeConstraintItem,
  normalizeDriverItem,
  normalizeDrivers,
  normalizeQualityAttributeItem,
  saveDrivers,
  validateDrivers,
} from "../src/driver-extractor.js";
import type { ArchitecturalDrivers } from "../src/driver-extractor.js";

describe("driver-extractor", () => {
  it("getDriversPath returns correct path", () => {
    assert.strictEqual(
      getDriversPath("/fake"),
      path.join("/fake", ".pi/architect/architectural-drivers.json"),
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

  it("validateDrivers rejects empty id or description", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ id: "", description: "X" } as any);
    assert.throws(() => validateDrivers(drivers), /id/);

    const drivers2 = createEmptyDrivers();
    drivers2.functionalRequirements.push({ id: "FR-1", description: "  " } as any);
    assert.throws(() => validateDrivers(drivers2), /description/);
  });

  it("validateDrivers rejects numeric or null items", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push(123 as any);
    assert.throws(() => validateDrivers(drivers), /must be a string or a valid driver object/);

    const drivers2 = createEmptyDrivers();
    drivers2.functionalRequirements.push(null as any);
    assert.throws(() => validateDrivers(drivers2), /must be a string or a valid driver object/);
  });

  it("validateDrivers reports missing id with array and index", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ description: "Missing id" } as any);
    assert.throws(() => validateDrivers(drivers), /functionalRequirements\[0\].*id/);
  });

  it("validateDrivers reports missing description with array and index", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ id: "FR-1" } as any);
    assert.throws(() => validateDrivers(drivers), /functionalRequirements\[0\].*description/);
  });

  it("validateDrivers rejects constraints missing category", () => {
    const drivers = createEmptyDrivers();
    drivers.constraints.push({ id: "C-1", description: "No category" } as any);
    assert.throws(() => validateDrivers(drivers), /constraints\[0\].*category/);
  });

  it("validateDrivers rejects quality attributes missing category", () => {
    const drivers = createEmptyDrivers();
    drivers.qualityAttributes.push({ id: "QA-1", description: "No category" } as any);
    assert.throws(() => validateDrivers(drivers), /qualityAttributes\[0\].*category/);
  });

  it("validateDrivers accepts valid items with optional source", () => {
    const drivers: ArchitecturalDrivers = {
      functionalRequirements: [{ id: "FR-1", description: "Do X", source: "docs/PRD.md" }],
      qualityAttributes: [{ id: "QA-1", category: "scale", description: "Scale" }],
      constraints: [{ id: "C-1", category: "platform", description: "Cloud" }],
      technicalConcerns: [{ id: "TC-1", description: "Web" }],
      uncertainties: ["U1"],
    };
    assert.doesNotThrow(() => validateDrivers(drivers));
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

  it("findDriverGaps flags missing functional, deployment, and project-type gaps", () => {
    const drivers = createEmptyDrivers();
    drivers.qualityAttributes.push({ id: "QA-1", category: "security", description: "Secure" });
    const gaps = findDriverGaps(drivers);
    assert.ok(gaps.some((g) => g.category === "functional"));
    assert.ok(gaps.some((g) => g.category === "scale"));
    assert.ok(gaps.some((g) => g.category === "deployment"));
    assert.ok(gaps.some((g) => g.category === "project-type"));
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

  it("normalizeQualityAttributeItem requires category and valid base", () => {
    assert.ok(normalizeQualityAttributeItem({ id: "QA-1", category: "scale", description: "Scale" }));
    assert.strictEqual(normalizeQualityAttributeItem({ id: "QA-1", description: "Scale" }), null);
    assert.strictEqual(normalizeQualityAttributeItem({ category: "scale", description: "Scale" }), null);
    assert.strictEqual(normalizeQualityAttributeItem({ id: "QA-1", category: "", description: "Scale" }), null);
  });

  it("normalizeConstraintItem requires category and valid base", () => {
    assert.ok(normalizeConstraintItem({ id: "C-1", category: "platform", description: "Cloud" }));
    assert.strictEqual(normalizeConstraintItem({ id: "C-1", description: "Cloud" }), null);
    assert.strictEqual(normalizeConstraintItem({ category: "platform", description: "Cloud" }), null);
  });

  it("normalizeDrivers drops invalid items and keeps valid ones", () => {
    const drivers = {
      functionalRequirements: [
        { id: "FR-1", description: "Valid" },
        { description: "Missing id" },
        { id: "", description: "Empty id" },
        { id: "FR-2", description: "" },
      ],
      qualityAttributes: [{ id: "QA-1", category: "scale", description: "Scale" }],
      constraints: [{ driver: "C-1", category: "platform", description: "Cloud" }],
      technicalConcerns: [{ name: "TC-1", description: "Web" }],
      uncertainties: ["U1", "", 123 as any],
    };
    const normalized = normalizeDrivers(drivers);
    assert.ok(normalized);
    assert.strictEqual(normalized!.functionalRequirements.length, 1);
    assert.strictEqual(normalized!.functionalRequirements[0].id, "FR-1");
    assert.strictEqual(normalized!.qualityAttributes.length, 1);
    assert.strictEqual(normalized!.constraints[0].id, "C-1");
    assert.strictEqual(normalized!.technicalConcerns[0].id, "TC-1");
    assert.deepStrictEqual(normalized!.uncertainties, ["U1"]);
  });

  it("loadDrivers throws on malformed JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-drivers-bad-json-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), "{ not valid", "utf8");
    assert.throws(() => loadDrivers(tmpDir), /Invalid architectural drivers/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadDrivers tolerates legacy flat driver file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-drivers-legacy-"));
    const legacy = {
      drivers: [
        { id: "FR-1", category: "functional", name: "Daily Trigger", description: "Run daily" },
      ],
    };
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"), JSON.stringify(legacy), "utf8");

    const loaded = loadDrivers(tmpDir);
    assert.ok(loaded);
    assert.strictEqual(loaded!.functionalRequirements.length, 1);
    assert.strictEqual(loaded!.functionalRequirements[0].id, "FR-1");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("normalizeDriverItem maps driver field to id", () => {
    const item = normalizeDriverItem({ driver: "Daily Trigger", description: "Run daily" });
    assert.ok(item);
    assert.strictEqual(item!.id, "Daily Trigger");
    assert.strictEqual(item!.description, "Run daily");
  });

  it("normalizeDriverItem falls back to name field", () => {
    const item = normalizeDriverItem({ name: "Backup", description: "Run backup" });
    assert.ok(item);
    assert.strictEqual(item!.id, "Backup");
  });

  it("normalizeDriverItem returns null when description or id is missing", () => {
    assert.strictEqual(normalizeDriverItem({ id: "X" }), null);
    assert.strictEqual(normalizeDriverItem({ description: "Y" }), null);
    assert.strictEqual(normalizeDriverItem({ driver: "", description: "Y" }), null);
  });

  it("normalizeDrivers normalizes standard schema with driver field", () => {
    const drivers = {
      functionalRequirements: [{ driver: "FR-1", description: "Do X" }],
      qualityAttributes: [{ driver: "QA-1", category: "scale", description: "Scale" }],
      constraints: [{ driver: "C-1", category: "platform", description: "Cloud" }],
      technicalConcerns: [{ driver: "TC-1", description: "Web" }],
      uncertainties: ["U1"],
    };
    const normalized = normalizeDrivers(drivers);
    assert.ok(normalized);
    assert.strictEqual(normalized!.functionalRequirements[0].id, "FR-1");
    assert.strictEqual(normalized!.qualityAttributes[0].id, "QA-1");
    assert.strictEqual(normalized!.constraints[0].id, "C-1");
    assert.strictEqual(normalized!.technicalConcerns[0].id, "TC-1");
  });
});
