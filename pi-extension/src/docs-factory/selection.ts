import * as fs from "node:fs";
import * as path from "node:path";
import {
  DOC_TYPES,
  isDocStub,
  renderTemplateStub,
  type DocTypeId,
} from "./catalog.js";
import { loadArchitectProfile } from "../architect/index.js";
import { atomicWriteFile, atomicWriteJson } from "../io/atomic-write.js";

/** The four document writer roles. */
export type DocWriter = "readme-writer" | "changelog-writer" | "api-docs-writer" | "other-docs-writer";

export interface DocSelection {
  writers: DocWriter[];
  reasons: Record<DocWriter, string>;
}

/** One concrete document to write: writer + catalog type + target + cap. */
export interface DocTask {
  writer: DocWriter;
  docType: DocTypeId;
  /** Target path relative to the project root (catalog default). */
  targetPath: string;
  maxLines: number;
  /** Why this doc was selected (shown in the stage prompt). */
  reason: string;
}

export interface DocWritePlan {
  tasks: DocTask[];
  /** Tasks grouped for execution: ≤ MAX_BATCH writers per batch;
   *  batch N+1 starts only after batch N completes. */
  batches: DocTask[][];
}

export const MAX_BATCH = 4;

/** Deterministic decision table: which document writers a project needs.
 *  No LLM call. readme-writer is always selected. */
export function selectDocumentWriters(cwd: string): DocSelection {
  const writers: DocWriter[] = ["readme-writer"];
  const reasons: Record<DocWriter, string> = {
    "readme-writer": "every project has a README",
    "changelog-writer": "",
    "api-docs-writer": "",
    "other-docs-writer": "",
  };

  let pkg: { version?: string; main?: string; exports?: unknown; types?: string } | null = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  } catch {
    pkg = null;
  }

  const hasChangelog =
    fs.existsSync(path.join(cwd, "CHANGELOG.md")) || (pkg != null && typeof pkg.version === "string");
  if (hasChangelog) {
    writers.push("changelog-writer");
    reasons["changelog-writer"] = "versioned releases (CHANGELOG.md or package.json version)";
  }

  const hasPublicApi =
    pkg != null && (typeof pkg.main === "string" || pkg.exports !== undefined || typeof pkg.types === "string");
  if (hasPublicApi) {
    writers.push("api-docs-writer");
    reasons["api-docs-writer"] = "package exposes a public API surface (main/exports/types)";
  }

  const acceptsContributions =
    fs.existsSync(path.join(cwd, "CONTRIBUTING.md")) || fs.existsSync(path.join(cwd, ".github"));
  if (acceptsContributions) {
    writers.push("other-docs-writer");
    reasons["other-docs-writer"] = "project accepts external contributions (CONTRIBUTING.md or .github/)";
  }

  return { writers, reasons };
}

/** Extends selectDocumentWriters into a concrete write plan: one DocTask per
 *  selected document, with the catalog's default path, template id, and length
 *  cap. Extra signal on top of the writer decision table: an existing
 *  architect profile (.pi/architect/architect-profile.json) adds the
 *  arc42-lite architecture overview. Selection is project-wise only — no
 *  developer-level dimension, and files.json deliberately adds no doc types
 *  (that was the doc-bloat source this factory exists to prevent).
 *  Tasks are chunked into batches of MAX_BATCH (4); batch order is stable
 *  (readme first, then changelog, api, others). Language-agnostic. */
