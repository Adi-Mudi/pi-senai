import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { generateDocsStructure } from "../docs-factory/selection.js";

export function registerDocsStructureCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-generate-docs-structure", {
		description: "Create the docs folder skeleton and template stubs for the selected document types",
		handler: async (_args, ctx) => {
			const result = generateDocsStructure(ctx.cwd);
			const lines = [
				`Docs structure: created ${result.created.length} stub(s), kept ${result.kept.length} existing doc(s).`,
			];
			if (result.created.length > 0) {
				lines.push("", "Created:");
				for (const p of result.created) lines.push(`  ${p}`);
			}
			if (result.kept.length > 0) {
				lines.push("", "Kept (existing, not overwritten):");
				for (const p of result.kept) lines.push(`  ${p}`);
			}
			lines.push("", "Manifest: .pi/senai/docs-structure.json", "Next: /senai-plan <mission>");
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
