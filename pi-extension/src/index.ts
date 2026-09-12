import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentCommands, registerAgentGeneratorCommand, registerAgentsFilesCommands, registerCommands, registerBrainstormCommands, registerDoctorCommand, registerDocsStructureCommand, registerFilesCommands } from "./commands/index.js";
import { registerBrainstormSessionTool } from "./brainstorm/state-tool.js";
import { registerTestDisciplineTools } from "./implement/discipline-tool.js";
import { registerBeforeAgentStartHook, registerInputHook, registerSessionBeforeCompactHook, registerSessionStartHook, registerToolCallHook } from "./hooks/index.js";

export default function piSenaiExtension(pi: ExtensionAPI) {
	// Do not load inside subagent processes to avoid recursive orchestration.
	if (process.env.PI_SUBAGENT_NAME) {
		return;
	}

	// Legacy migrations run in the session_start hook, not here: the factory
	// must stay free of filesystem side effects so extension loading is cheap
	// and safe to repeat (reload, headless mode).

	registerCommands(pi);
	registerBrainstormCommands(pi);
	registerAgentCommands(pi);
	registerFilesCommands(pi);
	registerAgentsFilesCommands(pi);
	registerDoctorCommand(pi);
	registerAgentGeneratorCommand(pi);
	registerDocsStructureCommand(pi);
	registerTestDisciplineTools(pi);
	registerBrainstormSessionTool(pi);

	registerSessionStartHook(pi);
	registerSessionBeforeCompactHook(pi);
	registerToolCallHook(pi);
	registerInputHook(pi);
	registerBeforeAgentStartHook(pi);
}
