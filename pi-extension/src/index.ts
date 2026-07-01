import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { formatStageStatus } from "./constants.js";
import {
  registerAgentCommands,
  registerAgentsFilesCommands,
  registerCommands,
  registerFilesCommands,
} from "./commands.js";
import { loadState } from "./state.js";

export default function piOrchestraExtension(pi: ExtensionAPI) {
  // Do not load inside subagent processes to avoid recursive orchestration.
  if (process.env.PI_SUBAGENT_NAME) {
    return;
  }

  registerCommands(pi);
  registerAgentCommands(pi);
  registerFilesCommands(pi);
  registerAgentsFilesCommands(pi);

  // Inject orchestra status into the system prompt when a run is active.
  pi.on("before_agent_start", async (_event, ctx) => {
    const state = loadState(ctx.cwd);
    if (state.currentStage === "none") {
      return { systemPrompt: _event.systemPrompt };
    }

    const rules: string[] = [];
    if (state.currentStage === "planning") {
      rules.push(
        `Plan stage rule: You MUST spawn four fresh scout subagents using the subagent tool. ` +
          `Do NOT reuse, copy, or read scout reports from any previous run folder. ` +
          `Do not write scout reports yourself.`,
      );
    }

    const statusBlock = formatStageStatus(state);
    const extra = rules.length > 0 ? `\n\n${rules.join("\n\n")}` : "";
    return {
      systemPrompt: `${_event.systemPrompt}${extra}\n\n${statusBlock}`,
    };
  });
}
