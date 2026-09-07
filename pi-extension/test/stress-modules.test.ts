import { describe, it } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { discoverProjectFiles, isExcluded } from "../src/agents/files-discovery.js";
import { discoverAgents, parseAgentFile } from "../src/agents/discovery.js";
import { defaultState, loadState, saveState } from "../src/core/state.js";
import { loadAgentConfig, saveAgentConfig } from "../src/core/agents-config/config.js";
import {
  loadFilesConfig,
  saveFilesConfig,
  type FilesConfig,
} from "../src/core/agents-config/files-config.js";
import {
  loadAgentsFilesConfig,
  saveAgentsFilesConfig,
  type AgentsFilesConfig,
} from "../src/core/agents-config/agents-files-config.js";
import {
  loadArchitectInputsConfig,
  saveArchitectInputsConfig,
  type ArchitectInputsConfig,
} from "../src/architect/inputs-config.js";
import {
  buildIngestBatches,
  mergeMapOutputs,
  type ArchitectMapOutput,
} from "../src/docs-factory/ingest.js";
import {
  findDriverGaps,
  mergeDrivers,
  normalizeDrivers,
  type ArchitecturalDrivers,
} from "../src/architect/drivers.js";
import {
  GENERATED_ROLES,
  discoverTechnologyResources,
  matchTechnologies,
  planAgentGeneration,
  writeGeneratedAgents,
} from "../src/agents/generator.js";
import {
  addToGeneratedManifest,
  loadGeneratedManifest,
  writeGeneratedManifest,
} from "../src/architect/index.js";
import {
  documentSignalWords,
  formatDiagnosticReport,
  significantWords,
  wordsOverlap,
  type DiagnosticItem,
  type DiagnosticReport,
  type DiagnosticSection,
  type DiagnosticStatus,
} from "../src/doctor/index.js";
import { buildSenaiCompactionSummary } from "../src/core/compaction-summary.js";
import { getStatePath } from "../src/core/paths.js";

