import * as fs from "node:fs";
import * as path from "node:path";

import { resolveAgentName, type AgentConfig } from "../agents/config.js";
import { type SenaiRole } from "../agents/suggestions.js";
import {
  ARCHITECT_ROLES,
  ARCHITECT_STAGES,
  ARCHITECTURE_AGENT_MAPPING,
  discoverArchitectureLibrary,
  loadArchitectProfile,
  loadArchitectReport,
  slugify,
  type ArchitectProfile,
  type ArchitectReport,
} from "../architect/index.js";
import { loadDrivers } from "../architect/drivers.js";
import { loadArchitectInputsConfig } from "../architect/inputs-config.js";
import { getArchitectStateDir } from "../core/paths.js";

import type { DiagnosticItem, DiagnosticSection } from "./_types.js";

// Roles that must resolve to the generated architecture agents once an
// architecture has been generated. scout-1 shares the generated planner agent.
// Role→suffix pairs come from ARCHITECTURE_AGENT_MAPPING (single source of
// truth in architect.ts); labels below are doctor-only display text.
const ARCHITECTURE_ROLE_LABELS: Record<string, string> = {
  "scout-1": "Scout Architecture",
  planner: "Architecture Planner",
  implementer: "Architecture Implementer",
  "reviewer-correctness": "Architecture Reviewer — Correctness",
  "reviewer-security": "Architecture Reviewer — Security",
  "reviewer-tests": "Architecture Reviewer — Tests",
  "code-review": "Architecture Code Review",
};

const ARCHITECTURE_MAPPED_ROLES: Array<{ role: SenaiRole; label: string; expectedSuffix: string }> =
  ARCHITECTURE_AGENT_MAPPING.map(({ role, suffix }) => ({
    role,
    label: ARCHITECTURE_ROLE_LABELS[role] ?? role,
    expectedSuffix: suffix,
  }));

/** Architecture setup: validates the architecture factory outputs (library
 *  entries, inputs config, drivers, profile, report, expected agents/skills,
 *  architecture.md, ADR files). Emits OK per check, errors for missing or
 *  malformed artifacts, info when the factory has not been run yet. */
