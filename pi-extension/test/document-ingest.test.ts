import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildDocumentIngestPrompt,
  buildIngestBatches,
  buildMapOutputPath,
  getArchitectMapDir,
  getConfiguredDocuments,
  getDocumentManifestPath,
  loadDocumentManifest,
  mergeMapOutputs,
  readMapOutputs,
  sanitizeDocumentPath,
  saveDocumentManifest,
} from "../src/document-ingest.js";
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
      path.join("/fake", ".pi/orchestra/architect-map"),
    );
  });

  it("buildIngestBatches caps batch size", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const batches = buildIngestBatches(items, 4);
    assert.strictEqual(batches.length, 2);
    assert.deepStrictEqual(batches[0], ["a", "b", "c", "d"]);
    assert.deepStrictEqual(batches[1], ["e", "f"]);
  });

  it("saveDocumentManifest creates file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-ingest-"));
    const manifest = {
      version: 1 as const,
      documents: [{ type: "prd" as const, path: "docs/PRD.md" }],
      mapOutputs: [".pi/orchestra/architect-map/docs-PRD.md.json"],
      reducedDriversPath: ".pi/orchestra/architectural-drivers.json",
    };
    saveDocumentManifest(tmpDir, manifest);
    assert.ok(fs.existsSync(getDocumentManifestPath(tmpDir)));
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
});
