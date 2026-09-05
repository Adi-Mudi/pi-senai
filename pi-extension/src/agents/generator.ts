import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import {
  addToGeneratedManifest,
  loadGeneratedManifest,
  slugify,
  type ArchitectReport,
} from "../architect/index.js";
import { getDocType, type DocTypeId } from "../docs-factory/catalog.js";
import { atomicWriteFile } from "../io/atomic-write.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GeneratedRoleDef {
  role: string;
  label: string;
  tools: string[];
  mandate: string;
  /** When the harness should spawn this agent. Becomes part of the YAML
   *  description: frontmatter so the harness auto-invokes correctly.
   *  Required — every role has one. */
  invocationHint: string;
  /** What this agent MUST NOT do, even if asked. Rendered as the
   *  `## Out of scope` section between mandate and completion contract.
   *  Required — every role has at least one entry. */
  outOfScope: string[];
  interactive?: boolean;
  /** Doc-writer roles carry a documentation contract from the catalog. */
  docType?: DocTypeId;
}

// The 14 non-architecture Senai roles. The 7 architecture-bound roles are
// owned by the architecture factory and are never generated here.
//
// Every row carries `invocationHint` (becomes part of the YAML description
// frontmatter so the harness auto-invokes correctly) and `outOfScope`
// (rendered as the `## Out of scope` section in the body to prevent the
// agent from drifting into another role's job).
export const GENERATED_ROLES: GeneratedRoleDef[] = [
  {
    role: "scout-2",
    label: "Scout 2 — Code Search",
    tools: ["read", "write"],
    mandate: "Search the codebase and report relevant code locations, existing implementations, and reusable patterns.",
    invocationHint: "Spawn in plan stage in parallel with the other scouts; report code-search findings.",
    outOfScope: [
      "Do not write a plan — that is the planner's job.",
      "Do not edit or create source files.",
      "Do not write scout reports for other roles (scout-3, scout-4).",
    ],
  },
  {
    role: "scout-3",
    label: "Scout 3 — Code Risk / Dependency Audit",
    tools: ["read", "write"],
    mandate: "Audit code risks, fragile areas, and dependency health before planning.",
    invocationHint: "Spawn in plan stage in parallel with the other scouts; report code-risk and dependency findings.",
    outOfScope: [
      "Do not write a plan — that is the planner's job.",
      "Do not edit or create source files.",
      "Do not write scout reports for other roles (scout-2, scout-4).",
    ],
  },
  {
    role: "scout-4",
    label: "Scout 4 — PRD / Documentation Audit",
    tools: ["read", "write"],
    mandate: "Audit requirements and documentation coverage against the mission.",
    invocationHint: "Spawn in plan stage in parallel with the other scouts; audit PRD and doc coverage.",
    outOfScope: [
      "Do not write a plan — that is the planner's job.",
      "Do not edit or create source files.",
      "Do not write scout reports for other roles (scout-2, scout-3).",
    ],
  },
  {
    role: "discussion",
    label: "Discussion",
    tools: ["read", "write"],
    interactive: true,
    mandate: "Interview the user, consolidate scout findings, and record decisions in discussion notes.",
    invocationHint: "Spawn in plan stage after scouts complete; consolidate scout findings and interview the user.",
    outOfScope: [
      "Do not write the implementation plan — that is the planner's job.",
      "Do not edit source files.",
      "Do not make decisions the user must make — ask via AskUserQuestion.",
    ],
  },
  {
    role: "plan-overview",
    label: "Plan Overview",
    tools: ["read", "write"],
    mandate: "Write the user-friendly plan overview: mission, approach, key decisions, and expected outcome.",
    invocationHint: "Spawn in plan stage after the planner finishes; write the user-friendly plan summary.",
    outOfScope: [
      "Do not edit the implementation plan (plan.md).",
      "Do not change scope or requirements — that is the planner's job.",
      "Do not edit source files.",
    ],
  },
  {
    role: "test-skeleton",
    label: "Test Skeleton",
    tools: ["read", "write"],
    mandate: "Write failing test skeletons derived from the approved plan before implementation starts. Follow the testing discipline: AAA structure, equivalence partitioning + boundary value analysis, the project's naming convention, table-driven cases for repeated logic, and at least one property-based test for every pure function. Tests must be RED (failing) when you finish — do not implement the feature. Anti-patterns to avoid: zero-assertion tests, mystery guests, over-mocking (more than three doubles), mirror-logic assertions, and testing private methods.",
    invocationHint: "Spawn first in implement stage before the implementer; write failing test stubs.",
    outOfScope: [
      "Do not implement source code — the implementer agent does that.",
      "Do not run linters or the full test suite — the linter and full-test agents do that.",
      "Do not modify the plan — that is the planner's job.",
    ],
  },
  {
    role: "linter",
    label: "Linter",
    tools: ["read", "bash", "write"],
    mandate: "Run the project's linters and write the violations report (with file and line references) to the artifact path given in your task. When a file under testPaths or in a `*.test.*` / `*_test.*` / `*.spec.*` location is linted, also flag the testing anti-patterns the scanner checks for (zero-assertion, over-mocking, mirror-logic, flaky-timing, no-AAA, mystery-guest, private-method, god-test) — list each smell with file:line. Severity matters: zero-assertion and over-mocking are blocking; mirror-logic / flaky-timing / mystery-guest / private-method are actionable; no-AAA is informational. Do not auto-fix — write findings only.",
    invocationHint: "Spawn in implement stage after the implementer; run project linters and flag test smells.",
    outOfScope: [
      "Do not auto-fix findings — write them only.",
      "Do not implement source code.",
      "Do not run the full test suite — that is the full-test agent's job.",
    ],
  },
  {
    role: "full-test",
    label: "Full Test",
    tools: ["read", "bash", "write"],
    mandate: "Run the full test suite and write the results report (failures with exact error output) to the artifact path given in your task. 'All tests pass' means: every assertion fired, no `.skip` / `xfail` / `it.todo` left over without a `// TODO(reason): re-enable in <ticket>` comment that names the blocker, and no test exited without an assertion (zero-assertion). Report skipped tests separately with their TODO comments. If the suite produces zero tests because the test path is misconfigured, write a clear 'no tests discovered' finding — do not report success.",
    invocationHint: "Spawn last in implement stage; run the full test suite and verify completeness.",
    outOfScope: [
      "Do not skip tests silently — every skip needs a TODO comment.",
      "Do not modify source code.",
      "Do not edit tests to make them pass — fix the source instead.",
    ],
  },
  {
    role: "readme-writer",
    label: "README Writer",
    tools: ["read", "write"],
    mandate: "Update the README so it matches what was actually built.",
    docType: "readme",
    invocationHint: "Spawn in document stage; update the README to match what was built.",
    outOfScope: [
      "Do not edit source code.",
      "Do not modify test files; do not change code examples that are exercised by tests.",
      "Do not write other document types (CHANGELOG, API reference, guides).",
    ],
  },
  {
    role: "changelog-writer",
    label: "Changelog Writer",
    tools: ["read", "write"],
    mandate: "Update the CHANGELOG with the changes made in this run.",
    docType: "changelog",
    invocationHint: "Spawn in document stage; update the CHANGELOG with this run's changes.",
    outOfScope: [
      "Do not edit source code.",
      "Do not modify test files; do not change code examples that are exercised by tests.",
      "Do not write other document types (README, API reference, guides).",
    ],
  },
  {
    role: "api-docs-writer",
    label: "API Docs Writer",
    tools: ["read", "write"],
    mandate: "Update API documentation to match the implemented interfaces.",
    docType: "api-reference",
    invocationHint: "Spawn in document stage when the project exposes a public API surface; update API reference.",
    outOfScope: [
      "Do not edit source code.",
      "Do not modify test files; do not change code examples that are exercised by tests.",
      "Do not write narrative guides or how-tos — those are other-docs-writer's job.",
    ],
  },
  {
    role: "other-docs-writer",
    label: "Other Docs Writer",
    tools: ["read", "write"],
    mandate: "Update the remaining project docs (guides, design docs) to match the implementation.",
    docType: "how-to",
    invocationHint: "Spawn in document stage; update guides, design docs, and how-tos.",
    outOfScope: [
      "Do not edit source code.",
      "Do not modify test files; do not change code examples that are exercised by tests.",
      "Do not write README, CHANGELOG, or API reference — those have dedicated writers.",
    ],
  },
  {
    role: "security-gate",
    label: "Security Gate",
    tools: ["read", "write"],
    mandate: "Run the final security audit and write the security report.",
    invocationHint: "Spawn in deliver stage; run the final security audit and write the security report.",
    outOfScope: [
      "Do not modify source code.",
      "Do not declare the run delivered — that requires user approval.",
    ],
  },
  {
    role: "archive",
    label: "Archive",
    tools: ["read", "write", "bash"],
    mandate: "Archive run artifacts and keep the run directory tidy.",
    invocationHint: "Spawn in deliver stage after security-gate passes; package run artifacts.",
    outOfScope: [
      "Do not modify source code.",
      "Do not run the security audit — that is the security-gate agent's job.",
    ],
  },
];

