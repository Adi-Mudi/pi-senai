import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parseFrontmatter, getAgentDir } from "@mariozechner/pi-coding-agent";
import { loadAgentConfig, resolveAgentName, type AgentConfig } from "../agents/config.js";
import { loadFilesConfig, type FilesConfig } from "../agents/files-config.js";
import { loadAgentsFilesConfig, type AgentsFilesConfig } from "../agents/agents-files-config.js";
import {
  type SenaiRole,
} from "../agents/suggestions.js";
import { loadGeneratedManifest } from "../architect/index.js";
import { cacheSize, oldestCacheTimestamp } from "../scouts/community-research.js";
import {
  GENERATED_ROLES,
  GENERATOR_VERSION,
  getBundledTechnologiesDir,
  getProjectSlug,
  getProjectTechnologiesDir,
  parseKeywords,
} from "../agents/generator.js";
import { DOC_TYPES, isDocStub, type DocTypeId } from "../docs-factory/catalog.js";

import {
	type DiagnosticItem,
	type DiagnosticSection,
	type DiagnosticReport,
} from "./_types.js";
import {
	compareVersions,
} from "./_helpers.js";
import * as ChecksRunState from "./checks-runstate.js";
import * as ChecksConfig from "./checks-config.js";
import * as ChecksAgents from "./checks-agents.js";
import * as ChecksArchitecture from "./checks-architecture.js";

// Re-export so existing consumers of `../doctor/index.js` keep working.
export {
	type DiagnosticStatus,
	type DiagnosticItem,
	type DiagnosticSection,
	type DiagnosticReport,
	type ResolvedAgent,
	BUILTIN_AGENT_NAMES,
	CONFLICTING_READONLY_PATTERNS,
	KNOWN_TOOL_NAMES,
	MANDATE_CHECK_ROLES,
	READONLY_ROLES,
	ROLE_REQUIRED_TOOLS,
	VALID_THINKING_LEVELS,
} from "./_types.js";
export {
	compareVersions,
	documentSignalWords,
	isKnownToolName,
	isPathConflict,
	mandateTextForRole,
	resolveSkillFile,
	significantWords,
	validateSkillFile,
	wordsOverlap,
} from "./_helpers.js";

export function runSenaiDiagnostic(cwd: string): DiagnosticReport {
  const sections: DiagnosticSection[] = [];

  let agentConfig: AgentConfig | null = null;
  let agentConfigError: string | null = null;
  try {
    agentConfig = loadAgentConfig(cwd);
  } catch (err: any) {
    agentConfigError = err.message;
  }

  let filesConfig: FilesConfig | null = null;
  let filesConfigError: string | null = null;
  try {
    filesConfig = loadFilesConfig(cwd);
  } catch (err: any) {
    filesConfigError = err.message;
  }

  let agentsFilesConfig: AgentsFilesConfig | null = null;
  let agentsFilesConfigError: string | null = null;
  try {
    agentsFilesConfig = loadAgentsFilesConfig(cwd);
  } catch (err: any) {
    agentsFilesConfigError = err.message;
  }

  sections.push(ChecksRunState.checkSetupProgress(cwd));
  sections.push(ChecksRunState.checkLock(cwd));
  sections.push(ChecksRunState.checkCadence(cwd));
  sections.push(ChecksConfig.checkConfigFiles(cwd, agentConfig, filesConfig, agentsFilesConfig, filesConfigError, agentConfigError, agentsFilesConfigError));
  sections.push(ChecksRunState.checkDiscussions(cwd));

  const resolvedAgents = ChecksAgents.resolveAllAgents(cwd, agentConfig);
  sections.push(ChecksAgents.checkAgentMappings(resolvedAgents));
  sections.push(ChecksAgents.checkAgentCapabilities(resolvedAgents));
  sections.push(checkTestingDiscipline(cwd, filesConfig));
  sections.push(ChecksRunState.checkRunArtifacts(cwd));

  if (filesConfig) {
    sections.push(ChecksConfig.checkFileScope(cwd, filesConfig));
  }

  if (agentsFilesConfig) {
    sections.push(ChecksConfig.checkAgentsFiles(cwd, agentsFilesConfig, filesConfig, resolvedAgents));
  }

  sections.push(checkEnvironment());
  sections.push(checkSubagentExtension());
  sections.push(checkStrayFiles(cwd));
  sections.push(ChecksArchitecture.checkArchitectureSetup(cwd));
  sections.push(ChecksArchitecture.checkArchitectureAgentMapping(cwd, agentConfig));
  sections.push(ChecksArchitecture.checkGeneratedAgentContent(cwd));
  sections.push(checkArchitectureDrift(cwd));
  sections.push(checkGeneratedTeamContent(cwd, agentConfig));
  sections.push(checkGeneratedRolesCompleteness(cwd));
  sections.push(checkTechnologyResources(cwd));
  sections.push(ChecksAgents.checkAgentSkillReferences(cwd, resolvedAgents));
  sections.push(ChecksAgents.checkAgentFileIntegrity(cwd, resolvedAgents));
  sections.push(checkSecretScan(cwd));
  sections.push(checkDocsFactory(cwd));
  sections.push(checkCommunityResearchCache(cwd));

  const summary = sections.reduce(
    (acc, section) => {
      for (const item of section.items) {
        acc[item.status]++;
      }
      return acc;
    },
    { ok: 0, warning: 0, error: 0, info: 0 },
  );

  const ok = summary.error === 0;

  return { ok, summary, sections };
}

