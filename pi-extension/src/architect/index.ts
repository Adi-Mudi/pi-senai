// Thin barrel — re-exports the per-concern files in this folder.
// Per Pi's layered pattern (extensions.md lines 222-236): one concern per file,
// the folder's index.ts is a thin barrel, not a god module.
//
// Adding a new concern: create a new file, add a re-export below, and update
// src/layers.ts and src/AGENTS.md.

export {
	// profile.ts
	ARCHITECT_PROFILE_FILE,
	loadArchitectProfile,
	saveArchitectProfile,
	getArchitectProfilePath,
	slugify,
	type ArchitectProfile,
} from "./profile.js";

export {
	// report.ts
	ARCHITECT_REPORT_FILE,
	loadArchitectReport,
	saveArchitectReport,
	getArchitectReportPath,
	type ArchitectReport,
	type ArchitectComponent,
	type ArchitectInterface,
	type ArchitectAdr,
	type ArchitectQualityMapping,
} from "./report.js";

export {
	// manifest.ts
	GENERATED_MANIFEST_FILE,
	loadGeneratedManifest,
	writeGeneratedManifest,
	addToGeneratedManifest,
	type GeneratedManifest,
} from "./manifest.js";

export {
	// library-scan.ts
	discoverArchitectureLibrary,
	type ArchitectureLibraryEntry,
} from "./library-scan.js";

export {
	// library-select.ts
	selectArchitecture,
	selectArchitectureWithContext,
} from "./library-select.js";

export {
	// cleanup.ts
	ARCHITECT_ROLES,
	ARCHITECT_STAGES,
	ARCHITECTURE_AGENT_MAPPING,
	ARCHITECT_ROLE_STAGE,
	migrateLegacyArchitectState,
	removeStaleArchitectureArtifacts,
} from "./cleanup.js";

export {
	// generate-agents.ts
	generateAgentFiles,
	autoMapArchitectureAgents,
} from "./generate-agents.js";

export {
	// generate-skills.ts
	generateSkillFiles,
} from "./generate-skills.js";

export {
	// generate-docs.ts
	generateArchitectureDocs,
} from "./generate-docs.js";

export {
	// prompt.ts
	buildArchitectPrompt,
} from "./prompt.js";

export {
	// feasibility.ts
	isFeasible,
	areDriversStale,
} from "./feasibility.js";

export {
	// diagram.ts
	buildSystemContextMermaid,
	buildContainerMermaid,
	buildSequenceMermaid,
} from "./diagram.js";

export {
	// helpers.ts
	parseStringArray,
	buildDriverText,
	extractArchitectureRules,
} from "./helpers.js";

// Re-export library suggester so commands can import via architect/index.js
// without adding a new top-level barrel.
export {
	suggestArchitectures,
	PI_EXTENSION_PRESET,
	isPiExtensionPreset,
	type LibrarySuggestion,
	type ProjectAnswers,
	type ProjectPurpose,
	type ProjectScale,
	type ProjectDeployment,
	type ProjectRealtime,
} from "./library-suggester.js";

// Re-export codebase auto-discovery so commands can import via architect/index.js
export {
	createInputsConfigFromCodebase,
	type CodebaseDiscoveryResult,
} from "./inputs-config.js";

// Re-export Pi extension detector so commands can branch on detection result
export {
	detectPiExtension,
	type PiExtensionDetection,
	type PiSpecificSignal,
} from "./pi-extension-detector.js";
