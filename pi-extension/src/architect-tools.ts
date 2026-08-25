import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  autoMapArchitectureAgents,
  discoverArchitectureLibrary,
  generateAgentFiles,
  generateArchitectureDocs,
  generateSkillFiles,
  loadArchitectProfile,
  loadArchitectReport,
  loadGeneratedManifest,
  removeStaleArchitectureArtifacts,
  slugify,
  writeGeneratedManifest,
  GENERATED_MANIFEST_FILE,
  type ArchitectureLibraryEntry,
} from "./architect.js";
import { getArchitectMapDir, getArchitectStateDir } from "./constants.js";
import { loadAgentConfig } from "./agent-config.js";
import {
  DOCUMENT_MANIFEST_FILE,
  mergeMapOutputs,
  readMapOutputs,
  sanitizeDocumentPath,
} from "./document-ingest.js";
import { loadArchitectInputsConfig } from "./architect-inputs-config.js";
import {
  mergeDrivers,
  normalizeDrivers,
  saveDrivers,
} from "./driver-extractor.js";

export function registerArchitectTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "senai_merge_architect_drivers",
    label: "Merge architect driver map outputs",
    description:
      "Merge per-document architectural driver map outputs into the merged architectural-drivers.json file. Removes stale intermediate files from the .pi/senai/ root location.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const mapDir = getArchitectMapDir(cwd);
      fs.mkdirSync(mapDir, { recursive: true });

      // Only well-formed map outputs are mergeable (the document manifest is not).
      let mapOutputs = readMapOutputs(cwd).filter(
        (output) =>
          output &&
          typeof output.document === "string" &&
          Array.isArray(output.functionalRequirements),
      );

      // When inputs are configured, only merge map outputs for the current
      // document set and delete stale map files left by removed/renamed docs.
      const deletedStaleMapFiles: string[] = [];
      const inputsConfig = loadArchitectInputsConfig(cwd);
      if (inputsConfig) {
        const expectedFiles = new Set(
          inputsConfig.documents.map((doc) => `${sanitizeDocumentPath(doc.path)}.json`),
        );
        for (const entry of fs.readdirSync(mapDir)) {
          if (!entry.endsWith(".json") || entry === DOCUMENT_MANIFEST_FILE) continue;
          if (expectedFiles.has(entry)) continue;
          try {
            fs.unlinkSync(path.join(mapDir, entry));
            deletedStaleMapFiles.push(path.relative(cwd, path.join(mapDir, entry)));
          } catch {
            // Ignore deletion failures.
          }
        }
        const expectedDocPaths = new Set(inputsConfig.documents.map((doc) => doc.path));
        mapOutputs = mapOutputs.filter((output) => expectedDocPaths.has(output.document));
      }

      let merged = mergeMapOutputs(mapOutputs);

      // Also pull in any legacy intermediate files from the .pi/senai/ root.
      const legacyDir = path.join(cwd, ".pi", "senai");
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
        deletedStaleMapFiles,
      };

      return {
        content: [{ type: "text", text: `Merged architectural drivers: ${JSON.stringify(summary, null, 2)}` }],
        details: summary,
      };
    },
  });

  pi.registerTool({
    name: "senai_finalize_architecture",
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

      // Validate agents.json before writing anything: a corrupted config would
      // otherwise crash the auto-mapping step after artifacts were written.
      loadAgentConfig(cwd);

      // Remove agents/skills left over from previous architecture runs before
      // generating the current set, so orphans never survive a re-run. Only
      // manifest-proven untouched files are removed; anything else is kept.
      const staleResult = removeStaleArchitectureArtifacts(cwd, profile);

      const createdDocs = generateArchitectureDocs(cwd, profile, report);
      const createdAgents = generateAgentFiles(cwd, profile, architecture);
      const createdSkills = generateSkillFiles(cwd, profile, architecture);

      // writeGeneratedManifest rewrites the manifest with only this run's
      // artifacts, so merge previous entries from other generators (e.g.
      // sub-agent team files) back in. Old hashes are kept — they are the
      // drift baseline. Entries whose file no longer exists are dropped.
      const previousManifest = loadGeneratedManifest(cwd);
      const manifest = writeGeneratedManifest(cwd, [...createdDocs, ...createdAgents, ...createdSkills]);
      if (previousManifest) {
        let preserved = 0;
        for (const [rel, hash] of Object.entries(previousManifest.files)) {
          if (rel in manifest.files) continue;
          if (!fs.existsSync(path.resolve(cwd, rel))) continue;
          manifest.files[rel] = hash;
          preserved++;
        }
        if (preserved > 0) {
          const manifestPath = path.join(getArchitectStateDir(cwd), GENERATED_MANIFEST_FILE);
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
        }
      }

      const archId = architecture.id || slugify(architecture.name);
      const mappedRoles = autoMapArchitectureAgents(cwd, profile, archId);

      const summary = {
        docs: createdDocs.map((p) => path.relative(cwd, p)),
        agents: createdAgents.map((p) => path.relative(cwd, p)),
        skills: createdSkills.map((p) => path.relative(cwd, p)),
        removedStaleArtifacts: staleResult.removed,
        keptStaleArtifacts: staleResult.kept,
        manifestFiles: Object.keys(manifest.files).length,
        mappedRoles,
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