/** Post-hoc audit of the recorded run: verifies that every artifact a stage
 *  was supposed to produce actually exists and is non-empty. Catches the
 *  "subagent reported completed but wrote nothing" failure seen in real
 *  sessions, which the parent only noticed after user prodding. */
function checkTestingDiscipline(cwd: string, filesConfig: FilesConfig | null): DiagnosticSection {
  // Single-glance audit for the testing-discipline feature added in v2.0+.
  // Reads environment variables, files.json testPaths, and the three stage
  // skills to surface the discipline's runtime state without running the
  // scanner itself. All items are info or warning — never error — because
  // the discipline is opt-in.
  const items: DiagnosticItem[] = [];

  // 1. Strict mode status (always shown).
  const strictMode = process.env.SENAI_TEST_DISCIPLINE_STRICT === "1";
  items.push({
    status: "info",
    message: `Strict mode: ${strictMode ? "on (blocking findings will halt advance)" : "off (advisory; set SENAI_TEST_DISCIPLINE_STRICT=1 to enable)"}`,
  });

  // 2. Coverage floor (always shown).
  const floorRaw = process.env.SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR;
  const floor = floorRaw && floorRaw !== "" && Number.isFinite(Number(floorRaw)) ? Number(floorRaw) : 80;
  items.push({
    status: "info",
    message: `Coverage floor: ${floor}% (set SENAI_TEST_DISCIPLINE_COVERAGE_FLOOR to override; 0 disables)`,
  });

  // 3. Test paths configured.
  const testPaths = filesConfig?.testPaths ?? [];
  if (testPaths.length === 0) {
    items.push({
      status: "warning",
      message: "Test paths are not configured in files.json — the scanner cannot run.",
      details: ["Run /senai-configure-files and set the testPaths field so senai_scan_test_smells has files to scan."],
    });
  } else {
    items.push({
      status: "ok",
      message: `Test paths configured: ${testPaths.length} entr${testPaths.length === 1 ? "y" : "ies"} in files.json.`,
    });
  }

  // 4. Scanner module compiled and present in dist/.
  try {
    const distPath = path.join(cwd, "dist", "pi-extension", "src", "test-discipline.js");
    if (fs.existsSync(distPath)) {
      items.push({
        status: "ok",
        message: "Scanner module compiled (test-discipline.js present in dist/).",
      });
    } else {
      items.push({
        status: "warning",
        message: "Scanner module dist/ not found — run `npm run build` before testing the scanner.",
      });
    }
  } catch {
    items.push({
      status: "warning",
      message: "Scanner module check failed unexpectedly.",
    });
  }

  // 5. Stage skills carry the discipline block.
  const skillFiles = [
    "skills/senai-implement.md",
    "skills/senai-document.md",
    "skills/senai-deliver.md",
  ];
  const missing = skillFiles.filter((rel) => {
    const p = path.join(cwd, rel);
    if (!fs.existsSync(p)) return true;
    try {
      return !fs.readFileSync(p, "utf8").includes("## Testing discipline");
    } catch {
      return true;
    }
  });
  if (missing.length === 0) {
    items.push({ status: "ok", message: "Stage skills carry ## Testing discipline: implement, document, deliver." });
  } else {
    items.push({
      status: "warning",
      message: `${missing.length} stage skill(s) missing the ## Testing discipline block.`,
      details: missing,
    });
  }

  // 6. Generated agents on the latest version.
  const agentsDir = path.join(cwd, ".pi", "agents");
  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    if (files.length === 0) {
      items.push({ status: "info", message: "No generated agents yet — run /senai-generate-sub-agents." });
    } else {
      const onLatest = files.filter((f) => {
        try {
          return fs.readFileSync(path.join(agentsDir, f), "utf8").includes(`(generator v${GENERATOR_VERSION})`);
        } catch {
          return false;
        }
      });
      const stale = files.filter((f) => !onLatest.includes(f));
      if (stale.length === 0) {
        items.push({
          status: "ok",
          message: `Generated agents on v${GENERATOR_VERSION}: ${onLatest.length} of ${files.length}.`,
        });
      } else {
        items.push({
          status: "warning",
          message: `Generated agents on v${GENERATOR_VERSION}: ${onLatest.length} of ${files.length} (${stale.length} stale).`,
          details: stale,
        });
      }
    }
  } else {
    items.push({ status: "info", message: "No generated agents yet — run /senai-generate-sub-agents." });
  }

  return { title: "Testing discipline", items };
}
function checkEnvironment(): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const inTmux = !!process.env.TMUX;
  const inZellij = !!process.env.ZELLIJ;

  if (inTmux) {
    items.push({ status: "ok", message: "Running inside tmux." });
  } else if (inZellij) {
    items.push({ status: "ok", message: "Running inside Zellij." });
  } else {
    items.push({
      status: "warning",
      message: "Not running inside tmux or Zellij.",
      details: [
        "pi-interactive-subagents needs a terminal multiplexer to spawn subagent panes.",
        "Start Pi inside tmux or Zellij before running Senai stages.",
      ],
    });
  }

  try {
    const settingsPath = path.join(getAgentDir(), "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
        retry?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number };
        compaction?: { enabled?: boolean; reserveTokens?: number };
      };
      if (settings.retry?.enabled === false) {
        items.push({
          status: "warning",
          message: "pi retry is disabled (retry.enabled = false).",
          details: [
            "Subagents that hit provider overload or rate limits fail immediately instead of retrying.",
            "Re-enable retries in settings.json for reliable orchestration.",
          ],
        });
      } else {
        items.push({ status: "ok", message: "pi retry settings are enabled." });
        const maxRetries = settings.retry?.maxRetries;
        if (maxRetries === undefined || maxRetries < 5) {
          items.push({
            status: "info",
            message: `retry.maxRetries is ${maxRetries ?? "default (3)"} — recommend >= 5 for senai runs.`,
            details: [
              "Parallel subagent spawns can hit provider 429s; pi's default backoff (3 attempts at 2/4/8s) is too short.",
              `Set "retry": { "maxRetries": 5, "baseDelayMs": 5000 } in ${settingsPath}.`,
            ],
          });
        }
      }
      if (settings.compaction?.enabled === false) {
        items.push({
          status: "warning",
          message: "pi compaction is disabled (compaction.enabled = false).",
          details: [
            "Long senai runs will overflow the context window instead of compacting.",
            "Re-enable compaction or remove the flag in settings.json.",
          ],
        });
      } else {
        const reserve = settings.compaction?.reserveTokens ?? 16384;
        items.push({
          status: "info",
          message: `pi auto-compacts when context exceeds contextWindow - ${reserve} tokens.`,
          details: [
            "Senai's stage-boundary compaction targets 40% of the window so it fires before this threshold.",
          ],
        });
      }
    }
  } catch {
    items.push({
      status: "info",
      message: "Could not read pi settings.json to verify retry settings.",
    });
  }

  return { title: "Runtime environment", items };
}