export function checkArchitectureSetup(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];
  const architectStateDir = getArchitectStateDir(cwd);

  const library = discoverArchitectureLibrary(cwd);
  if (library.length === 0) {
    items.push({
      status: "warning",
      message: "Architecture library is empty or missing.",
      details: ["Create .pi/architecture-library/*.md or *.json files with architecture references."],
    });
  } else {
    items.push({
      status: "ok",
      message: `Architecture library has ${library.length} entries.`,
    });
  }

  let inputsConfig: ReturnType<typeof loadArchitectInputsConfig> = null;
  let inputsConfigError: string | null = null;
  try {
    inputsConfig = loadArchitectInputsConfig(cwd);
  } catch (err: any) {
    inputsConfigError = err.message;
  }
  if (inputsConfigError) {
    items.push({
      status: "error",
      message: inputsConfigError,
      details: ["Run /senai-configure-architect-inputs to recreate it, or fix the JSON manually."],
    });
  } else if (!inputsConfig) {
    items.push({
      status: "info",
      message: "No architect inputs configured. Run /senai-configure-architect-inputs to set them.",
    });
  } else {
    const missingFiles: string[] = [];
    for (const doc of inputsConfig.documents) {
      const fullPath = path.resolve(cwd, doc.path);
      if (!fs.existsSync(fullPath)) {
        missingFiles.push(doc.path);
      }
    }
    if (missingFiles.length > 0) {
      items.push({
        status: "error",
        message: `${missingFiles.length} configured architect input documents are missing.`,
        details: missingFiles,
      });
    } else {
      items.push({
        status: "ok",
        message: `Architect inputs configured with ${inputsConfig.documents.length} documents.`,
      });
    }
  }

  try {
    const drivers = loadDrivers(cwd);
    if (!drivers) {
      items.push({
        status: "info",
        message: "No architectural drivers generated yet. Run /senai-generate-architect.",
      });
    } else {
      items.push({
        status: "ok",
        message: `Architectural drivers file exists at .pi/architect/architectural-drivers.json.`,
      });
    }
  } catch (err: any) {
    items.push({
      status: "error",
      message: `Invalid architectural drivers at .pi/architect/architectural-drivers.json: ${err.message}`,
      details: ["Run /senai-generate-architect to regenerate the drivers, or fix the JSON manually."],
    });
  }

  // Warn about stale intermediate driver files in the old root location.
  const oldRootDrivers = path.join(cwd, ".pi", "senai");
  if (fs.existsSync(oldRootDrivers)) {
    const stale = fs.readdirSync(oldRootDrivers).filter((f) => f.startsWith("drivers-") && f.endsWith(".json"));
    if (stale.length > 0) {
      items.push({
        status: "warning",
        message: `${stale.length} stale intermediate driver files found in .pi/senai/.`,
        details: stale.map((f) => `.pi/senai/${f} — move or delete this file`),
      });
    }
  }

  let profile: ArchitectProfile | null = null;
  try {
    profile = loadArchitectProfile(cwd);
    if (!profile) {
      items.push({
        status: "info",
        message: "No architect profile generated yet.",
      });
    } else {
      items.push({
        status: "ok",
        message: `Architect profile exists: ${profile.projectName} → ${profile.selectedArchitecture}.`,
      });
    }
  } catch (err: any) {
    items.push({
      status: "error",
      message: `Invalid architect profile at .pi/architect/architect-profile.json: ${err.message}`,
      details: ["Run /senai-generate-architect to regenerate the profile, or fix the JSON manually."],
    });
  }

  let report: ArchitectReport | null = null;
  try {
    report = loadArchitectReport(cwd);
    if (!report) {
      items.push({
        status: "info",
        message: "No architect report generated yet.",
      });
    } else {
      items.push({
        status: report.confidence === "high" ? "ok" : "warning",
        message: `Architect report exists with ${report.confidence} confidence for ${report.selectedArchitecture}.`,
      });
    }
  } catch (err: any) {
    items.push({
      status: "error",
      message: `Invalid architect report at .pi/architect/architect-report.json: ${err.message}`,
      details: ["Run /senai-generate-architect to regenerate the report, or fix the JSON manually."],
    });
  }

  if (profile) {
    const agentsDir = path.join(cwd, ".pi", "agents");
    const expectedAgentNames = ARCHITECT_ROLES.map((role) => `${profile.projectSlug}-${profile.selectedArchitecture}-${role}`);
    const expectedAgentPaths = expectedAgentNames.map((name) => path.join(agentsDir, `${name}.md`));
    const missingAgents: string[] = [];
    for (const filePath of expectedAgentPaths) {
      if (!fs.existsSync(filePath)) {
        missingAgents.push(path.relative(cwd, filePath));
      }
    }

    const misnamedAgents: string[] = [];
    if (fs.existsSync(agentsDir)) {
      const prefix = `${profile.projectSlug}-${profile.selectedArchitecture}-`;
      for (const entry of fs.readdirSync(agentsDir)) {
        if (!entry.endsWith(".md")) continue;
        if (!entry.startsWith(prefix)) continue;
        const name = entry.slice(0, -3);
        if (!expectedAgentNames.includes(name)) {
          misnamedAgents.push(path.relative(cwd, path.join(agentsDir, entry)));
        }
      }
    }

    if (missingAgents.length === 0 && misnamedAgents.length === 0) {
      items.push({ status: "ok", message: `Found all ${expectedAgentNames.length} expected architecture agents in .pi/agents/.` });
    } else {
      if (missingAgents.length > 0) {
        items.push({
          status: "error",
          message: `${missingAgents.length} expected architecture agents are missing.`,
          details: missingAgents,
        });
      }
      if (misnamedAgents.length > 0) {
        items.push({
          status: "error",
          message: `${misnamedAgents.length} misnamed architecture agents found.`,
          details: misnamedAgents,
        });
      }
    }

    const skillsDir = path.join(cwd, ".pi", "skills");
    const expectedSkillNames = ARCHITECT_STAGES.map((stage) => `${profile.projectSlug}-${profile.selectedArchitecture}-${stage}`);
    const expectedSkillPaths = expectedSkillNames.map((name) => path.join(skillsDir, name, "SKILL.md"));
    const missingSkills: string[] = [];
    for (const filePath of expectedSkillPaths) {
      if (!fs.existsSync(filePath)) {
        missingSkills.push(path.relative(cwd, filePath));
      }
    }

    const misnamedSkills: string[] = [];
    if (fs.existsSync(skillsDir)) {
      const prefix = `${profile.projectSlug}-${profile.selectedArchitecture}-`;
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith(prefix)) continue;
        if (!expectedSkillNames.includes(entry.name)) {
          misnamedSkills.push(path.relative(cwd, path.join(skillsDir, entry.name)));
        }
      }
    }

    if (missingSkills.length === 0 && misnamedSkills.length === 0) {
      items.push({ status: "ok", message: `Found all ${expectedSkillNames.length} expected architecture skills in .pi/skills/.` });
    } else {
      if (missingSkills.length > 0) {
        items.push({
          status: "error",
          message: `${missingSkills.length} expected architecture skills are missing.`,
          details: missingSkills,
        });
      }
      if (misnamedSkills.length > 0) {
        items.push({
          status: "error",
          message: `${misnamedSkills.length} misnamed architecture skills found.`,
          details: misnamedSkills,
        });
      }
    }

    const architecturePath = path.join(architectStateDir, "architecture.md");
    if (fs.existsSync(architecturePath)) {
      items.push({ status: "ok", message: "architecture.md found in .pi/architect/." });
    } else {
      items.push({
        status: "error",
        message: "No architecture.md found in .pi/architect/.",
      });
    }

    if (report && report.adrs.length > 0) {
      const adrsDir = path.join(architectStateDir, "adrs");
      let foundAdrs = 0;
      let checkedAdrs = 0;
      for (const adr of report.adrs) {
        if (!adr || typeof adr.id !== "string" || typeof adr.title !== "string" || !adr.title.trim()) {
          continue;
        }
        checkedAdrs++;
        const adrPath = path.join(adrsDir, `${adr.id}-${slugify(adr.title)}.md`);
        if (fs.existsSync(adrPath)) {
          foundAdrs++;
        }
      }
      if (checkedAdrs === 0) {
        items.push({
          status: "warning",
          message: "Architect report contains ADRs, but none have a valid id and title.",
        });
      } else if (foundAdrs === checkedAdrs) {
        items.push({
          status: "ok",
          message: `Found all ${checkedAdrs} ADRs in .pi/architect/adrs/.`,
        });
      } else {
        items.push({
          status: "error",
          message: `Found ${foundAdrs} of ${checkedAdrs} expected ADRs in .pi/architect/adrs/.`,
        });
      }
    }
  }

  return { title: "Architecture setup", items };
}

