import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ArchitectDocumentInput,
  ArchitectDocumentType,
  ArchitectInputsConfig,
} from "./architect-inputs-config.js";
import type {
  ArchitecturalDrivers,
  DriverItem,
  QualityAttributeItem,
  ConstraintItem,
} from "./driver-extractor.js";
import {
  normalizeDriverItem,
  normalizeQualityAttributeItem,
  normalizeConstraintItem,
} from "./driver-extractor.js";
import { getArchitectMapDir, getArchitectStateDir } from "./constants.js";

export const DOCUMENT_MANIFEST_FILE = "architect-documents.json";

export interface DocumentManifest {
  version: 1;
  documents: ArchitectDocumentInput[];
  mapOutputs: string[];
  reducedDriversPath: string;
}

export interface ArchitectMapOutput {
  document: string;
  documentType: ArchitectDocumentType;
  functionalRequirements: DriverItem[];
  qualityAttributes: QualityAttributeItem[];
  constraints: ConstraintItem[];
  technicalConcerns: DriverItem[];
  uncertainties: string[];
}

export function getDocumentManifestPath(cwd: string): string {
  return path.join(getArchitectMapDir(cwd), DOCUMENT_MANIFEST_FILE);
}

export function buildMapOutputPath(cwd: string, docPath: string): string {
  const mapDir = getArchitectMapDir(cwd);
  const sanitized = sanitizeDocumentPath(docPath);
  return path.join(mapDir, `${sanitized}.json`);
}

export function sanitizeDocumentPath(docPath: string): string {
  return docPath
    .replace(/[\\/]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildIngestBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

export function saveDocumentManifest(cwd: string, manifest: DocumentManifest): void {
  const manifestPath = getDocumentManifestPath(cwd);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

export function loadDocumentManifest(cwd: string): DocumentManifest | null {
  const manifestPath = getDocumentManifestPath(cwd);
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as DocumentManifest;
    if (parsed.version !== 1) {
      throw new Error(`Unsupported manifest version: ${parsed.version}`);
    }
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid document manifest at ${manifestPath}: ${err.message}`);
  }
}

export function readMapOutputs(cwd: string): ArchitectMapOutput[] {
  const mapDir = getArchitectMapDir(cwd);
  if (!fs.existsSync(mapDir)) return [];

  const outputs: ArchitectMapOutput[] = [];
  const entries = fs.readdirSync(mapDir);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(mapDir, entry);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as ArchitectMapOutput;
      outputs.push(parsed);
    } catch {
      // Skip malformed map outputs.
    }
  }
  return outputs;
}

export function mergeMapOutputs(mapOutputs: ArchitectMapOutput[]): ArchitecturalDrivers {
  const merged: ArchitecturalDrivers = {
    functionalRequirements: [],
    qualityAttributes: [],
    constraints: [],
    technicalConcerns: [],
    uncertainties: [],
  };

  const seenIds = new Set<string>();

  for (const output of mapOutputs) {
    for (const item of output.functionalRequirements) {
      const normalized = normalizeDriverItem(item);
      if (normalized && !seenIds.has(normalized.id)) {
        seenIds.add(normalized.id);
        merged.functionalRequirements.push(normalized);
      }
    }
    for (const item of output.qualityAttributes) {
      const normalized = normalizeQualityAttributeItem(item);
      if (normalized && !seenIds.has(normalized.id)) {
        seenIds.add(normalized.id);
        merged.qualityAttributes.push(normalized);
      }
    }
    for (const item of output.constraints) {
      const normalized = normalizeConstraintItem(item);
      if (normalized && !seenIds.has(normalized.id)) {
        seenIds.add(normalized.id);
        merged.constraints.push(normalized);
      }
    }
    for (const item of output.technicalConcerns) {
      const normalized = normalizeDriverItem(item);
      if (normalized && !seenIds.has(normalized.id)) {
        seenIds.add(normalized.id);
        merged.technicalConcerns.push(normalized);
      }
    }
    for (const uncertainty of output.uncertainties) {
      if (typeof uncertainty === "string" && uncertainty.trim() !== "" && !merged.uncertainties.includes(uncertainty)) {
        merged.uncertainties.push(uncertainty);
      }
    }
  }

  return merged;
}

export function getConfiguredDocuments(config: ArchitectInputsConfig): ArchitectDocumentInput[] {
  return config.documents;
}

export function buildDocumentIngestPrompt(
  document: ArchitectDocumentInput,
  outputPath: string,
): string {
  return [
    `Read the document at ${document.path}.`,
    `This document is classified as type: ${document.type}.`,
    `Extract architectural drivers from this document and write them to ${outputPath}.`,
    "",
    "Output JSON format:",
    "{",
    `  "document": "${document.path}",`,
    `  "documentType": "${document.type}",`,
    '  "functionalRequirements": [{ "id": "FR-1", "description": "...", "source": "' + document.path + '" }],',
    '  "qualityAttributes": [{ "id": "QA-1", "category": "scalability|performance|security|reliability|maintainability", "target": "...", "description": "...", "source": "' + document.path + '" }],',
    '  "constraints": [{ "id": "C-1", "category": "budget|timeline|compliance|team-size|platform", "description": "...", "source": "' + document.path + '" }],',
    '  "technicalConcerns": [{ "id": "TC-1", "description": "...", "source": "' + document.path + '" }],',
    '  "uncertainties": ["..."]',
    "}",
    "",
    "Rules:",
    "- Only extract information that is actually present in the document.",
    "- Do not invent requirements.",
    "- Use concise descriptions.",
    "- Include the source path for every item.",
    "- List anything unclear or missing as an uncertainty.",
  ].join("\n");
}