/** Known extensions that provide a `subagent` tool. More than one installed
 *  means ambiguous tool resolution and conflicting behavior. */
const SUBAGENT_PROVIDER_PACKAGES = [
  "pi-interactive-subagents",
  "pi-subagents",
  "pi-teams",
  "extensions/subagent",
];

/** Compares dotted versions; returns negative when a < b. */
/** Reads pi's user-level package list (read-only) and verifies the subagent
 *  extension senai depends on: present, new enough, and not shadowed by
 *  dead entries or competing providers. */
function checkSubagentExtension(): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const agentDir = getAgentDir();
  const settingsPath = path.join(agentDir, "settings.json");

  let packages: string[] = [];
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { packages?: string[] };
    packages = Array.isArray(settings.packages) ? settings.packages : [];
  } catch {
    return {
      title: "Subagent extension",
      items: [{ status: "info", message: "Could not read pi settings.json — subagent extension check skipped." }],
    };
  }

  // Dead local-path package entries (non npm:/git: sources that don't exist).
  for (const pkg of packages) {
    if (pkg.startsWith("npm:") || pkg.startsWith("git:")) continue;
    const pkgPath = path.isAbsolute(pkg) ? pkg : path.join(agentDir, pkg);
    if (!fs.existsSync(pkgPath)) {
      items.push({
        status: "warning",
        message: `Dead package entry in settings.json: "${pkg}"`,
        details: [
          `Resolved path does not exist: ${pkgPath}`,
          "A stale entry that later reappears can shadow the real subagent extension. Remove it from settings.json.",
        ],
      });
    }
  }

  // Multiple subagent providers installed.
  const providers = packages.filter((pkg) =>
    SUBAGENT_PROVIDER_PACKAGES.some((known) => pkg.includes(known)),
  );
  if (providers.length > 1) {
    items.push({
      status: "warning",
      message: `Multiple subagent-providing extensions installed: ${providers.join(", ")}`,
      details: [
        "Senai is tested against pi-interactive-subagents; other providers may register conflicting `subagent` tools.",
        "Keep exactly one subagent provider in the packages list.",
      ],
    });
  }

  // pi-interactive-subagents presence and version (git packages live in <agentDir>/git/<host>/<owner>/<repo>/).
  const hasHazAT = packages.some((pkg) => pkg.includes("pi-interactive-subagents"));
  if (!hasHazAT) {
    items.push({
      status: "error",
      message: "pi-interactive-subagents is not in pi's packages list.",
      details: ["Senai delegates all subagent spawning to it. Install: pi install git:github.com/HazAT/pi-interactive-subagents"],
    });
  } else {
    let version: string | null = null;
    try {
      const pkgJson = path.join(agentDir, "git", "github.com", "HazAT", "pi-interactive-subagents", "package.json");
      version = (JSON.parse(fs.readFileSync(pkgJson, "utf8")) as { version?: string }).version ?? null;
    } catch {
      version = null;
    }
    if (version === null) {
      items.push({ status: "info", message: "pi-interactive-subagents is listed but its installed version could not be read." });
    } else if (compareVersions(version, "3.7.2") < 0) {
      items.push({
        status: "warning",
        message: `pi-interactive-subagents ${version} is older than 3.7.2.`,
        details: ["Update it — older versions lack the failure reporting senai relies on."],
      });
    } else {
      items.push({ status: "ok", message: `pi-interactive-subagents ${version} installed.` });
    }
  }

  return { title: "Subagent extension", items };
}

