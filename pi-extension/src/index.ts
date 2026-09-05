import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAgentCommands, registerAgentGeneratorCommand, registerAgentsFilesCommands, registerArchitectCommand, registerArchitectInputsCommands, registerCommands, registerDiscussionCommands, registerDoctorCommand, registerDocsStructureCommand, registerFilesCommands } from "./commands.js";
import { migrateLegacyArchitectState } from "./architect.js";
import { migrateLegacyOrchestraDirs } from "./migrate.js";
import { registerArchitectTools } from "./architect-tools.js";
import { registerTestDisciplineTools } from "./test-discipline-tool.js";
import { registerBeforeAgentStartHook, registerInputHook, registerSessionBeforeCompactHook, registerSessionStartHook, registerToolCallHook } from "./hooks/index.js";

export default function piSenaiExtension(pi: ExtensionAPI) {
	// Do not load inside subagent processes to avoid recursive orchestration.
	if (process.env.PI_SUBAGENT_NAME) {
		return;
	}

	// Migrate any architecture state created before the move to .pi/architect/.
	const moved = migrateLegacyArchitectState(process.cwd());
	if (moved.length > 0) {
		console.log(`[pi-senai] Migrated ${moved.length} architecture file(s) to .pi/architect/.`);
	}

	// Migrate legacy Orchestra directories to Senai directories.
	const migratedDirs = migrateLegacyOrchestraDirs(process.cwd());
	if (migratedDirs.length > 0) {
		console.log(`[pi-senai] Migrated legacy directories: ${migratedDirs.join(", ")}`);
	}

	registerCommands(pi);
	registerDiscussionCommands(pi);
	registerAgentCommands(pi);
	registerFilesCommands(pi);
	registerAgentsFilesCommands(pi);
	registerDoctorCommand(pi);
	registerArchitectInputsCommands(pi);
	registerArchitectCommand(pi);
	registerAgentGeneratorCommand(pi);
	registerDocsStructureCommand(pi);
	registerArchitectTools(pi);
	registerTestDisciplineTools(pi);

	registerSessionStartHook(pi);
	registerSessionBeforeCompactHook(pi);
	registerToolCallHook(pi);
	registerInputHook(pi);
	registerBeforeAgentStartHook(pi);
}
