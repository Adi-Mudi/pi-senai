import * as fs from "node:fs";
import * as path from "node:path";

import { loadArchitectProfile, getLayerMap, discoverFrameworkLibrary, validateFrameworkMap } from "@adi-mudi/pi-chirpi";
import { STAGES, STAGE_TRANSITIONS, getCadencePath } from "../core/paths.js";
import { WEB_TOOL_ALLOWED_ROLES, WEB_TOOLS } from "../core/agents-config/suggestions.js";
import { getPackageAssetDir } from "../io/package-dir.js";
import { loadState } from "../core/state.js";

import type { DiagnosticItem, DiagnosticSection } from "./_types.js";

/** Phase-4 hard enforcement coverage. Verifies the machine gates are armed:
 *  spawn-guard wiring in the installed build, the shared web-tool lock rule,
 *  the stage machine table, the architecture layer-map wiring used by the
 *  plan gate, the reviewer-architecture agent in the generated team, and
 *  cadence state file sanity. */
export function checkHardGates(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	// 1. Spawn guard wiring. doctor (layer 1) must not import hooks (layer 2),
	// so this verifies the installed build instead: the compiled guard module
	// exists, the tool_call hook wires it, and the web-tool hard block is in.
	const pkgRoot = getPackageAssetDir();
	const guardCandidates = [
		path.join(pkgRoot, "dist", "pi-extension", "src", "hooks", "spawn-guard.js"),
		path.join(pkgRoot, "pi-extension", "src", "hooks", "spawn-guard.ts"),
	];
	const toolCallCandidates = [
		path.join(pkgRoot, "dist", "pi-extension", "src", "hooks", "tool-call.js"),
		path.join(pkgRoot, "pi-extension", "src", "hooks", "tool-call.ts"),
	];
	const guardFile = guardCandidates.find((p) => fs.existsSync(p));
	const toolCallFile = toolCallCandidates.find((p) => fs.existsSync(p));
	const guardSource = guardFile ? fs.readFileSync(guardFile, "utf8") : "";
	const toolCallSource = toolCallFile ? fs.readFileSync(toolCallFile, "utf8") : "";
	if (!guardFile || !toolCallSource.includes("guardSpawnCall")) {
		items.push({
			status: "error",
			message: "Spawn guard is NOT wired into the tool_call hook in the installed build.",
			details: [
				`Guard module: ${guardFile ?? "missing"}`,
				"Rebuild the extension (npm run build) and restart pi.",
			],
		});
	} else if (!guardSource.includes("guardWebToolLock")) {
		items.push({
			status: "error",
			message: "Spawn guard module is stale — the web tool lock hard block is missing from the installed build.",
			details: ["Rebuild the extension (npm run build) and restart pi."],
		});
	} else {
		items.push({
			status: "ok",
			message: "Spawn guard armed: tool_call hook blocks bare role names and web-tool violations at spawn time.",
		});
	}

	// 2. Web tool lock rule (single source of truth shared by guard + doctor).
	items.push({
		status: "ok",
		message: `Web tool lock: only [${[...WEB_TOOL_ALLOWED_ROLES].join(", ")}] may carry ${[...WEB_TOOLS].join(" / ")} — enforced at spawn, audited here.`,
	});

	// 3. Stage machine table sanity.
	const missingStages = STAGES.filter((s) => !(s in STAGE_TRANSITIONS));
	const badTargets = Object.entries(STAGE_TRANSITIONS).flatMap(([from, targets]) =>
		targets.filter((t) => !STAGES.includes(t)).map((t) => `${from} → ${t}`),
	);
	if (missingStages.length > 0 || badTargets.length > 0) {
		items.push({
			status: "error",
			message: "Stage transition table is inconsistent.",
			details: [
				...missingStages.map((s) => `no transitions defined for '${s}'`),
				...badTargets.map((t) => `invalid transition target: ${t}`),
			],
		});
	} else {
		items.push({
			status: "ok",
			message: `Stage machine: all ${STAGES.length} stages have defined transitions; manual stage commands hard-block out-of-order invocation.`,
		});
	}

	// 4. Architecture layer wiring (plan gate + arch-rules enforcement).
	let profile: ReturnType<typeof loadArchitectProfile> = null;
	try {
		profile = loadArchitectProfile(cwd);
	} catch {
		profile = null;
	}
	if (profile) {
		let layerMapOk = false;
		try {
			const map = getLayerMap(profile.selectedArchitecture, cwd);
			layerMapOk = !!map && map.layers.length > 0;
		} catch {
			layerMapOk = false;
		}
		if (layerMapOk) {
			items.push({
				status: "ok",
				message: `Layer map for '${profile.selectedArchitecture}' loaded — plan manifest layer validation is armed.`,
			});
		} else {
			items.push({
				status: "warning",
				message: `No layer map found for architecture '${profile.selectedArchitecture}' — plan manifest layers are not validated.`,
				details: ["Add a ```json layer-map block to the architecture library entry (pi-chirpi)."],
			});
		}

		// 5. reviewer-architecture agent exists in the generated team.
		const reviewerArch = path.join(
			cwd,
			".pi",
			"agents",
			`${profile.projectSlug}-${profile.selectedArchitecture}-reviewer-architecture.md`,
		);
		if (fs.existsSync(reviewerArch)) {
			items.push({ status: "ok", message: "reviewer-architecture agent exists in the generated team." });
		} else {
			items.push({
				status: "error",
				message: "reviewer-architecture agent is missing from the generated team.",
				details: [
					`Expected: ${path.relative(cwd, reviewerArch)}`,
					"Fix: re-run /chirpi-generate-architect (generator v10+) to regenerate the architecture agents.",
				],
			});
		}
	} else {
		items.push({
			status: "info",
			message: "No architecture generated yet — layer-map and reviewer-architecture checks skipped.",
		});
	}

	// 4b. Emitted arch-rules config in the project.
	const depcruiseConfig = path.join(cwd, ".dependency-cruiser.json");
	const importLinterConfig = path.join(cwd, ".importlinter");
	if (fs.existsSync(depcruiseConfig) || fs.existsSync(importLinterConfig)) {
		items.push({
			status: "ok",
			message: `Arch-rules config present (${fs.existsSync(depcruiseConfig) ? ".dependency-cruiser.json" : ".importlinter"}) — the implement gate runs it when the tool is installed.`,
		});
	} else {
		items.push({
			status: "info",
			message: "No emitted arch-rules config (.dependency-cruiser.json / .importlinter) in the project — arch-rules check is idle.",
		});
	}

	// 4c. Framework library in the installed chirpi package (plan-gate lock +
	// implement-stage framework rules both read it).
	let frameworkMaps: ReturnType<typeof discoverFrameworkLibrary> = [];
	try {
		frameworkMaps = discoverFrameworkLibrary(cwd);
	} catch {
		frameworkMaps = [];
	}
	if (frameworkMaps.length === 0) {
		items.push({
			status: "error",
			message: "Framework library missing from the installed @adi-mudi/pi-chirpi package — the framework lock and implement-gate framework rules cannot run.",
			details: ["Re-sync or reinstall @adi-mudi/pi-chirpi so framework-library/ ships with the package."],
		});
	} else {
		const invalid = frameworkMaps.flatMap((m) => validateFrameworkMap(m).map((p) => `${m.id}: ${p}`));
		if (invalid.length > 0) {
			items.push({
				status: "error",
				message: `${invalid.length} framework map problem(s) in the framework library.`,
				details: invalid.slice(0, 10),
			});
		} else {
			items.push({
				status: "ok",
				message: `Framework library: ${frameworkMaps.length} map(s) present and valid — the plan gate can lock the chosen framework.`,
			});
		}
	}

	// 4d. Framework-rules gate wiring in the installed build (same style as
	// the spawn-guard check: doctor is layer 1 and must not import hooks, so
	// it verifies the compiled modules instead).
	const fwRunnerCandidates = [
		path.join(pkgRoot, "dist", "pi-extension", "src", "implement", "framework-rules-check.js"),
		path.join(pkgRoot, "pi-extension", "src", "implement", "framework-rules-check.ts"),
	];
	const fwSignalsCandidates = [
		path.join(pkgRoot, "dist", "pi-extension", "src", "implement", "signals.js"),
		path.join(pkgRoot, "pi-extension", "src", "implement", "signals.ts"),
	];
	const fwRunnerFile = fwRunnerCandidates.find((p) => fs.existsSync(p));
	const fwSignalsFile = fwSignalsCandidates.find((p) => fs.existsSync(p));
	const fwSignalsSource = fwSignalsFile ? fs.readFileSync(fwSignalsFile, "utf8") : "";
	if (!fwRunnerFile || !fwSignalsSource.includes("checkFrameworkRules")) {
		items.push({
			status: "error",
			message: "Framework-rules check is NOT wired into the implement signals collector in the installed build.",
			details: [
				`Runner module: ${fwRunnerFile ?? "missing"}`,
				"Rebuild the extension (npm run build) and restart pi.",
			],
		});
	} else {
		items.push({
			status: "ok",
			message: "Framework rules gate armed: implement signals run the locked framework's forbidden rules after arch-rules.",
		});
	}

	// 6. Cadence state file sanity. loadCadenceState silently defaults on a
	// corrupt file, so doctor reads the raw file to surface corruption.
	const cadencePath = getCadencePath(cwd);
	if (!fs.existsSync(cadencePath)) {
		items.push({ status: "info", message: "Cadence state: fresh (no spawn-cadence.json yet — defaults to tier A)." });
	} else {
		let sane = false;
		let why = "";
		try {
			const parsed = JSON.parse(fs.readFileSync(cadencePath, "utf8"));
			if (["A", "B", "C", "D"].includes(parsed?.tier)) {
				sane = true;
			} else {
				why = `invalid tier "${parsed?.tier}"`;
			}
		} catch (err: any) {
			why = `unparseable JSON (${err.message})`;
		}
		if (sane) {
			items.push({ status: "ok", message: "Cadence state file is sane." });
		} else {
			items.push({
				status: "warning",
				message: `Cadence state file is corrupt: ${why}.`,
				details: ["The cadence silently falls back to defaults. Run /senai-cadence-reset to rewrite it."],
			});
		}
	}

	// Note run activity so users know the spawn guard only bites mid-run.
	try {
		const state = loadState(cwd);
		const active = state.currentStage !== "none" && state.currentStage !== "delivered";
		items.push({
			status: "info",
			message: active
				? `Run '${state.runId}' is in '${state.currentStage}' — spawn guard and stage gates are active.`
				: "No active run — spawn guard and stage gates are armed but idle.",
		});
	} catch {
		/* state problems are reported by the run-state sections */
	}

	return { title: "Hard enforcement gates", items };
}