/** Leftover helper scripts (tmp_*.sh / tmp_*.ts) in the project root or run
 *  directories — debris from subagent heredoc workarounds. */
function checkStrayFiles(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const stray: string[] = [];
  const isStray = (name: string) => /^tmp_.*\.(sh|ts)$/.test(name);

  try {
    for (const entry of fs.readdirSync(cwd)) {
      if (isStray(entry)) stray.push(entry);
    }
  } catch {
    /* unreadable root — nothing to report */
  }

  const runsDir = path.join(cwd, ".IDE_Plans", "pi-senai", "runs");
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), entryRel, depth + 1);
      } else if (isStray(entry.name)) {
        stray.push(path.join(".IDE_Plans", "pi-senai", "runs", entryRel).replace(/\\/g, "/"));
      }
    }
  };
  walk(runsDir, "", 0);

  if (stray.length > 0) {
    items.push({
      status: "warning",
      message: `${stray.length} stray tmp_* helper file(s) found`,
      details: [...stray, "Leftovers from subagent heredoc workarounds. Review and delete them."],
    });
  } else {
    items.push({ status: "ok", message: "No stray tmp_* helper files." });
  }
  return { title: "Stray files", items };
}


function checkArchitectureDrift(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const manifest = loadGeneratedManifest(cwd);
  if (!manifest) {
    items.push({
      status: "info",
      message: "No generation manifest found. Drift check skipped.",
      details: [
        "This architecture was generated before drift tracking existed.",
        "Re-run /senai-generate-architect to enable drift detection.",
      ],
    });
    return { title: "Architecture drift", items };
  }

  const problems: DiagnosticItem[] = [];
  const slug = getProjectSlug(cwd);
  const teamAgentPaths = new Set(
    GENERATED_ROLES.map((def) => path.join(".pi", "agents", `${slug}-${def.role}.md`)),
  );
  // Advice differs per file type: the architecture factory only regenerates
  // architecture files; team agents are regenerated by the sub-agent command.
  const fixAdvice = (relPath: string): string =>
    teamAgentPaths.has(relPath)
      ? "If this was not intentional, re-run /senai-generate-sub-agents."
      : "If this was not intentional, re-run /senai-generate-architect.";
  for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
    const filePath = path.resolve(cwd, relPath);
    if (!fs.existsSync(filePath)) {
      problems.push({
        status: "warning",
        message: `Generated file was deleted: ${relPath}`,
        details: [fixAdvice(relPath)],
      });
      continue;
    }
    const actualHash = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    if (actualHash !== expectedHash) {
      problems.push({
        status: "warning",
        message: `${relPath} was modified after generation.`,
        details: [fixAdvice(relPath)],
      });
    }
  }

  if (problems.length === 0) {
    items.push({
      status: "ok",
      message: `All ${Object.keys(manifest.files).length} generated files match the generation manifest.`,
    });
  } else {
    items.push(...problems);
  }

  return { title: "Architecture drift", items };
}