/** Architecture agent mapping: verifies the seven Senai roles that must
 *  resolve to the generated architecture agents actually do, once a
 *  project-specific architecture exists. Errors on every mismatch with the
 *  expected suffix from ARCHITECTURE_AGENT_MAPPING. */
export function checkArchitectureAgentMapping(cwd: string, agentConfig: AgentConfig | null): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  let profile: ArchitectProfile | null = null;
  try {
    profile = loadArchitectProfile(cwd);
  } catch {
    // An invalid profile is already reported by the architecture setup section.
  }
  if (!profile) {
    items.push({
      status: "info",
      message: "No architecture generated yet. Mapping check skipped.",
      details: ["Run /senai-generate-architect to generate project-specific architecture agents."],
    });
    return { title: "Architecture agent mapping", items };
  }

  for (const { role, label, expectedSuffix } of ARCHITECTURE_MAPPED_ROLES) {
    const expected = `${profile.projectSlug}-${profile.selectedArchitecture}-${expectedSuffix}`;
    const actual = resolveAgentName(agentConfig, role);

    if (actual === expected) {
      items.push({ status: "ok", message: `${label} (${role}) → ${actual}: correctly mapped` });
    } else {
      items.push({
        status: "error",
        message: `${label} (${role}) is mapped to "${actual}" but the architecture factory generated "${expected}".`,
        details: [`Fix: re-run /senai-generate-architect to auto-map default or stale roles, or run /senai-configure-agents to map ${role} to ${expected} manually.`],
      });
    }
  }

  return { title: "Architecture agent mapping", items };
}