export interface TechnologyResource {
  id: string;
  name: string;
  keywords: string[];
  body: string;
  source: "bundle" | "project";
}

export interface GeneratedAgentPlan {
  role: string;
  agentName: string;
  description: string;
  tools: string[];
  content: string;
}

export interface WriteAgentsResult {
  created: string[]; // new files written
  regenerated: string[]; // manifest-proven untouched files overwritten in place
  keptDrifted: string[]; // generated by us but user-edited (hash mismatch) — kept
  skipped: string[]; // existing files of unknown origin (not in manifest) — kept
}

// Bumped when the generated agent format changes. Written into the footer of
// every generated agent so doctor can detect files from an older format.
// v3: linter and full-test gained the write tool (they write report artifacts).
// v4: doc-writer roles carry a documentation contract (target, template, cap).
// v5: every role carries an invocationHint (frontmatter description trigger)
//     and an outOfScope section (boundary in the body).
// v6: doc-writer roles' outOfScope now forbids modifying tests or tested
//     code examples (prevents doc drift from breaking the test suite).
export const GENERATOR_VERSION = 6;

// Returns the sha256 of a file, or null when it cannot be read.
function hashFile(filePath: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

export function getBundledTechnologiesDir(): string {
  // resources/ is at repo root. From src/agents/generator.ts: up 3 levels in source
  // layout (agents/ → src/ → repo root), up 4 levels in dist layout.
  const sourceLayout = path.resolve(__dirname, "../../..", "resources", "technologies");
  if (fs.existsSync(path.join(sourceLayout, "generic.md"))) {
    return sourceLayout;
  }
  return path.resolve(__dirname, "../../../..", "resources", "technologies");
}

export function getProjectTechnologiesDir(cwd: string): string {
  return path.join(cwd, ".pi", "technologies");
}

export function parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function loadResourcesFromDir(dir: string, source: TechnologyResource["source"]): TechnologyResource[] {
  if (!fs.existsSync(dir)) return [];
  const resources: TechnologyResource[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".md") || entry === "_template.md") continue;
    const filePath = path.join(dir, entry);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
      const id = String(frontmatter.id ?? "").trim() || entry.slice(0, -3);
      const name = String(frontmatter.name ?? "").trim() || id;
      const keywords = parseKeywords(frontmatter.keywords);
      const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
      if (!body) continue;
      resources.push({ id, name, keywords, body, source });
    } catch {
      // Skip unreadable resource files.
    }
  }
  return resources;
}