function checkGeneratedTeamContent(cwd: string, agentConfig: AgentConfig | null): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const slug = getProjectSlug(cwd);
  let found = 0;

  for (const def of GENERATED_ROLES) {
    const expectedName = `${slug}-${def.role}`;
    const actual = resolveAgentName(agentConfig, def.role as SenaiRole);
    if (actual !== expectedName) continue; // custom mapping — not a generated team agent

    const filePath = path.join(cwd, ".pi", "agents", `${expectedName}.md`);
    if (!fs.existsSync(filePath)) continue; // missing files are reported by the mapping sources section

    found++;
    const content = fs.readFileSync(filePath, "utf8");
    const problems: string[] = [];

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    if (!/^tools:/m.test(frontmatter)) {
      problems.push("frontmatter is missing a tools: line");
    }
    if (!content.includes("## Your mandate")) {
      problems.push("body is missing the '## Your mandate' section");
    }
    if (!content.includes("## Technology craft")) {
      problems.push("body is missing a '## Technology craft' section");
    }

    if (problems.length === 0) {
      if (!content.includes(`(generator v${GENERATOR_VERSION})`)) {
        items.push({
          status: "warning",
          message: `${expectedName}: generated by an older pi-senai version`,
          details: [
            "Re-run /senai-generate-sub-agents to update it in place.",
            "If you edited the file after generation, your edits are detected and kept.",
          ],
        });
      } else {
        items.push({ status: "ok", message: `${expectedName}: content complete` });
      }
    } else {
      items.push({
        status: "error",
        message: `${expectedName}: content is incomplete`,
        details: [...problems, "Fix: re-run /senai-generate-sub-agents to regenerate it."],
      });
    }
  }

  // Orphaned generated agents: carry the "Generated by pi-senai" marker but
  // no generated role maps to them (e.g. the role was remapped to a custom
  // or built-in agent). Reported only — deletion stays a user decision.
  const agentsDir = path.join(cwd, ".pi", "agents");
  if (fs.existsSync(agentsDir)) {
    const mappedNames = new Set(
      GENERATED_ROLES.map((def) => resolveAgentName(agentConfig, def.role as SenaiRole)),
    );
    for (const entry of fs.readdirSync(agentsDir)) {
      if (!entry.endsWith(".md")) continue;
      const name = entry.slice(0, -3);
      if (mappedNames.has(name)) continue;
      let orphanContent = "";
      try {
        orphanContent = fs.readFileSync(path.join(agentsDir, entry), "utf8");
      } catch {
        continue;
      }
      if (!orphanContent.includes("Generated by pi-senai")) continue;
      items.push({
        status: "info",
        message: `Orphaned generated agent: ${name}`,
        details: [
          "No Senai role maps to this file.",
          `If you do not need it, delete .pi/agents/${entry}.`,
        ],
      });
    }
  }

  if (found === 0) {
    items.push({
      status: "info",
      message: "No generated team agents found. Run /senai-generate-sub-agents to create them.",
    });
  }

  return { title: "Generated team agents", items };
}

