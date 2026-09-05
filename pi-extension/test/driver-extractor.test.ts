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
} from "../src/architect/drivers.js";
import type { ArchitecturalDrivers } from "../src/architect/drivers.js";

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

  it("normalizeDrivers returns null for non-object input", () => {
    assert.strictEqual(normalizeDrivers(null), null);
    assert.strictEqual(normalizeDrivers([1, 2, 3]), null);
    assert.strictEqual(normalizeDrivers("drivers"), null);
  });

  it("mergeDrivers deduplicates uncertainties and keeps order", () => {
    const a = { ...createEmptyDrivers(), uncertainties: ["U1", "U2"] };
    const b = { ...createEmptyDrivers(), uncertainties: ["U2", "U3"] };
    const merged = mergeDrivers(a, b);
    assert.deepStrictEqual(merged.uncertainties, ["U1", "U2", "U3"]);
  });

  it("loadDrivers returns null for valid JSON with the wrong shape", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drivers-shape-"));
    fs.mkdirSync(path.join(tmpDir, ".pi", "architect"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".pi", "architect", "architectural-drivers.json"),
      JSON.stringify({ foo: 1 }),
      "utf8",
    );
    assert.strictEqual(loadDrivers(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("findDriverGaps treats performance and scalability categories as scale coverage", () => {
    const performanceDrivers: ArchitecturalDrivers = {
      functionalRequirements: [{ id: "FR-1", description: "Do X" }],
      qualityAttributes: [{ id: "QA-1", category: "performance", description: "Fast" }],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    assert.ok(
      !findDriverGaps(performanceDrivers).some((g) => g.category === "scale"),
      "category \"performance\" suppresses the scale gap",
    );

    const scalabilityDrivers: ArchitecturalDrivers = {
      functionalRequirements: [{ id: "FR-1", description: "Do X" }],
      qualityAttributes: [{ id: "QA-1", category: "scalability", description: "Scales" }],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    assert.ok(
      !findDriverGaps(scalabilityDrivers).some((g) => g.category === "scale"),
      "category \"scalability\" suppresses the scale gap",
    );
  });

  it("findDriverGaps treats environment/platform constraints and cloud concerns as deployment coverage", () => {
    for (const category of ["environment", "platform"]) {
      const drivers = createEmptyDrivers();
      drivers.constraints.push({ id: "C-1", category, description: "Deploy target" });
      assert.ok(
        !findDriverGaps(drivers).some((g) => g.category === "deployment"),
        `constraint category "${category}" suppresses the deployment gap`,
      );
    }

    const cloudDrivers = createEmptyDrivers();
    cloudDrivers.technicalConcerns.push({ id: "TC-1", description: "Runs in the cloud" });
    assert.ok(
      !findDriverGaps(cloudDrivers).some((g) => g.category === "deployment"),
      "a technical concern mentioning cloud suppresses the deployment gap",
    );
  });

  it("findDriverGaps detects the project type from a functional requirement mentioning web", () => {
    const drivers = createEmptyDrivers();
    drivers.functionalRequirements.push({ id: "FR-1", description: "Serve a web dashboard" });
    assert.ok(
      !findDriverGaps(drivers).some((g) => g.category === "project-type"),
      "a web functional requirement suppresses the project-type gap",
    );
  });

  it("findDriverGaps matches quality attribute categories case-insensitively", () => {
    const drivers = createEmptyDrivers();
    drivers.qualityAttributes.push({ id: "QA-1", category: "Performance", description: "Fast" });
    assert.ok(
      !findDriverGaps(drivers).some((g) => g.category === "scale"),
      "capital-P Performance still suppresses the scale gap",
    );
  });

  it("normalizeDrivers lands category-less legacy items in constraints and skips empty descriptions", () => {
    const legacy = {
      drivers: [
        { id: "C-1", description: "No category given" },
        { id: "X-1", description: "" },
      ],
    };
    const normalized = normalizeDrivers(legacy);
    assert.ok(normalized);
    assert.strictEqual(normalized!.constraints.length, 1);
    assert.strictEqual(normalized!.constraints[0].id, "C-1");
    assert.strictEqual(normalized!.constraints[0].category, "general");
    assert.strictEqual(normalized!.functionalRequirements.length, 0);
    assert.strictEqual(normalized!.qualityAttributes.length, 0);
    assert.strictEqual(normalized!.technicalConcerns.length, 0);
  });

  it("mergeDrivers keeps the first occurrence description for duplicate ids", () => {
    const a = createEmptyDrivers();
    a.functionalRequirements.push({ id: "FR-1", description: "first" });
    const b = createEmptyDrivers();
    b.functionalRequirements.push({ id: "FR-1", description: "second" });

    const merged = mergeDrivers(a, b);
    assert.strictEqual(merged.functionalRequirements.length, 1);
    assert.strictEqual(merged.functionalRequirements[0].description, "first");
  });

  it("normalizeDriverItem rejects a whitespace-only description", () => {
    assert.strictEqual(normalizeDriverItem({ id: "X-1", description: "   " }), null);
  });

  it("normalizeDriverItem trims the source field", () => {
    const item = normalizeDriverItem({ id: "X-1", description: "Do X", source: "  docs/PRD.md  " });
    assert.ok(item);
    assert.strictEqual(item!.source, "docs/PRD.md");
    const blankSource = normalizeDriverItem({ id: "X-1", description: "Do X", source: "   " });
    assert.ok(blankSource);
    assert.strictEqual(blankSource!.source, undefined, "whitespace-only source is dropped");
  });
});

describe("coverage audit gaps", () => {
  it("normalizeQualityAttributeItem sets target only for a non-blank string", () => {
    const withTarget = normalizeQualityAttributeItem({
      id: "QA-1",
      category: "scale",
      description: "Scale",
      target: "  100 users  ",
    });
    assert.ok(withTarget);
    assert.strictEqual(withTarget!.target, "100 users", "target is trimmed and kept");

    const blankTarget = normalizeQualityAttributeItem({
      id: "QA-1",
      category: "scale",
      description: "Scale",
      target: "   ",
    });
    assert.ok(blankTarget);
    assert.strictEqual(blankTarget!.target, undefined, "whitespace-only target is omitted");

    const nonStringTarget = normalizeQualityAttributeItem({
      id: "QA-1",
      category: "scale",
      description: "Scale",
      target: 42,
    });
    assert.ok(nonStringTarget);
    assert.strictEqual(nonStringTarget!.target, undefined, "non-string target is omitted");
  });

  it("normalizeDriverItem returns null for non-object input", () => {
    assert.strictEqual(normalizeDriverItem("a string"), null);
    assert.strictEqual(normalizeDriverItem(null), null);
    assert.strictEqual(normalizeDriverItem(42), null);
  });

  it("normalizeDrivers legacy schema skips non-object items and filters non-string uncertainties", () => {
    const legacy = {
      drivers: [
        "not-an-object",
        null,
        42,
        { id: "FR-1", category: "functional", description: "Do X" },
      ],
      uncertainties: ["U1", 42, null],
    };

    const normalized = normalizeDrivers(legacy);
    assert.ok(normalized);
    assert.strictEqual(normalized!.functionalRequirements.length, 1);
    assert.strictEqual(normalized!.functionalRequirements[0].id, "FR-1");
    assert.strictEqual(normalized!.qualityAttributes.length, 0);
    assert.strictEqual(normalized!.constraints.length, 0);
    assert.deepStrictEqual(normalized!.uncertainties, ["U1"]);
  });

  it("findDriverGaps covers deploy constraints, on-premise/offline concerns, and project-type keywords", () => {
    const deployDrivers = createEmptyDrivers();
    deployDrivers.constraints.push({ id: "C-1", category: "deployment", description: "Ship as one binary" });
    assert.ok(
      !findDriverGaps(deployDrivers).some((g) => g.category === "deployment"),
      "a deploy-category constraint suppresses the deployment gap",
    );

    for (const description of ["Must run on-premise", "Must work fully offline"]) {
      const drivers = createEmptyDrivers();
      drivers.technicalConcerns.push({ id: "TC-1", description });
      assert.ok(
        !findDriverGaps(drivers).some((g) => g.category === "deployment"),
        `technical concern "${description}" suppresses the deployment gap`,
      );
    }

    for (const description of ["A mobile client", "A desktop tool", "Controls a plc line", "Runs on embedded hardware", "An iot gateway"]) {
      const drivers = createEmptyDrivers();
      drivers.technicalConcerns.push({ id: "TC-1", description });
      assert.ok(
        !findDriverGaps(drivers).some((g) => g.category === "project-type"),
        `technical concern "${description}" suppresses the project-type gap`,
      );
    }

    for (const description of ["Sync with a mobile app", "Export to a desktop report"]) {
      const drivers = createEmptyDrivers();
      drivers.functionalRequirements.push({ id: "FR-1", description });
      assert.ok(
        !findDriverGaps(drivers).some((g) => g.category === "project-type"),
        `functional requirement "${description}" suppresses the project-type gap`,
      );
    }
  });
});
