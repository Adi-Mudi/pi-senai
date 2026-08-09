import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildDocumentIngestPrompt,
  buildIngestBatches,
  buildMapOutputPath,
  getConfiguredDocuments,
  getDocumentManifestPath,
  loadDocumentManifest,
  mergeMapOutputs,
  readMapOutputs,
  sanitizeDocumentPath,
  saveDocumentManifest,
} from "../src/document-ingest.js";
import { getArchitectMapDir } from "../src/constants.js";
import type { ArchitectMapOutput } from "../src/document-ingest.js";
import type { ArchitectInputsConfig } from "../src/architect-inputs-config.js";

describe("document-ingest", () => {
  it("sanitizeDocumentPath converts paths safely", () => {
    assert.strictEqual(sanitizeDocumentPath("docs/PRD.md"), "docs-PRD.md");
    assert.strictEqual(sanitizeDocumentPath("src/app/main.ts"), "src-app-main.ts");
  });

  it("buildMapOutputPath uses sanitized name", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-ingest-"));
    const outputPath = buildMapOutputPath(tmpDir, "docs/PRD.md");
    assert.ok(outputPath.includes("docs-PRD.md"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getArchitectMapDir returns correct path", () => {
    assert.strictEqual(
      getArchitectMapDir("/fake"),
      path.join("/fake", ".IDE_Plans/architect-map"),
    );
  });

  it("buildIngestBatches caps batch size", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const batches = buildIngestBatches(items, 4);
    assert.strictEqual(batches.length, 2);
    assert.deepStrictEqual(batches[0], ["a", "b", "c", "d"]);
    assert.deepStrictEqual(batches[1], ["e", "f"]);
  });

  it("saveDocumentManifest creates file under .IDE_Plans/architect-map", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-ingest-"));
    const manifest = {
      version: 1 as const,
      documents: [{ type: "prd" as const, path: "docs/PRD.md" }],
      mapOutputs: [".IDE_Plans/architect-map/docs-PRD.md.json"],
      reducedDriversPath: ".pi/architect/architectural-drivers.json",
    };
    saveDocumentManifest(tmpDir, manifest);
    const manifestPath = getDocumentManifestPath(tmpDir);
    assert.ok(manifestPath.includes(".IDE_Plans/architect-map"));
    assert.ok(fs.existsSync(manifestPath));
    const loaded = loadDocumentManifest(tmpDir);
    assert.deepStrictEqual(loaded, manifest);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mergeMapOutputs deduplicates by id", () => {
    const outputs: ArchitectMapOutput[] = [
      {
        document: "docs/PRD.md",
        documentType: "prd",
        functionalRequirements: [{ id: "FR-1", description: "Do X" }],
        qualityAttributes: [],
        constraints: [],
        technicalConcerns: [],
        uncertainties: ["U1"],
      },
      {
        document: "docs/NFR.md",
        documentType: "nfr",
        functionalRequirements: [{ id: "FR-1", description: "Do X again" }],
        qualityAttributes: [{ id: "QA-1", category: "scalability", description: "Scale" }],
        constraints: [],
        technicalConcerns: [],
        uncertainties: ["U1", "U2"],
      },
    ];
    const merged = mergeMapOutputs(outputs);
    assert.strictEqual(merged.functionalRequirements.length, 1);
    assert.strictEqual(merged.qualityAttributes.length, 1);
    assert.deepStrictEqual(merged.uncertainties, ["U1", "U2"]);
  });

  it("mergeMapOutputs drops items missing id or description", () => {
    const outputs: ArchitectMapOutput[] = [
      {
        document: "docs/PRD.md",
        documentType: "prd",
        functionalRequirements: [
          { id: "FR-1", description: "Valid" },
          { id: "", description: "Missing id" } as any,
          { id: "FR-2", description: "" } as any,
          { description: "Missing id too" } as any,
        ],
        qualityAttributes: [],
        constraints: [],
        technicalConcerns: [],
        uncertainties: ["", "Real uncertainty"],
      },
    ];
    const merged = mergeMapOutputs(outputs);
    assert.strictEqual(merged.functionalRequirements.length, 1);
    assert.strictEqual(merged.functionalRequirements[0].id, "FR-1");
    assert.deepStrictEqual(merged.uncertainties, ["Real uncertainty"]);
  });

  it("mergeMapOutputs drops quality attributes and constraints missing category", () => {
    const outputs: ArchitectMapOutput[] = [
      {
        document: "docs/NFR.md",
        documentType: "nfr",
        functionalRequirements: [],
        qualityAttributes: [
          { id: "QA-1", category: "scalability", description: "Scale" },
          { id: "QA-2", description: "No category" } as any,
        ],
        constraints: [
          { id: "C-1", category: "platform", description: "Cloud" },
          { id: "C-2", description: "No category" } as any,
        ],
        technicalConcerns: [],
        uncertainties: [],
      },
    ];
    const merged = mergeMapOutputs(outputs);
    assert.strictEqual(merged.qualityAttributes.length, 1);
    assert.strictEqual(merged.qualityAttributes[0].id, "QA-1");
    assert.strictEqual(merged.constraints.length, 1);
    assert.strictEqual(merged.constraints[0].id, "C-1");
  });

  it("mergeMapOutputs handles empty outputs and all-invalid items", () => {
    assert.deepStrictEqual(mergeMapOutputs([]), {
      functionalRequirements: [],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    });

    const outputs: ArchitectMapOutput[] = [
      {
        document: "docs/PRD.md",
        documentType: "prd",
        functionalRequirements: [{ description: "Missing id" } as any],
        qualityAttributes: [{ id: "QA-1", description: "No category" } as any],
        constraints: [{ id: "C-1", category: "platform", description: "" } as any],
        technicalConcerns: [{ id: "", description: "Empty id" } as any],
        uncertainties: ["", 123 as any],
      },
    ];
    const merged = mergeMapOutputs(outputs);
    assert.strictEqual(merged.functionalRequirements.length, 0);
    assert.strictEqual(merged.qualityAttributes.length, 0);
    assert.strictEqual(merged.constraints.length, 0);
    assert.strictEqual(merged.technicalConcerns.length, 0);
    assert.deepStrictEqual(merged.uncertainties, []);
  });

  it("mergeMapOutputs maps driver field to id", () => {
    const outputs: ArchitectMapOutput[] = [
      {
        document: "docs/PRD.md",
        documentType: "prd",
        functionalRequirements: [{ driver: "FR-1", description: "Do X" } as any],
        qualityAttributes: [{ driver: "QA-1", category: "scalability", description: "Scale" } as any],
        constraints: [{ driver: "C-1", category: "platform", description: "Cloud" } as any],
        technicalConcerns: [{ driver: "TC-1", description: "Web" } as any],
        uncertainties: [],
      },
    ];
    const merged = mergeMapOutputs(outputs);
    assert.strictEqual(merged.functionalRequirements.length, 1);
    assert.strictEqual(merged.functionalRequirements[0].id, "FR-1");
    assert.strictEqual(merged.qualityAttributes[0].id, "QA-1");
    assert.strictEqual(merged.constraints[0].id, "C-1");
    assert.strictEqual(merged.technicalConcerns[0].id, "TC-1");
  });

  it("readMapOutputs reads valid map files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-ingest-"));
    const mapDir = getArchitectMapDir(tmpDir);
    fs.mkdirSync(mapDir, { recursive: true });
    const output: ArchitectMapOutput = {
      document: "docs/PRD.md",
      documentType: "prd",
      functionalRequirements: [{ id: "FR-1", description: "Do X" }],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, "docs-PRD.md.json"), JSON.stringify(output), "utf8");
    const loaded = readMapOutputs(tmpDir);
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].document, "docs/PRD.md");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getConfiguredDocuments returns documents from config", () => {
    const config: ArchitectInputsConfig = {
      version: 1,
      documents: [
        { type: "prd", path: "docs/PRD.md" },
        { type: "nfr", path: "docs/NFR.md" },
      ],
      additionalConstraints: [],
    };
    assert.deepStrictEqual(getConfiguredDocuments(config), config.documents);
  });

  it("buildDocumentIngestPrompt mentions document path and type", () => {
    const prompt = buildDocumentIngestPrompt({ type: "prd", path: "docs/PRD.md" }, "/out.json");
    assert.match(prompt, /docs\/PRD\.md/);
    assert.match(prompt, /prd/);
    assert.match(prompt, /\/out\.json/);
  });

  it("readMapOutputs skips malformed files and keeps valid ones", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-mal-"));
    const mapDir = getArchitectMapDir(tmpDir);
    fs.mkdirSync(mapDir, { recursive: true });
    const valid = {
      document: "a.md",
      documentType: "prd",
      functionalRequirements: [],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, "good.json"), JSON.stringify(valid), "utf8");
    fs.writeFileSync(path.join(mapDir, "bad.json"), "{ broken", "utf8");
    const outputs = readMapOutputs(tmpDir);
    assert.strictEqual(outputs.length, 1);
    assert.strictEqual(outputs[0].document, "a.md");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readMapOutputs returns an empty array when the map dir is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-nodir-"));
    assert.deepStrictEqual(readMapOutputs(tmpDir), []);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("buildIngestBatches returns an empty array for empty input", () => {
    assert.deepStrictEqual(buildIngestBatches([], 4), []);
  });

  it("mergeMapOutputs deduplicates uncertainties and drops empty strings", () => {
    const outputs = [
      { document: "a", documentType: "prd", functionalRequirements: [], qualityAttributes: [], constraints: [], technicalConcerns: [], uncertainties: ["U1", ""] },
      { document: "b", documentType: "prd", functionalRequirements: [], qualityAttributes: [], constraints: [], technicalConcerns: [], uncertainties: ["U1", "U2"] },
    ] as any;
    const merged = mergeMapOutputs(outputs);
    assert.deepStrictEqual(merged.uncertainties, ["U1", "U2"]);
  });

  it("loadDocumentManifest returns null when missing and throws on unsupported version", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-manifest-"));
    assert.strictEqual(loadDocumentManifest(tmpDir), null);
    const manifestPath = getDocumentManifestPath(tmpDir);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ version: 2, documents: [], mapOutputs: [], reducedDriversPath: "" }),
      "utf8",
    );
    assert.throws(() => loadDocumentManifest(tmpDir), /Unsupported manifest version: 2/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sanitizeDocumentPath collapses backslashes and repeated dashes", () => {
    assert.strictEqual(sanitizeDocumentPath("docs\\sub\\PRD file!!.md"), "docs-sub-PRD-file-.md");
  });

  it("readMapOutputs ignores non-json files and subdirectories", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-nonjson-"));
    const mapDir = getArchitectMapDir(tmpDir);
    fs.mkdirSync(mapDir, { recursive: true });
    const valid = {
      document: "a.md",
      documentType: "prd",
      functionalRequirements: [],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, "good.json"), JSON.stringify(valid), "utf8");
    fs.writeFileSync(path.join(mapDir, "notes.md"), "# not a map output", "utf8");
    fs.mkdirSync(path.join(mapDir, "subdir"));

    const outputs = readMapOutputs(tmpDir);
    assert.strictEqual(outputs.length, 1);
    assert.strictEqual(outputs[0].document, "a.md");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mergeMapOutputs drops a quality attribute whose id was already seen as a functional requirement", () => {
    const outputs: ArchitectMapOutput[] = [
      {
        document: "docs/PRD.md",
        documentType: "prd",
        functionalRequirements: [{ id: "X-1", description: "Shared id requirement" }],
        qualityAttributes: [{ id: "X-1", category: "scalability", description: "Shared id quality" }],
        constraints: [],
        technicalConcerns: [],
        uncertainties: [],
      },
    ];
    const merged = mergeMapOutputs(outputs);
    // NOTE: seenIds is shared across categories, so the second occurrence is dropped.
    assert.strictEqual(merged.functionalRequirements.length, 1);
    assert.strictEqual(merged.functionalRequirements[0].id, "X-1");
    assert.strictEqual(merged.qualityAttributes.length, 0);
  });

  it("mergeMapOutputs keeps only non-blank string uncertainties", () => {
    const outputs = [
      {
        document: "a",
        documentType: "prd",
        functionalRequirements: [],
        qualityAttributes: [],
        constraints: [],
        technicalConcerns: [],
        uncertainties: [42, " ", "real"],
      },
    ] as any;
    const merged = mergeMapOutputs(outputs);
    assert.deepStrictEqual(merged.uncertainties, ["real"]);
  });

  it("loadDocumentManifest throws a wrapped error on malformed JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-manifest-bad-"));
    const manifestPath = getDocumentManifestPath(tmpDir);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "{ not valid", "utf8");
    assert.throws(() => loadDocumentManifest(tmpDir), /Invalid document manifest/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sanitizeDocumentPath strips leading and trailing dashes and maps spaces to dashes", () => {
    assert.strictEqual(sanitizeDocumentPath("-my doc-"), "my-doc");
    assert.strictEqual(sanitizeDocumentPath("  spaced out  "), "spaced-out");
  });

  it("buildIngestBatches rejects a zero, negative, or non-integer batch size", () => {
    assert.throws(() => buildIngestBatches([1, 2], 0), /batchSize must be a positive integer/);
    assert.throws(() => buildIngestBatches([1, 2], -3), /batchSize must be a positive integer/);
    assert.throws(() => buildIngestBatches([1, 2], 1.5), /batchSize must be a positive integer/);
  });
});
