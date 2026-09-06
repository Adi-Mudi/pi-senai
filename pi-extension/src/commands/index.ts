import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import * as StageCmds from "./stage-commands.js";
import * as StatusCmds from "./status.js";
import * as ApproveCmds from "./approve.js";
import * as OpsCmds from "./ops.js";

export function registerCommands(pi: ExtensionAPI) {
	StageCmds.registerPlanCommand(pi);
	StageCmds.registerImplementCommand(pi);
	StageCmds.registerDocumentCommand(pi);
	StageCmds.registerDeliverCommand(pi);

	StatusCmds.registerStatusCommand(pi);
	ApproveCmds.registerApproveCommand(pi);

	OpsCmds.registerResetCommand(pi);
	OpsCmds.registerLockInfoCommand(pi);
	OpsCmds.registerLockForceCommand(pi);
	OpsCmds.registerCadenceStatusCommand(pi);
	OpsCmds.registerCadenceResetCommand(pi);
}

export {
	registerResetCommand,
	registerLockInfoCommand,
	registerLockForceCommand,
	registerCadenceStatusCommand,
	registerCadenceResetCommand,
} from "./ops.js";

export { registerBrainstormCommands } from "./brainstorm.js";

// Phase 8: re-export the brainstorm module's public API so callers
// (tests, doctor, future commands) can import guard / registry /
// dispatcher / audit helpers from one place.
export {
	BRAINSTORM_DISPATCH_CAP,
	BRAINSTORM_DISPATCH_TIMEOUT_MS,
	buildSummary,
	countBriefSections,
	createAuditSession,
	guardArtifactPath,
	guardBriefContent,
	guardDispatchCount,
	guardSeedInput,
	loadBrainstormRegistry,
	matchSpecialist,
	prepareDispatch,
	readAuditLog,
	rankSpecialists,
	validateBriefContent,
	writeAuditLog,
	type BrainstormEligibleAgent,
	type DispatchPrepResult,
	type DispatchRequest,
	type PreparedDispatch,
} from "../brainstorm/index.js";

export { registerAgentCommands } from "./configure-agents.js";

export { registerFilesCommands } from "./configure-files.js";

export { registerAgentsFilesCommands } from "./configure-agents-files.js";

export { registerDoctorCommand } from "./doctor.js";

export { registerDocsStructureCommand } from "./generate-docs-structure.js";

export { registerArchitectInputsCommands } from "./configure-architect-inputs.js";

export { registerArchitectCommand, defaultArchitectSkill } from "./generate-architect.js";

// Re-export shared helpers so callers (including tests) can still import them
// from commands/index.ts.
export {
	ensureStage,
	checkStageArtifact,
	listMissingStageArtifacts,
	ensureAgentConfig,
	COMPLETED_STAGE_ARTIFACT,
} from "./_helpers.js";
export { SUGGESTION_PAGE_SIZE, browsePath, normalizePath, isFolderLike, isPathConflict } from "./_shared.js";
export { buildCategoryItems, matchesFilter, buildDocumentCandidates } from "./configure-files.js";

export { registerAgentGeneratorCommand } from "./generate-sub-agents.js";
