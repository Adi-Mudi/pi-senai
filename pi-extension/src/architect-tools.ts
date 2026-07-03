import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  discoverArchitectureLibrary,
  generateAgentFiles,
  generateArchitectureDocs,
  generateSkillFiles,
  loadArchitectProfile,
  loadArchitectReport,
  type ArchitectureLibraryEntry,
} from "./architect.js";
import { getArchitectMapDir, getArchitectStateDir } from "./constants.js";
import {
  mergeMapOutputs,
  readMapOutputs,
} from "./document-ingest.js";
import {
  getDriversPath,
  loadDrivers,
  mergeDrivers,
  normalizeDrivers,
  saveDrivers,
  type ArchitecturalDrivers,
} from "./driver-extractor.js";

export function registerArchitectTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "orchestra_merge_architect_drivers",
    label: "Merge architect driver map outputs",
    description:
      "Merge per-document architectural driver map outputs into the merged architectural-drivers.json file. Removes stale intermediate files from the old .pi/orchestra/ root location.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const mapDir = getArchitectMapDir(cwd);
      fs.mkdirSync(mapDir, { recursive: true });

      let merged = mergeMapOutputs(readMapOutputs(cwd));

      // Also pull in any legacy intermediate files from the old .pi/orchestra/ root.
      const legacyDir = path.join(cwd, ".pi", "orchestra");
      const deletedLegacy: string[] = [];
      if (fs.existsSync(legacyDir)) {
        const legacyFiles = fs
          .readdirSync(legacyDir)
          .filter((f) => f.startsWith("drivers-") && f.endsWith(".json"))
          .map((f) => path.join(legacyDir, f));

        for (const filePath of legacyFiles) {
          try {
            const raw = fs.readFileSync(filePath, "utf8");
            const parsed = JSON.parse(raw) as unknown;
            const drivers = normalizeDrivers(parsed);
            if (drivers) {
              merged = mergeDrivers(merged, drivers);
            }
          } catch {
            // Ignore malformed legacy files.
          }
          try {
            fs.unlinkSync(filePath);
            deletedLegacy.push(path.relative(cwd, filePath));
          } catch {
            // Ignore deletion failures.
          }
        }

        // Remove the old merged drivers file if it exists.
        const oldMerged = path.join(legacyDir, "architectural-drivers.json");
        if (fs.existsSync(oldMerged)) {
          try {
            fs.unlinkSync(oldMerged);
            deletedLegacy.push(path.relative(cwd, oldMerged));
          } catch {
            // Ignore deletion failures.
          }
        }
      }

      saveDrivers(cwd, merged);

      const summary = {
        functionalRequirements: merged.functionalRequirements.length,
        qualityAttributes: merged.qualityAttributes.length,
        constraints: merged.constraints.length,
        technicalConcerns: merged.technicalConcerns.length,
        uncertainties: merged.uncertainties.length,
        deletedLegacy,
      };

      return {
        content: [{ type: "text", text: `Merged architectural drivers: ${JSON.stringify(summary, null, 2)}` }],
        details: summary,
      };
    },
  });

  pi.registerTool({
    name: "orchestra_finalize_architecture",
    label: "Finalize architecture artifacts",
    description:
      "Generate architecture.md, ADRs, project-specific agents, and project-specific skills from the architect profile and report. Uses the architecture library entry matching the selected architecture id.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const profile = loadArchitectProfile(cwd);
      if (!profile) {
        return {
          content: [{ type: "text", text: "No architect profile found. Run the architect flow first." }],
          details: { error: "missing profile" },
        };
      }

      const report = loadArchitectReport(cwd);
      if (!report) {
        return {
          content: [{ type: "text", text: "No architect report found. Run the architect flow first." }],
          details: { error: "missing report" },
        };
      }

      const library = discoverArchitectureLibrary(cwd);
      let architecture: ArchitectureLibraryEntry | undefined = library.find(
        (entry) => entry.id === profile.selectedArchitecture,
      );
      if (!architecture) {
        architecture = library.find(
          (entry) => entry.id === report.selectedArchitecture || entry.name === profile.selectedArchitecture,
        );
      }
      if (!architecture) {
        return {
          content: [
            {
              type: "text",
              text: `Selected architecture "${profile.selectedArchitecture}" not found in the architecture library.`,
            },
          ],
          details: { error: "architecture not found" },
        };
      }

      const createdDocs = generateArchitectureDocs(cwd, profile, report);
      const createdAgents = generateAgentFiles(cwd, profile, architecture);
      const createdSkills = generateSkillFiles(cwd, profile, architecture);

      const summary = {
        docs: createdDocs.map((p) => path.relative(cwd, p)),
        agents: createdAgents.map((p) => path.relative(cwd, p)),
        skills: createdSkills.map((p) => path.relative(cwd, p)),
      };

      return {
        content: [
          {
            type: "text",
            text: `Finalized architecture artifacts:\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
        details: summary,
      };
    },
  });
}
