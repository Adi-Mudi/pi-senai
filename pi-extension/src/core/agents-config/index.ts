// Layer 0 barrel — Senai config domain.
// Houses the config types and load/save helpers for the three managed
// project-level config files: agents.json, files.json, agents_files.json.
// Plus the agent role list and document-suggestion helpers.

export {
	CONFIG_DIR,
	CONFIG_FILE,
	CONFIG_COMMENT,
	getConfigPath,
	loadAgentConfig,
	saveAgentConfig,
	validateAgentConfig,
	resolveAgentName,
	validateMappedAgents,
	type AgentConfig,
} from "./config.js";

export {
	FILES_CONFIG_FILE,
	FILES_CONFIG_COMMENT,
	CURRENT_FILES_CONFIG_VERSION,
	getFilesConfigPath,
	loadFilesConfig,
	saveFilesConfig,
	validateFilesConfig,
	migrateFilesConfig,
	type FilesConfig,
	type FilesConfigV1,
} from "./files-config.js";

export {
	AGENTS_FILES_CONFIG_FILE,
	AGENTS_FILES_CONFIG_COMMENT,
	getAgentsFilesConfigPath,
	loadAgentsFilesConfig,
	saveAgentsFilesConfig,
	validateAgentsFilesConfig,
	migrateAgentsFilesConfig,
	type AgentsFilesConfig,
	type AgentFilesDocuments,
} from "./agents-files-config.js";

export {
	SENAI_ROLES,
	PICKER_ROLES,
	SEQUENCE_ROLES,
	ROLE_LABELS,
	ROLE_GUIDANCE,
	DEFAULT_AGENTS,
	buildSuggestionMap,
	type SenaiRole,
} from "./suggestions.js";

export {
	roleDocumentNeed,
	suggestTruthDocuments,
	type DocumentSuggestion,
} from "./document-suggestions.js";
