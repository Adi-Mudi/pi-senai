import * as fs from "node:fs";
import * as path from "node:path";

import { getAgentDir } from "@mariozechner/pi-coding-agent";

import { compareVersions } from "./_helpers.js";
import type { DiagnosticItem, DiagnosticSection } from "./_types.js";

/** Known extensions that provide a `subagent` tool. More than one installed
 *  means ambiguous tool resolution and conflicting behavior. */
const SUBAGENT_PROVIDER_PACKAGES = [
  "pi-interactive-subagents",
  "pi-subagents",
  "pi-teams",
  "extensions/subagent",
];

export function checkEnvironment(): DiagnosticSection {
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

/** Compares dotted versions; returns negative when a < b. */
/** Reads pi's user-level package list (read-only) and verifies the subagent
 *  extension senai depends on: present, new enough, and not shadowed by
 *  dead entries or competing providers. */
export function checkSubagentExtension(): DiagnosticSection {
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
export function checkStrayFiles(cwd: string): DiagnosticSection {
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

const SECRET_PATTERNS: RegExp[] = [
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/i,
  /secret\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/i,
  /password\s*[:=]\s*["']?[^\s"']{6,}/i,
  /token\s*[:=]\s*["']?[A-Za-z0-9_\-.]{10,}/i,
  /BEGIN [A-Z]+ PRIVATE KEY/,
  /sk-[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z_\-]{20,}/,
];

export function checkSecretScan(cwd: string): DiagnosticSection {
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