/**
 * Pin check: every GENERATED_ROLES row carries the v5 fields (invocationHint
 * + outOfScope) and the running GENERATOR_VERSION matches the latest
 * generator. Catches future code regressions where a role is added without
 * the new fields, or where the version constant is bumped but the test
 * pinning is missed.
 */
function checkGeneratedRolesCompleteness(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  // 1. Every GENERATED_ROLES row has invocationHint + outOfScope.
  const missingFields: string[] = [];
  for (const def of GENERATED_ROLES) {
    const hasHint = typeof def.invocationHint === "string" && def.invocationHint.length > 0;
    const hasOOS = Array.isArray(def.outOfScope) && def.outOfScope.length >= 1;
    if (!hasHint) missingFields.push(`${def.role} (no invocationHint)`);
    if (!hasOOS) missingFields.push(`${def.role} (no outOfScope)`);
  }
  if (missingFields.length === 0) {
    items.push({
      status: "ok",
      message: `All ${GENERATED_ROLES.length} GENERATED_ROLES rows have invocationHint + outOfScope.`,
    });
  } else {
    items.push({
      status: "warning",
      message: `${missingFields.length} GENERATED_ROLES row(s) missing required v5 fields.`,
      details: missingFields,
    });
  }

  // 2. Generated agents on latest version — duplicate count for stand-alone pin.
  const agentsDir = path.join(cwd, ".pi", "agents");
  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    if (files.length > 0) {
      const onLatest = files.filter((f) => {
        try {
          return fs.readFileSync(path.join(agentsDir, f), "utf8").includes(`(generator v${GENERATOR_VERSION})`);
        } catch {
          return false;
        }
      });
      if (onLatest.length < files.length) {
        items.push({
          status: "info",
          message: `Agent version distribution: ${onLatest.length} on v${GENERATOR_VERSION}, ${files.length - onLatest.length} on older.`,
        });
      }
    }
  }

  return { title: "Sub-agent generator completeness", items };
}

function checkTechnologyResources(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  const dirs: Array<{ dir: string; label: string }> = [
    { dir: getBundledTechnologiesDir(), label: "bundled" },
    { dir: getProjectTechnologiesDir(cwd), label: "project" },
  ];

  let bundledGenericFound = false;
  let resourceCount = 0;

  for (const { dir, label } of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".md") || entry === "_template.md") continue;
      const filePath = path.join(dir, entry);
      const problems: string[] = [];
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
        const id = String(frontmatter.id ?? "").trim();
        if (!id) problems.push("frontmatter is missing an id");
        const keywords = parseKeywords(frontmatter.keywords);
        const hasKeywords = keywords.length > 0;
        if (!hasKeywords) problems.push("frontmatter has no keywords (matching will never find it)");
        const normalizeKey = (s: string) => s.toLowerCase().replace(/[-\s]+/g, " ").trim();
        if (id && hasKeywords && !keywords.some((k) => normalizeKey(k) === normalizeKey(id))) {
          problems.push(`keywords do not include the resource id "${id}" (matching by name will miss it)`);
        }
        const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
        if (!body) problems.push("body is empty");

        // Technical validation: craft sections and sourcing.
        if (body) {
          const missingSections: string[] = [];
          if (!/^##\s+Core rules/im.test(body)) missingSections.push("## Core rules");
          if (!/^##\s+Testing patterns/im.test(body)) missingSections.push("## Testing patterns");
          if (!/^##\s+(Tooling and limits|Common mistakes)/im.test(body)) {
            missingSections.push("## Tooling and limits or ## Common mistakes");
          }
          if (missingSections.length > 0) {
            problems.push(`missing template section(s): ${missingSections.join(", ")}`);
          }
          if (id !== "generic" && !/https?:\/\//.test(body)) {
            problems.push("no official source URL cited (sourcing rule)");
          }
        }

        if (label === "bundled" && id === "generic" && problems.length === 0) {
          bundledGenericFound = true;
        }
      } catch {
        problems.push("file could not be parsed");
      }

      if (problems.length === 0) {
        resourceCount++;
      } else {
        items.push({
          status: "warning",
          message: `${label} resource ${entry} has problems`,
          details: problems,
        });
      }
    }
  }

  if (!bundledGenericFound) {
    items.push({
      status: "error",
      message: "The bundled generic.md fallback resource is missing or invalid.",
      details: ["Restore resources/technologies/generic.md in the extension."],
    });
  }

  if (resourceCount > 0) {
    items.push({ status: "ok", message: `${resourceCount} technology resource(s) valid.` });
  }

  return { title: "Technology resources", items };
}