/**
 * Stress tests for every volume-exposed module: tree scanning, agent
 * discovery, config round-trips, architect merge, generation, doctor text
 * helpers, and the compaction hook.
 *
 * Correctness is asserted strictly. Timing bounds are generous (~10x the
 * expected real time) so the suite never goes flaky; the actual timings are
 * printed so regressions are visible in the output.
 *
 * No source files are changed by these tests. Pinned contracts (verified in
 * source): loadAgentConfig returns null when missing and throws on corrupt
 * JSON; loadState returns defaultState when missing, throws on corrupt JSON,
 * migrates old versions, resets a garbage stage to "none";
 * buildSenaiCompactionSummary returns null on no-run/corrupt and never throws.
 */

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(cwd: string, relPath: string, content = ""): void {
  const fullPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const pad3 = (n: number) => String(n).padStart(3, "0");

describe("files-discovery stress", () => {
  it("5,000 files in 300 dirs + 2,000 excluded files: excluded never appear, counts exact", () => {
    const cwd = makeTmp("stress-files-tree-");
    // 300 custom-named dirs x 16 code files = 4,800 files (content-based code folders).
    for (let d = 0; d < 300; d++) {
      for (let f = 0; f < 16; f++) {
        writeFile(cwd, `mod${pad3(d)}/file${pad2(f)}.ts`);
      }
    }
    // 200 root-level code files -> 5,000 total.
    for (let f = 0; f < 200; f++) {
      writeFile(cwd, `root${pad3(f)}.ts`);
    }
    // Fake node_modules with 2,000 files inside the excluded path.
    for (let d = 0; d < 40; d++) {
      for (let f = 0; f < 50; f++) {
        writeFile(cwd, `node_modules/pkg${pad2(d)}/file${pad2(f)}.js`);
      }
    }

    const start = performance.now();
    const result = discoverProjectFiles(cwd, ["node_modules/"]);
    const elapsed = performance.now() - start;
    console.log(
      `discoverProjectFiles: 5,000 files in 300 dirs (+2,000 excluded) in ${elapsed.toFixed(0)} ms`,
    );

    assert.strictEqual(result.codeFolders.length, 300, "300 custom code folders detected");
    assert.ok(
      result.codeFolders.every((f) => f.reason === "16 code files found"),
      "each custom folder classified by content",
    );
    assert.strictEqual(result.codeFiles.length, 200, "200 root code files");
    assert.strictEqual(result.documentFolders.length, 0);
    assert.strictEqual(result.documentFiles.length, 0);
    assert.strictEqual(result.testFolders.length, 0);
    assert.strictEqual(result.testFiles.length, 0);
    const allListed = [
      ...result.codeFolders.map((f) => f.path),
      ...result.codeFiles,
      ...result.documentFolders.map((f) => f.path),
      ...result.documentFiles,
      ...result.testFolders.map((f) => f.path),
      ...result.testFiles,
    ];
    assert.ok(
      !allListed.some((p) => p.startsWith("node_modules")),
      "excluded files never appear in results",
    );
    assert.ok(elapsed < 30_000, `tree scan took ${elapsed.toFixed(0)} ms (budget 30000 ms)`);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("isExcluded x 100,000 calls against 50 excluded paths: all correct", () => {
    const excludedPaths: string[] = [];
    for (let i = 0; i < 25; i++) excludedPaths.push(`excl${pad2(i)}/`);
    for (let i = 0; i < 25; i++) excludedPaths.push(`plain${pad2(i)}`);

    // [relative, expected]
    const cases: Array<[string, boolean]> = [
      ["excl07/", true],
      ["excl07/a/b.ts", true],
      ["plain07", true],
      ["plain07/x.ts", true],
      ["excl07x/y.ts", false],
      ["plain07x", false],
      ["src/main.ts", false],
    ];

    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      const [relative, expected] = cases[i % cases.length];
      assert.strictEqual(
        isExcluded(relative, excludedPaths),
        expected,
        `call ${i}: isExcluded("${relative}") must be ${expected}`,
      );
    }
    const elapsed = performance.now() - start;
    console.log(
      `isExcluded: 100,000 calls x 50 paths in ${elapsed.toFixed(0)} ms ` +
        `(${(elapsed / 100_000).toFixed(4)} ms/call)`,
    );
    assert.ok(elapsed < 5_000, `100k isExcluded calls took ${elapsed.toFixed(0)} ms (budget 5000 ms)`);
  });
});

describe("agent-discovery stress", () => {
  it("discoverAgents with 500 valid + 50 broken + 20 non-md files: 500 project agents, broken skipped", () => {
    const cwd = makeTmp("stress-agents-");
    for (let i = 0; i < 500; i++) {
      writeFile(
        cwd,
        `.pi/agents/agent-${pad3(i)}.md`,
        `---\nname: agent-${pad3(i)}\ndescription: Stress agent ${i}\n---\n\nBody ${i}.\n`,
      );
    }
    for (let i = 0; i < 50; i++) {
      // Broken: missing description -> must be skipped.
      writeFile(cwd, `.pi/agents/broken-${pad2(i)}.md`, `---\nname: broken-${pad2(i)}\n---\n\nBody.\n`);
    }
    for (let i = 0; i < 20; i++) {
      writeFile(cwd, `.pi/agents/notes-${pad2(i)}.txt`, "not markdown");
    }

    const start = performance.now();
    const agents = discoverAgents(cwd);
    const elapsed = performance.now() - start;
    console.log(`discoverAgents: 500 valid + 50 broken files in ${elapsed.toFixed(0)} ms`);

    const projectAgents = agents.filter((a) => a.source === "project");
    assert.strictEqual(projectAgents.length, 500, "exactly 500 project agents discovered");
    const names = new Set(agents.map((a) => a.name));
    for (let i = 0; i < 500; i++) {
      assert.ok(names.has(`agent-${pad3(i)}`), `agent-${pad3(i)} discovered`);
    }
    for (let i = 0; i < 50; i++) {
      assert.ok(!names.has(`broken-${pad2(i)}`), `broken-${pad2(i)} skipped everywhere`);
    }
    assert.ok(elapsed < 30_000, `discoverAgents took ${elapsed.toFixed(0)} ms (budget 30000 ms)`);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("parseAgentFile x 1,000 files incl. malformed frontmatter and 500 KB bodies: never throws", () => {
    const cwd = makeTmp("stress-parse-agent-");
    const bigBody = "x".repeat(500_000);
    const validFiles: string[] = [];
    const brokenFiles: string[] = [];
    for (let i = 0; i < 800; i++) {
      const rel = `agents/valid-${pad3(i)}.md`;
      writeFile(cwd, rel, `---\nname: valid-${pad3(i)}\ndescription: Valid agent ${i}\n---\n\nBody.\n`);
      validFiles.push(rel);
    }
    for (let i = 0; i < 50; i++) {
      const rel = `agents/huge-${pad2(i)}.md`;
      writeFile(cwd, rel, `---\nname: huge-${pad2(i)}\ndescription: Huge agent ${i}\n---\n\n${bigBody}\n`);
      validFiles.push(rel);
    }
    for (let i = 0; i < 100; i++) {
      const rel = `agents/nodesc-${pad3(i)}.md`;
      writeFile(cwd, rel, `---\nname: nodesc-${pad3(i)}\n---\n\nBody.\n`);
      brokenFiles.push(rel);
    }
    for (let i = 0; i < 50; i++) {
      const rel = `agents/malformed-${pad2(i)}.md`;
      writeFile(cwd, rel, `---\n[bracket: {unclosed\n  - bad ${i}\n---\n\nBody.\n`);
      brokenFiles.push(rel);
    }

    const start = performance.now();
    for (const rel of validFiles) {
      const parsed = parseAgentFile(path.join(cwd, rel));
      assert.ok(parsed, `${rel} must parse`);
      assert.ok(parsed.name.length > 0 && parsed.description.length > 0);
    }
    for (const rel of brokenFiles) {
      assert.strictEqual(parseAgentFile(path.join(cwd, rel)), undefined, `${rel} must be skipped`);
    }
    const elapsed = performance.now() - start;
    console.log(`parseAgentFile: 1,000 files (50 x 500 KB bodies) in ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 15_000, `1,000 parses took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("config round-trip stress", () => {
  it("state.ts: 500 save/load cycles intact; corrupt throws; garbage stage resets; v0 migrates", () => {
    const cwd = makeTmp("stress-state-");
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      const state = {
        ...defaultState(),
        mission: `mission ${i}`,
        runId: `run-${i}`,
        currentStage: "planning" as const,
        stageResults: { plan: `artifact-${i}` },
      };
      saveState(cwd, state);
      assert.deepStrictEqual(loadState(cwd), state, `cycle ${i}: state must round-trip intact`);
    }
    const elapsed = performance.now() - start;
    console.log(`state.ts: 500 save/load cycles in ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 15_000, `500 state cycles took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);

    // Pinned: missing file -> defaultState.
    const empty = makeTmp("stress-state-empty-");
    assert.deepStrictEqual(loadState(empty), defaultState());
    fs.rmSync(empty, { recursive: true, force: true });

    // Pinned: corrupt JSON throws.
    fs.mkdirSync(path.dirname(getStatePath(cwd)), { recursive: true });
    fs.writeFileSync(getStatePath(cwd), "{not json", "utf8");
    assert.throws(() => loadState(cwd));

    // Pinned: garbage stage resets to "none".
    fs.writeFileSync(
      getStatePath(cwd),
      JSON.stringify({ ...defaultState(), currentStage: "bogus-stage" }),
      "utf8",
    );
    assert.strictEqual(loadState(cwd).currentStage, "none");

    // Pinned: version-0 state migrates, preserving fields.
    fs.writeFileSync(
      getStatePath(cwd),
      JSON.stringify({
        version: 0,
        mission: "old mission",
        runId: "old-run",
        currentStage: "implementing",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        stageResults: { plan: "done" },
      }),
      "utf8",
    );
    const migrated = loadState(cwd);
    assert.strictEqual(migrated.version, 1);
    assert.strictEqual(migrated.mission, "old mission");
    assert.strictEqual(migrated.runId, "old-run");
    assert.strictEqual(migrated.currentStage, "implementing");
    assert.deepStrictEqual(migrated.stageResults, { plan: "done" });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("agent-config.ts: 500 save/load cycles intact; missing -> null; corrupt throws", () => {
    const cwd = makeTmp("stress-agent-config-");
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      const config = { version: 1, agents: { planner: `agent-${i}`, implementer: "worker" } };
      saveAgentConfig(cwd, config);
      assert.deepStrictEqual(loadAgentConfig(cwd), config, `cycle ${i}: config must round-trip intact`);
    }
    const elapsed = performance.now() - start;
    console.log(`agent-config.ts: 500 save/load cycles in ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 15_000, `500 agent-config cycles took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);

    // Pinned: missing -> null, corrupt -> throws.
    const empty = makeTmp("stress-agent-config-empty-");
    assert.strictEqual(loadAgentConfig(empty), null);
    fs.rmSync(empty, { recursive: true, force: true });
    writeFile(cwd, ".pi/senai/agents.json", "{not json");
    assert.throws(() => loadAgentConfig(cwd));
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("files/agents-files/architect-inputs configs: 300 cycles each intact; missing -> null each", () => {
    const cwd = makeTmp("stress-configs-");
    const start = performance.now();
    for (let i = 0; i < 300; i++) {
      const filesConfig: FilesConfig = {
        version: 2,
        codePaths: [`src${i}/`],
        inputDocuments: [`docs/d${i}.md`],
        testPaths: ["tests/"],
        excludedPaths: ["node_modules/"],
      };
      saveFilesConfig(cwd, filesConfig);
      assert.deepStrictEqual(loadFilesConfig(cwd), filesConfig, `files cycle ${i}`);

      const agentsFilesConfig: AgentsFilesConfig = {
        version: 2,
        documents: { planner: { primary: `docs/d${i}.md`, reads: ["README.md"] } },
      };
      saveAgentsFilesConfig(cwd, agentsFilesConfig);
      assert.deepStrictEqual(loadAgentsFilesConfig(cwd), agentsFilesConfig, `agents_files cycle ${i}`);

      const inputsConfig: ArchitectInputsConfig = {
        version: 1,
        documents: [{ type: "prd", path: `docs/d${i}.md` }],
        additionalConstraints: [`constraint ${i}`],
      };
      saveArchitectInputsConfig(cwd, inputsConfig);
      assert.deepStrictEqual(loadArchitectInputsConfig(cwd), inputsConfig, `inputs cycle ${i}`);
    }
    const elapsed = performance.now() - start;
    console.log(`files/agents-files/architect-inputs: 300 cycles each in ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 20_000, `900 config cycles took ${elapsed.toFixed(0)} ms (budget 20000 ms)`);

    const empty = makeTmp("stress-configs-empty-");
    assert.strictEqual(loadFilesConfig(empty), null);
    assert.strictEqual(loadAgentsFilesConfig(empty), null);
    assert.strictEqual(loadArchitectInputsConfig(empty), null);
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("architect merge stress", () => {
  it("mergeMapOutputs: 50 outputs x 200 drivers each: totals exact, duplicates dropped", () => {
    const outputs: ArchitectMapOutput[] = [];
    for (let o = 0; o < 50; o++) {
      const output: ArchitectMapOutput = {
        document: `docs/doc${pad2(o)}.md`,
        documentType: "prd",
        functionalRequirements: [],
        qualityAttributes: [],
        constraints: [],
        technicalConcerns: [],
        uncertainties: [`uncertainty-${o}`, "shared-uncertainty"],
      };
      for (let i = 0; i < 50; i++) {
        output.functionalRequirements.push({ id: `FR-${o}-${i}`, description: `req ${o}.${i}` });
        output.qualityAttributes.push({
          id: `QA-${o}-${i}`,
          description: `quality ${o}.${i}`,
          category: "performance",
          target: "fast",
        });
        output.constraints.push({ id: `C-${o}-${i}`, description: `constraint ${o}.${i}`, category: "budget" });
        output.technicalConcerns.push({ id: `TC-${o}-${i}`, description: `concern ${o}.${i}` });
      }
      // One duplicate id per output: only the first occurrence may survive.
      output.functionalRequirements.push({ id: "DUP-FR", description: `dup from ${o}` });
      outputs.push(output);
    }

    const start = performance.now();
    const merged = mergeMapOutputs(outputs);
    const elapsed = performance.now() - start;
    console.log(`mergeMapOutputs: 50 outputs x 200 drivers in ${elapsed.toFixed(0)} ms`);

    assert.strictEqual(merged.functionalRequirements.length, 50 * 50 + 1);
    assert.strictEqual(merged.qualityAttributes.length, 50 * 50);
    assert.strictEqual(merged.constraints.length, 50 * 50);
    assert.strictEqual(merged.technicalConcerns.length, 50 * 50);
    assert.strictEqual(merged.uncertainties.length, 51, "50 unique + 1 shared uncertainty");
    const dup = merged.functionalRequirements.find((fr) => fr.id === "DUP-FR");
    assert.strictEqual(dup?.description, "dup from 0", "first duplicate occurrence wins");
    assert.ok(elapsed < 15_000, `merge took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);
  });

  it("normalizeDrivers with 10,000 items, 20% malformed: malformed dropped, never throws", () => {
    const items: unknown[] = [];
    for (let i = 0; i < 10_000; i++) {
      if (i % 5 === 0) {
        // Malformed variants: no description, no id, empty strings, non-object.
        const variants: unknown[] = [
          { id: `bad-${i}` },
          { description: `no id ${i}` },
          { id: "", description: "" },
          "just a string",
          null,
        ];
        items.push(variants[(i / 5) % variants.length]);
      } else {
        items.push({ id: `FR-${i}`, description: `requirement ${i}` });
      }
    }

    const start = performance.now();
    const normalized = normalizeDrivers({
      functionalRequirements: items,
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    });
    const elapsed = performance.now() - start;
    console.log(`normalizeDrivers: 10,000 items (20% malformed) in ${elapsed.toFixed(0)} ms`);

    assert.ok(normalized, "standard schema must normalize");
    assert.strictEqual(normalized.functionalRequirements.length, 8_000, "valid kept, malformed dropped");
    assert.ok(elapsed < 15_000, `normalize took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);
  });

  it("findDriverGaps on 10,000-driver set: deterministic across 5 runs; mergeDrivers dedups", () => {
    const drivers: ArchitecturalDrivers = {
      functionalRequirements: [],
      qualityAttributes: [{ id: "QA-1", description: "scale target", category: "scalability" }],
      constraints: [{ id: "C-1", description: "budget limit", category: "budget" }],
      technicalConcerns: [],
      uncertainties: [],
    };
    for (let i = 0; i < 10_000; i++) {
      drivers.functionalRequirements.push({ id: `FR-${i}`, description: `handle user request ${i}` });
    }

    const start = performance.now();
    let first: string | undefined;
    for (let run = 0; run < 5; run++) {
      const gaps = findDriverGaps(drivers);
      const snapshot = JSON.stringify(gaps);
      if (first === undefined) {
        first = snapshot;
        assert.deepStrictEqual(
          gaps.map((g) => g.category),
          ["deployment", "project-type"],
          "exactly the deployment and project-type gaps fire",
        );
      } else {
        assert.strictEqual(snapshot, first, `run ${run}: gaps must be deterministic`);
      }
    }
    // mergeDrivers: self-merge dedups by id; overlapping ids collapse.
    const selfMerged = mergeDrivers(drivers, drivers);
    assert.strictEqual(selfMerged.functionalRequirements.length, 10_000);
    const other: ArchitecturalDrivers = {
      functionalRequirements: [
        { id: "FR-0", description: "duplicate of FR-0" },
        { id: "FR-NEW", description: "new requirement" },
      ],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: ["u1"],
    };
    const merged = mergeDrivers(drivers, other);
    assert.strictEqual(merged.functionalRequirements.length, 10_001, "overlap dropped, new kept");
    assert.deepStrictEqual(merged.uncertainties, ["u1"]);
    const elapsed = performance.now() - start;
    console.log(`findDriverGaps x5 + mergeDrivers on 10,000 drivers in ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 15_000, `gap analysis took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);
  });

  it("buildIngestBatches fuzz: counts 0/1/10,000 x sizes 1/3/1,000: every item exactly once", () => {
    const start = performance.now();
    for (const count of [0, 1, 10_000]) {
      for (const batchSize of [1, 3, 1_000]) {
        const items = Array.from({ length: count }, (_, i) => i);
        const batches = buildIngestBatches(items, batchSize);
        assert.deepStrictEqual(batches.flat(), items, `count ${count} size ${batchSize}: all items, order kept`);
        batches.forEach((batch, bi) => {
          const expected =
            bi < batches.length - 1 ? batchSize : count - batchSize * (batches.length - 1);
          assert.strictEqual(batch.length, expected, `batch ${bi} size respected`);
        });
      }
    }
    assert.throws(() => buildIngestBatches([1], 0), "batchSize 0 must throw");
    const elapsed = performance.now() - start;
    console.log(`buildIngestBatches fuzz: 9 combinations in ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 10_000, `batching fuzz took ${elapsed.toFixed(0)} ms (budget 10000 ms)`);
  });
});

describe("generation stress", () => {
  it("discoverTechnologyResources + matchTechnologies: 100 project resources, 500 hints, exact matches", () => {
    const cwd = makeTmp("stress-tech-");
    // 100 project resources with fixed-length unique keyword tokens (no
    // substring collisions between keywords).
    for (let i = 0; i < 100; i++) {
      writeFile(
        cwd,
        `.pi/technologies/zzres${pad2(i)}.md`,
        `---\nid: zzres${pad2(i)}\nname: ZZ Resource ${i}\nkeywords: ["zztecha${pad2(i)}", "zztechb${pad2(i)}"]\n---\n\nCraft body ${i}.\n`,
      );
    }
    // 500 stack hints hitting only resources 00..49 via their zztechaXX keyword.
    const hints: string[] = [];
    for (let i = 0; i < 500; i++) {
      hints.push(`hint zztecha${pad2(i % 50)} item${i}`);
    }

    const start = performance.now();
    const resources = discoverTechnologyResources(cwd);
    const matched = matchTechnologies(hints, resources);
    const elapsed = performance.now() - start;
    console.log(`discoverTechnologyResources + matchTechnologies: 100 resources, 500 hints in ${elapsed.toFixed(0)} ms`);

    assert.strictEqual(matched.length, 50, "exactly the 50 hinted resources match");
    const matchedIds = new Set(matched.map((r) => r.id));
    for (let i = 0; i < 50; i++) {
      assert.ok(matchedIds.has(`zzres${pad2(i)}`), `zzres${pad2(i)} matched`);
    }
    for (let i = 50; i < 100; i++) {
      assert.ok(!matchedIds.has(`zzres${pad2(i)}`), `zzres${pad2(i)} has no keyword hit`);
    }
    assert.ok(!matchedIds.has("generic"), "generic fallback not used when matches exist");
    assert.ok(elapsed < 15_000, `tech matching took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("manifest: writeGeneratedManifest + 1,000 addToGeneratedManifest calls merge, never wipe", () => {
    const cwd = makeTmp("stress-manifest-");
    const seed0 = path.join(cwd, "gen", "seed0.txt");
    const seed1 = path.join(cwd, "gen", "seed1.txt");
    fs.mkdirSync(path.dirname(seed0), { recursive: true });
    fs.writeFileSync(seed0, "seed 0", "utf8");
    fs.writeFileSync(seed1, "seed 1", "utf8");
    const seed0Hash = sha256(seed0);
    const seed1Hash = sha256(seed1);

    const start = performance.now();
    const initial = writeGeneratedManifest(cwd, [seed0, seed1]);
    assert.strictEqual(Object.keys(initial.files).length, 2);
    for (let i = 0; i < 1_000; i++) {
      const filePath = path.join(cwd, "gen", `f${i}.txt`);
      fs.writeFileSync(filePath, `content ${i}`, "utf8");
      addToGeneratedManifest(cwd, [filePath]);
    }
    const elapsed = performance.now() - start;
    console.log(`manifest: write + 1,000 sequential adds in ${elapsed.toFixed(0)} ms`);

    const manifest = loadGeneratedManifest(cwd);
    assert.ok(manifest, "manifest must load");
    assert.strictEqual(Object.keys(manifest.files).length, 1_002, "entries merge, never wiped");
    assert.strictEqual(manifest.files["gen/seed0.txt"], seed0Hash, "original seed0 entry intact");
    assert.strictEqual(manifest.files["gen/seed1.txt"], seed1Hash, "original seed1 entry intact");
    assert.strictEqual(manifest.files["gen/f999.txt"], sha256(path.join(cwd, "gen", "f999.txt")));
    assert.ok(elapsed < 15_000, `1,000 manifest adds took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("writeGeneratedAgents: full role set twice into the same dir, second run byte-identical", () => {
    const cwd = makeTmp("stress-write-agents-");
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "stress-proj" }), "utf8");
    const plans = planAgentGeneration(cwd, GENERATED_ROLES, [], null);
    assert.strictEqual(plans.length, 15, "full non-architecture role set (Phase 7 added community-researcher)");

    const start = performance.now();
    const first = writeGeneratedAgents(cwd, plans);
    assert.strictEqual(first.created.length, 15);
    assert.strictEqual(first.skipped.length, 0);
    const snapshot = new Map<string, string>();
    for (const rel of first.created) {
      snapshot.set(rel, fs.readFileSync(path.join(cwd, rel), "utf8"));
    }

    const second = writeGeneratedAgents(cwd, plans, { regenerate: true });
    assert.strictEqual(second.regenerated.length, 15, "manifest-proven files regenerate in place");
    assert.strictEqual(second.created.length, 0);
    assert.strictEqual(second.keptDrifted.length, 0);
    assert.strictEqual(second.skipped.length, 0);
    for (const rel of second.regenerated) {
      assert.strictEqual(
        fs.readFileSync(path.join(cwd, rel), "utf8"),
        snapshot.get(rel),
        `${rel}: second run byte-identical`,
      );
    }
    const elapsed = performance.now() - start;
    console.log(`writeGeneratedAgents: 14 agents written twice (regenerate) in ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 15_000, `double generation took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("doctor text-helper stress", () => {
  it("significantWords + documentSignalWords on a 1 MB document; wordsOverlap x 100,000", () => {
    const cwd = makeTmp("stress-doctor-text-");
    const filler = "gamma delta epsilon zeta eta theta lambda sigma ".repeat(25_000); // ~1.1 MB
    const content = `# Alpha Beta Overview\n\n${filler}`;
    writeFile(cwd, "docs/big.md", content);

    const start = performance.now();
    const words = significantWords(content);
    assert.ok(content.length >= 1_000_000, "document is at least 1 MB");
    assert.ok(words.has("gamma") && words.has("lambda"), "significant words extracted");
    assert.ok(!words.has("the"), "short words dropped");
    const signals = documentSignalWords(cwd, "docs/big.md", path.join(cwd, "docs/big.md"));
    assert.ok(signals.has("alpha") && signals.has("beta") && signals.has("overview"), "heading words signalled");

    // wordsOverlap: disjoint sets (distinct first letters -> no prefix match)
    // and a known prefix pair (code/codebase).
    const setA = new Set(["alpha", "amber", "arrow", "anchor", "apricot", "avenue", "atlas", "agent"]);
    const setB = new Set(["zebra", "zephyr", "zigzag", "zenith", "zodiac", "zombie", "zinnia", "zester"]);
    const prefixA = new Set(["code"]);
    const prefixB = new Set(["codebase"]);
    for (let i = 0; i < 100_000; i++) {
      if (i % 2 === 0) {
        assert.strictEqual(wordsOverlap(setA, setB), false, `call ${i}: disjoint sets must not overlap`);
      } else {
        assert.strictEqual(wordsOverlap(prefixA, prefixB), true, `call ${i}: prefix pair must overlap`);
      }
    }
    const elapsed = performance.now() - start;
    console.log(`doctor text helpers: 1 MB doc + 100,000 wordsOverlap calls in ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 15_000, `text helpers took ${elapsed.toFixed(0)} ms (budget 15000 ms)`);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("formatDiagnosticReport with 200 sections x 100 items: line count exact", () => {
    const statuses: DiagnosticStatus[] = ["ok", "warning", "error", "info"];
    const summary = { ok: 0, warning: 0, error: 0, info: 0 };
    const sections: DiagnosticSection[] = [];
    for (let s = 0; s < 200; s++) {
      const items: DiagnosticItem[] = [];
      for (let i = 0; i < 100; i++) {
        const status = statuses[(s + i) % statuses.length];
        summary[status]++;
        const item: DiagnosticItem = { status, message: `section ${s} item ${i}` };
        if (i % 10 === 0) item.details = ["detail one", "detail two"];
        items.push(item);
      }
      sections.push({ title: `Section ${s}`, items });
    }
    const report: DiagnosticReport = { ok: summary.error === 0, summary, sections };

    const start = performance.now();
    const output = formatDiagnosticReport(report);
    const elapsed = performance.now() - start;
    console.log(`formatDiagnosticReport: 200 sections x 100 items in ${elapsed.toFixed(0)} ms`);

    // Header: title, blank, summary, blank, verdict, blank = 6 lines.
    // Section: title, blank, items (1 line each, +2 for every 10th item's details), blank.
    const linesPerSection = 2 + 100 + 10 * 2 + 1;
    const expectedLines = 6 + 200 * linesPerSection;
    assert.strictEqual(output.split("\n").length, expectedLines, "output line count exact");
    assert.ok(
      output.includes(
        `Summary: ${summary.ok} OK, ${summary.warning} warnings, ${summary.error} errors, ${summary.info} info`,
      ),
      "summary line exact",
    );
    assert.ok(output.includes("❌ Please fix the errors above"), "errors present -> fix verdict");
    assert.strictEqual(summary.ok + summary.warning + summary.error + summary.info, 20_000);
    assert.ok(elapsed < 5_000, `formatting took ${elapsed.toFixed(0)} ms (budget 5000 ms)`);
  });
});

describe("compaction stress", () => {
  it("buildSenaiCompactionSummary x 1,000 active (identical) + x 1,000 corrupt (null, never throws)", () => {
    const active = makeTmp("stress-compaction-active-");
    saveState(active, {
      ...defaultState(),
      currentStage: "planning",
      runId: "stress-run",
      mission: "stress mission",
      startedAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    });

    const start = performance.now();
    const first = buildSenaiCompactionSummary(active);
    assert.ok(first, "active run must produce a summary");
    assert.ok(first.includes("stress-run") && first.includes("planning") && first.includes("stress mission"));
    for (let i = 0; i < 999; i++) {
      assert.strictEqual(buildSenaiCompactionSummary(active), first, `call ${i}: output identical every time`);
    }

    // Pinned: corrupt state.json -> null every time, never throws.
    const corrupt = makeTmp("stress-compaction-corrupt-");
    fs.mkdirSync(path.dirname(getStatePath(corrupt)), { recursive: true });
    fs.writeFileSync(getStatePath(corrupt), "{not json", "utf8");
    for (let i = 0; i < 1_000; i++) {
      assert.strictEqual(buildSenaiCompactionSummary(corrupt), null, `call ${i}: corrupt state -> null`);
    }

    // Pinned: no run -> null.
    const empty = makeTmp("stress-compaction-empty-");
    assert.strictEqual(buildSenaiCompactionSummary(empty), null);
    const elapsed = performance.now() - start;
    console.log(`buildSenaiCompactionSummary: 2,000 calls (active + corrupt) in ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 10_000, `2,000 summaries took ${elapsed.toFixed(0)} ms (budget 10000 ms)`);
    fs.rmSync(active, { recursive: true, force: true });
    fs.rmSync(corrupt, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