/** Generated agent content: walks the five generated architecture agents
 *  and verifies frontmatter (tools, skills), body (architecture.md reference,
 *  ADR reference, Forbidden patterns section), and presence of the v2.0+
 *  discipline sections where applicable. */
export function checkGeneratedAgentContent(cwd: string): DiagnosticSection {
  const items: DiagnosticItem[] = [];

  let profile: ArchitectProfile | null = null;
  try {
    profile = loadArchitectProfile(cwd);
  } catch {
    // An invalid profile is already reported by the architecture setup section.
  }
  if (!profile) {
    items.push({ status: "info", message: "No architecture generated yet. Content check skipped." });
    return { title: "Generated agent content", items };
  }

  const agentsDir = path.join(cwd, ".pi", "agents");
  const skillsDir = path.join(cwd, ".pi", "skills");

  for (const role of ARCHITECT_ROLES) {
    const agentName = `${profile.projectSlug}-${profile.selectedArchitecture}-${role}`;
    const filePath = path.join(agentsDir, `${agentName}.md`);
    if (!fs.existsSync(filePath)) continue; // Missing files are reported by the architecture setup section.

    const content = fs.readFileSync(filePath, "utf8");
    const problems: string[] = [];

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    if (!/^tools:/m.test(frontmatter)) {
      problems.push("frontmatter is missing a tools: line");
    }

    const skillsMatch = frontmatter.match(/^skills:(.*)$/m);
    if (!skillsMatch || !skillsMatch[1].trim()) {
      problems.push("frontmatter is missing a skills: line");
    } else {
      const skillNames = skillsMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const skillName of skillNames) {
        if (!fs.existsSync(path.join(skillsDir, skillName, "SKILL.md"))) {
          problems.push(`referenced skill "${skillName}" not found at .pi/skills/${skillName}/SKILL.md`);
        }
      }
    }

    if (!content.includes(".pi/architect/architecture.md")) {
      problems.push("body does not reference .pi/architect/architecture.md");
    }
    if (!content.includes("adrs/")) {
      problems.push("body does not reference ADRs in .pi/architect/adrs/");
    }
    if (!/^##\s+Forbidden patterns/im.test(content)) {
      problems.push("body is missing a '## Forbidden patterns' section");
    }

    // Plan v2.0 Change 12: warn when the discipline sections introduced for
    // testing-discipline are missing. These are warnings (not errors) so they
    // surface without blocking runs that already work; the user can regenerate
    // to pick them up. Only the roles that own testing discipline get checked.
    // Suppressed when the agent already has structural problems — the user will
    // see the error item and fix everything together; we do not double-report.
    if (problems.length === 0) {
      if (role === "implementer" && !content.includes("## Testing discipline")) {
        items.push({
          status: "warning",
          message: `${agentName}: body is missing the '## Testing discipline' section (pi-senai v2.0+).`,
          details: [
            "Re-run /senai-generate-architect to refresh, or paste the section in by hand.",
            "This warning is informational; the agent will still run, but without the discipline text.",
          ],
        });
      } else if (role === "reviewer-tests" && !content.includes("## Review checklist")) {
        items.push({
          status: "warning",
          message: `${agentName}: body is missing the '## Review checklist' section (pi-senai v2.0+).`,
          details: [
            "Re-run /senai-generate-architect to refresh, or paste the section in by hand.",
          ],
        });
      } else if (role === "reviewer-correctness" && !content.includes("## Anti-pattern scan")) {
        items.push({
          status: "warning",
          message: `${agentName}: body is missing the '## Anti-pattern scan' section (pi-senai v2.0+).`,
          details: [
            "code-review re-uses this agent (ARCHITECTURE_AGENT_MAPPING), so both lose the scan.",
            "Re-run /senai-generate-architect to refresh, or paste the section in by hand.",
          ],
        });
      }
    }

    if (problems.length === 0) {
      items.push({ status: "ok", message: `${agentName}: content complete` });
    } else {
      items.push({
        status: "error",
        message: `${agentName}: content is incomplete`,
        details: [...problems, "Fix: re-run /senai-generate-architect to regenerate the agent files."],
      });
    }
  }

  return { title: "Generated agent content", items };
}