const SECRET_PATTERNS: RegExp[] = [
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/i,
  /secret\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/i,
  /password\s*[:=]\s*["']?[^\s"']{6,}/i,
  /token\s*[:=]\s*["']?[A-Za-z0-9_\-.]{10,}/i,
  /BEGIN [A-Z]+ PRIVATE KEY/,
  /sk-[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z_\-]{20,}/,
];

function checkSecretScan(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const filesToScan: string[] = [];

  const agentsDir = path.join(cwd, ".pi", "agents");
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir)) {
      if (entry.endsWith(".md")) filesToScan.push(path.join(agentsDir, entry));
    }
  }
  const skillsDir = path.join(cwd, ".pi", "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
      if (fs.existsSync(skillPath)) filesToScan.push(skillPath);
    }
  }
  const senaiDir = path.join(cwd, ".pi", "senai");
  if (fs.existsSync(senaiDir)) {
    for (const entry of fs.readdirSync(senaiDir)) {
      if (entry.endsWith(".json")) filesToScan.push(path.join(senaiDir, entry));
    }
  }

  for (const filePath of filesToScan) {
    let lines: string[];
    try {
      lines = fs.readFileSync(filePath, "utf8").split("\n");
    } catch {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      if (SECRET_PATTERNS.some((pattern) => pattern.test(lines[i]))) {
        items.push({
          status: "warning",
          message: `Possible secret at ${path.relative(cwd, filePath)}:${i + 1}`,
          details: ["Move secrets to environment variables. Never commit them."],
        });
      }
    }
  }

  if (items.length === 0) {
    items.push({ status: "ok", message: `No secrets found in ${filesToScan.length} scanned file(s).` });
  }

  return { title: "Secret scan", items };
}

interface DocsStructureManifestTarget {
  path: string;
  docType: string;
  maxLines: number;
}

/** Doc factory checks:
 *  1. For each manifest target that is filled (no longer a stub): validate the
 *     template's required sections are present, in order, and the file is
 *     within its length cap. Over cap or missing section → warning naming the
 *     file, the count/section, and the cap.
 *  2. Missing skeleton stubs → warning; unexpected non-stub files in
 *     factory-owned subfolders → info. */
function checkDocsFactory(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const manifestPath = path.join(cwd, ".pi", "senai", "docs-structure.json");
  if (!fs.existsSync(manifestPath)) {
    items.push({
      status: "info",
      message: "No docs skeleton generated.",
      details: [
        "Run /senai-generate-docs-structure to create the docs folder skeleton and template stubs for the selected document types.",
      ],
    });
    return { title: "Documentation factory", items };
  }

  let targets: DocsStructureManifestTarget[];
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const rawTargets = Array.isArray(parsed.targets) ? parsed.targets : [];
    targets = rawTargets
      .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
      .map((t) => ({
        path: String(t.path ?? ""),
        docType: String(t.docType ?? ""),
        maxLines: typeof t.maxLines === "number" ? t.maxLines : 0,
      }))
      .filter((t) => t.path.length > 0);
  } catch (err: any) {
    items.push({
      status: "warning",
      message: `Docs structure manifest is corrupt: ${err.message}`,
      details: ["Fix: re-run /senai-generate-docs-structure to rewrite .pi/senai/docs-structure.json."],
    });
    return { title: "Documentation factory", items };
  }

  const manifestPaths = new Set(targets.map((t) => t.path));

  for (const target of targets) {
    const fullPath = path.join(cwd, target.path);
    if (!fs.existsSync(fullPath)) {
      items.push({
        status: "warning",
        message: `Skeleton doc missing: ${target.path}`,
        details: [
          "The docs skeleton was generated but this stub was deleted.",
          "Fix: re-run /senai-generate-docs-structure.",
        ],
      });
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    if (isDocStub(content)) continue; // unfilled stub: nothing to validate yet
    const spec = target.docType in DOC_TYPES ? DOC_TYPES[target.docType as DocTypeId] : undefined;
    if (!spec) continue;
    const lines = content.split("\n");
    if (lines.length > spec.maxLines) {
      items.push({
        status: "warning",
        message: `${target.path} is ${lines.length} lines — over the ${spec.maxLines}-line cap (${spec.basedOn}).`,
        details: [
          "The doc factory keeps docs short and cheap in tokens. Trim to the cap; move detail into a linked page of the same type.",
        ],
      });
    }
    let cursor = -1;
    for (const section of spec.requiredSections) {
      const idx = lines.findIndex((l, i) => i > cursor && l.trim() === section);
      if (idx === -1) {
        items.push({
          status: "warning",
          message: `${target.path} is missing required section "${section}" (template: ${spec.id}).`,
          details: [`Template ${spec.id} requires, in order: ${spec.requiredSections.join(", ")}.`],
        });
      } else {
        cursor = idx;
      }
    }
  }

  const factoryDirs = ["docs/tutorials", "docs/how-to", "docs/reference", "docs/explanation", "docs/adr"];
  const stray: string[] = [];
  for (const dir of factoryDirs) {
    const fullDir = path.join(cwd, dir);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(fullDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const rel = `${dir}/${entry}`;
      if (manifestPaths.has(rel)) continue;
      let content = "";
      try {
        content = fs.readFileSync(path.join(fullDir, entry), "utf8");
      } catch {
        continue;
      }
      if (!isDocStub(content)) stray.push(rel);
    }
  }
  if (stray.length > 0) {
    items.push({
      status: "info",
      message: `${stray.length} file(s) in factory docs folders are not part of the generated skeleton.`,
      details: [
        ...stray,
        "Not an error — your own docs are fine here. Regenerate the skeleton if they should be factory-managed.",
      ],
    });
  }

  if (items.length === 0) {
    items.push({
      status: "ok",
      message: `Docs skeleton intact (${targets.length} target(s)); all filled docs within template and length limits.`,
    });
  }

  return { title: "Documentation factory", items };
}