export function buildDocWritePlan(cwd: string): DocWritePlan {
  const { writers, reasons } = selectDocumentWriters(cwd);
  const tasks: DocTask[] = [];

  const taskFor = (writer: DocWriter, docType: DocTypeId, reason: string): DocTask => ({
    writer,
    docType,
    targetPath: DOC_TYPES[docType].defaultPath,
    maxLines: DOC_TYPES[docType].maxLines,
    reason,
  });

  for (const writer of writers) {
    if (writer === "api-docs-writer") {
      // The catalog type owns a folder of per-symbol pages; the skeleton and
      // the writer start from its index page.
      tasks.push({
        writer,
        docType: "api-reference",
        targetPath: path.posix.join(DOC_TYPES["api-reference"].defaultPath, "README.md"),
        maxLines: DOC_TYPES["api-reference"].maxLines,
        reason: reasons[writer],
      });
    } else if (writer === "other-docs-writer") {
      tasks.push(taskFor(writer, "contributing", reasons[writer]));
    } else {
      tasks.push(taskFor(writer, writer === "readme-writer" ? "readme" : "changelog", reasons[writer]));
    }
  }

  // Architecture overview only when a generated architecture exists. Assigned
  // to other-docs-writer, which is added to the task set even when the
  // decision table did not select it.
  let hasArchitecture = false;
  try {
    hasArchitecture = loadArchitectProfile(cwd) != null;
  } catch {
    hasArchitecture = false;
  }
  if (hasArchitecture) {
    tasks.push(
      taskFor(
        "other-docs-writer",
        "architecture",
        "project has a generated architecture (.pi/architect/architect-profile.json)",
      ),
    );
  }

  const batches: DocTask[][] = [];
  for (let i = 0; i < tasks.length; i += MAX_BATCH) {
    batches.push(tasks.slice(i, i + MAX_BATCH));
  }
  return { tasks, batches };
}

export interface DocsStructureResult {
  /** Stub files written by this call. */
  created: string[];
  /** Existing non-stub docs left untouched. */
  kept: string[];
  manifestPath: string;
}

/** Creates the docs skeleton for the selected doc types: the target folders
 *  (only for selected types) and one template stub per planned task. Existing
 *  non-stub docs are NEVER overwritten. Also writes the manifest doctor
 *  validates the skeleton against. */
export function generateDocsStructure(cwd: string): DocsStructureResult {
  const plan = buildDocWritePlan(cwd);
  const created: string[] = [];
  const kept: string[] = [];

  for (const task of plan.tasks) {
    const fullPath = path.join(cwd, task.targetPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    let existing: string | null = null;
    try {
      existing = fs.readFileSync(fullPath, "utf8");
    } catch {
      existing = null;
    }
    if (existing !== null && !isDocStub(existing)) {
      kept.push(task.targetPath);
      continue;
    }
    atomicWriteFile(fullPath, renderTemplateStub(task.docType), "utf8");
    created.push(task.targetPath);
  }

  const manifestPath = path.join(cwd, ".pi", "senai", "docs-structure.json");
  atomicWriteJson(manifestPath, {
    _comment:
      "Docs factory skeleton generated by /senai-generate-docs-structure. Doctor validates docs against this. Regenerate by re-running the command.",
    version: 1,
    targets: plan.tasks.map((t) => ({
      path: t.targetPath,
      docType: t.docType,
      maxLines: t.maxLines,
    })),
  });

  return { created, kept, manifestPath };
}

/** Markdown block injected into the Document stage prompt. Lists every doc
 *  task with its target path, template id, and length cap, then the explicit
 *  execution batches (≤ MAX_BATCH tasks each). Batch N+1 starts only after
 *  every task in batch N has a verified artifact on disk. */
export function buildDocSelectionBlock(cwd: string): string {
  const plan = buildDocWritePlan(cwd);
  const lines = ["## Document writers for this run", ""];
  for (const t of plan.tasks) {
    lines.push(`- ${t.writer} → ${t.targetPath} (template: ${t.docType}, max ${t.maxLines} lines) — ${t.reason}`);
  }
  lines.push("", "### Batches", "");
  plan.batches.forEach((batch, i) => {
    lines.push(`Batch ${i + 1}: ${batch.map((t) => t.writer).join(", ")}`);
  });
  lines.push(
    "",
    "Spawn batch 1, wait for ALL its completions (verify each artifact with `test -s <targetPath>`), only then spawn the next batch. Never exceed 4 concurrent writers.",
    "Note: pi.dev has no official concurrency/locking — batching is enforced by this prompt plus the artifact completion guard, nothing else.",
    "Writers fill the template stub at their target path and respect its length cap. Spawn ONLY these tasks — do not invent additional documents.",
  );
  return lines.join("\n");
}