// Bundled resources ship with the extension; a project can add or override
// them in .pi/technologies/ (project wins on matching id).
export function discoverTechnologyResources(cwd: string): TechnologyResource[] {
  const bundled = loadResourcesFromDir(getBundledTechnologiesDir(), "bundle");
  const project = loadResourcesFromDir(getProjectTechnologiesDir(cwd), "project");
  const projectIds = new Set(project.map((r) => r.id));
  return [...bundled.filter((r) => !projectIds.has(r.id)), ...project];
}

// Scores resources by keyword hits against the stack hints. Returns matched
// resources ordered by score; falls back to the "generic" resource when
// nothing matches, so generation never dead-ends.
export function matchTechnologies(stackHints: string[], resources: TechnologyResource[]): TechnologyResource[] {
  const haystack = stackHints.join(" ").toLowerCase();
  const scored = resources
    .filter((r) => r.id !== "generic" && r.id !== "_template")
    .map((r) => ({
      resource: r,
      score: r.keywords.reduce((acc, keyword) => (keyword && haystack.includes(keyword) ? acc + 1 : acc), 0),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return scored.map((s) => s.resource);
  }
  const generic = resources.find((r) => r.id === "generic");
  return generic ? [generic] : [];
}

export function getProjectSlug(cwd: string): string {
  const pkgPath = path.join(cwd, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
    if (typeof pkg.name === "string" && pkg.name.trim()) {
      return slugify(pkg.name);
    }
  } catch {
    // Fall through to the folder name.
  }
  return slugify(path.basename(cwd));
}

function buildProjectContextBlock(report: ArchitectReport | null): string {
  if (!report) return "";
  if (
    report.techStack.length === 0 &&
    report.atomicFunctions.length === 0 &&
    report.constraints.length === 0
  ) {
    return "";
  }
  const lines: string[] = ["## Project context", ""];
  if (report.techStack.length > 0) {
    lines.push("Technology stack:");
    for (const tech of report.techStack) lines.push(`- ${tech}`);
    lines.push("");
  }
  if (report.atomicFunctions.length > 0) {
    lines.push("Key functions in this project:");
    for (const fn of report.atomicFunctions) lines.push(`- ${fn}`);
    lines.push("");
  }
  if (report.constraints.length > 0) {
    lines.push("Constraints you must respect:");
    for (const constraint of report.constraints) lines.push(`- ${constraint}`);
  }
  return lines.join("\n").trim();
}

export function buildGeneratedAgentMarkdown(
  def: GeneratedRoleDef,
  agentName: string,
  projectName: string,
  resources: TechnologyResource[],
  report: ArchitectReport | null,
): string {
  // Description is the auto-invocation trigger. The harness reads this to
  // decide WHEN to spawn the agent — a vague description = wrong spawns.
  // Format: invocationHint + " — " + label + " for " + projectName.
  const description = `${def.invocationHint} — ${def.label} for ${projectName}. Generated by pi-senai.`;

  const lines = [
    "---",
    `name: ${agentName}`,
    `description: ${description}`,
    `tools: ${def.tools.join(", ")}`,
    "session-mode: lineage-only",
    "auto-exit: true",
    "spawning: false",
    ...(def.interactive ? ["interactive: true"] : []),
    "---",
    "",
    `# ${agentName}`,
    "",
    `You are the ${def.label} for the ${projectName} project.`,
    "",
    "## Your mandate",
    "",
    `- ${def.mandate}`,
    "- Report results with exact file paths and evidence. Do not modify anything outside your mandate.",
    "",
  ];

  // Out-of-scope section: explicit boundary so the agent does not drift into
  // another role's job. Rendered between mandate and completion contract so
  // it is visible alongside the rules the agent follows.
  if (def.outOfScope.length > 0) {
    lines.push("## Out of scope", "");
    for (const item of def.outOfScope) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push(
    "## Completion contract",
    "",
    "- Write your deliverable to the artifact path given in your task. The file on disk is the deliverable.",
    "- Your FINAL message must be at most 10 lines: outcome + artifact path(s). Never paste the deliverable content into the final message.",
  );

  // Doc-writer roles carry a documentation contract from the catalog: exact
  // default target, template id, required sections, and the hard length cap.
  if (def.docType) {
    const spec = getDocType(def.docType);
    lines.push(
      "",
      "## Documentation contract",
      "",
      `- Target: ${spec.defaultPath}`,
      `- Template: ${spec.id} (based on ${spec.basedOn})`,
      `- Hard length cap: ${spec.maxLines} lines. Shorter is better.`,
      `- Required sections, in order: ${spec.requiredSections.length > 0 ? spec.requiredSections.join(", ") : "(none fixed)"}`,
    );
  }

  const contextBlock = buildProjectContextBlock(report);
  if (contextBlock) {
    lines.push("", contextBlock);
  }

  for (const resource of resources) {
    lines.push("", `## Technology craft (${resource.name})`, "", resource.body);
  }

  const resourceIds = resources.map((r) => `\`${r.id}\``).join(", ");
  lines.push("", `---`, `_Generated by pi-senai (generator v${GENERATOR_VERSION}) from technology resource(s): ${resourceIds}._`);

  return lines.join("\n");
}

export function planAgentGeneration(
  cwd: string,
  roles: GeneratedRoleDef[],
  resources: TechnologyResource[],
  report: ArchitectReport | null,
): GeneratedAgentPlan[] {
  const slug = getProjectSlug(cwd);
  const projectName = slug;
  return roles.map((def) => {
    const agentName = `${slug}-${def.role}`;
    return {
      role: def.role,
      agentName,
      description: `${def.label} for ${projectName}. Generated by pi-senai.`,
      tools: def.tools,
      content: buildGeneratedAgentMarkdown(def, agentName, projectName, resources, report),
    };
  });
}

// Writes agent files into .pi/agents/. Files of unknown origin are NEVER
// overwritten — they are reported as skipped so the user keeps their own
// custom agents. With `regenerate: true`, files the manifest proves we
// generated AND the user never edited (hash still matches) are overwritten
// in place; user-edited files are kept and reported as keptDrifted.
// Written files are added to the generation manifest for drift tracking.
export function writeGeneratedAgents(
  cwd: string,
  plans: GeneratedAgentPlan[],
  opts?: { regenerate?: boolean },
): WriteAgentsResult {
  const agentsDir = path.join(cwd, ".pi", "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  const manifest = opts?.regenerate ? loadGeneratedManifest(cwd) : null;

  const created: string[] = [];
  const regenerated: string[] = [];
  const keptDrifted: string[] = [];
  const skipped: string[] = [];
  const writtenAbsolute: string[] = [];
  for (const plan of plans) {
    const filePath = path.join(agentsDir, `${plan.agentName}.md`);
    const rel = path.relative(cwd, filePath);
    if (fs.existsSync(filePath)) {
      if (!opts?.regenerate) {
        skipped.push(rel);
        continue;
      }
      const expectedHash = manifest?.files[rel];
      if (expectedHash === undefined) {
        // Not in the manifest — unknown origin, possibly hand-made. Never touch.
        skipped.push(rel);
        continue;
      }
      if (hashFile(filePath) !== expectedHash) {
        // User edited the file after generation. Keep their edits.
        keptDrifted.push(rel);
        continue;
      }
      atomicWriteFile(filePath, plan.content, "utf8");
      regenerated.push(rel);
      writtenAbsolute.push(filePath);
      continue;
    }
    atomicWriteFile(filePath, plan.content, "utf8");
    created.push(rel);
    writtenAbsolute.push(filePath);
  }
  if (writtenAbsolute.length > 0) {
    addToGeneratedManifest(cwd, writtenAbsolute);
  }
  return { created, regenerated, keptDrifted, skipped };
}

export interface RegenerationPreview {
  recreate: string[]; // mapped to a generated name but the file is missing
  overwrite: string[]; // manifest-proven untouched — safe to overwrite
  keptDrifted: string[]; // generated by us but user-edited — kept
  unknown: string[]; // exists but not in the manifest — never touched
}

// Classifies existing generated agent files exactly like writeGeneratedAgents
// with regenerate: true, but writes nothing. Used to preview the write set in
// the confirmation dialog. Paths are project-relative.
export function previewRegeneration(cwd: string, agentNames: string[]): RegenerationPreview {
  const manifest = loadGeneratedManifest(cwd);
  const preview: RegenerationPreview = { recreate: [], overwrite: [], keptDrifted: [], unknown: [] };
  for (const agentName of agentNames) {
    const filePath = path.join(cwd, ".pi", "agents", `${agentName}.md`);
    const rel = path.relative(cwd, filePath);
    if (!fs.existsSync(filePath)) {
      preview.recreate.push(rel);
      continue;
    }
    const expectedHash = manifest?.files[rel];
    if (expectedHash === undefined) {
      preview.unknown.push(rel);
      continue;
    }
    if (hashFile(filePath) !== expectedHash) {
      preview.keptDrifted.push(rel);
    } else {
      preview.overwrite.push(rel);
    }
  }
  return preview;
}
