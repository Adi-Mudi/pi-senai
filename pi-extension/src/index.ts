import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { formatStageStatus } from "./constants.js";
import { registerCommands } from "./commands.js";
import { loadState } from "./state.js";

export default function piOrchestraExtension(pi: ExtensionAPI) {
  // Do not load inside subagent processes to avoid recursive orchestration.
  if (process.env.PI_SUBAGENT_NAME) {
    return;
  }

  registerCommands(pi);

  // Inject orchestra status into the system prompt when a run is active.
  pi.on("before_agent_start", async (_event, ctx) => {
    const state = loadState(ctx.cwd);
    if (state.currentStage === "none") {
      return { systemPrompt: _event.systemPrompt };
    }

    const statusBlock = formatStageStatus(state);
    return {
      systemPrompt: `${_event.systemPrompt}\n\n${statusBlock}`,
    };
  });
}
