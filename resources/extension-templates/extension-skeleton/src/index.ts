import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Default factory function. Pi calls this once per session.
 * Return synchronously, or `async function` if you need remote discovery.
 */
export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("my-pi-extension loaded", "info");
	});

	pi.registerCommand("my-extension-hello", {
		description: "Print a greeting",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Hello from my-pi-extension!", "info");
		},
	});
}