/** Reports the cross-run community-research cache state. Always emitted, even
 *  when the cache is empty (informational). Includes file count, oldest
 *  entry timestamp, and a hint for manual purge. */
function checkCommunityResearchCache(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const size = cacheSize(cwd);
  const oldest = oldestCacheTimestamp(cwd);

  if (size === 0) {
    items.push({
      status: "info",
      message: "Community research cache: empty (no /senai-discussion scout runs yet).",
    });
    return { title: "Community research cache", items };
  }

  items.push({
    status: "info",
    message: `Community research cache: ${size} file(s) under .IDE_Plans/pi-senai/.cache/community-research/.`,
  });
  if (oldest) {
    items.push({
      status: "info",
      message: `  Oldest entry: ${oldest}`,
    });
  }
  items.push({
    status: "info",
    message: "Run /senai-purge-community-cache to clear the cache.",
  });

  return { title: "Community research cache", items };
}

export function formatDiagnosticReport(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push("# Pi Senai Diagnostic Report");
  lines.push("");
  lines.push(
    `Summary: ${report.summary.ok} OK, ${report.summary.warning} warnings, ${report.summary.error} errors, ${report.summary.info} info`,
  );
  lines.push("");
  lines.push(report.ok ? "✅ Configuration looks good." : "❌ Please fix the errors above before running Senai stages.");
  lines.push("");

  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    for (const item of section.items) {
      const icon =
        item.status === "ok"
          ? "✅"
          : item.status === "warning"
            ? "⚠️"
            : item.status === "error"
              ? "❌"
              : "ℹ️";
      lines.push(`${icon} ${item.message}`);
      if (item.details) {
        for (const detail of item.details) {
          lines.push(`   - ${detail}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Discussion checks:
 *  1. For each run directory containing a discussions/ folder, validate that
 *     exactly one discussion transcript subfolder is active — multiple active
 *     subfolders → warning naming the run id.
 *  2. For every existing mission-brief.md (pre-run and per-run), validate
 *     that all REQUIRED_BRIEF_SECTIONS are present, in order. Missing
 *     sections → warning naming the file and the missing section.
 *  3. Orphan pre-run discussion folder with no mission-brief.md → info
 *     (the user started a discussion but never wrote the brief). */

export {
	checkSetupProgress,
	checkLock,
	checkCadence,
	checkRunArtifacts,
	checkDiscussions,
} from "./checks-runstate.js";

export {
	checkConfigFiles,
	checkFileScope,
	checkAgentsFiles,
} from "./checks-config.js";

export {
	resolveAllAgents,
	checkAgentMappings,
	checkAgentCapabilities,
	checkAgentSkillReferences,
	checkAgentFileIntegrity,
} from "./checks-agents.js";

export {
	checkArchitectureSetup,
	checkArchitectureAgentMapping,
	checkGeneratedAgentContent,
} from "./checks-architecture.js";
