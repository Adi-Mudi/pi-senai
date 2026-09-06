import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { formatDiagnosticReport, runSenaiDiagnostic } from "../doctor/index.js";
import { atomicWriteFile } from "../io/atomic-write.js";

export function registerDoctorCommand(pi: ExtensionAPI) {
	pi.registerCommand("senai-doctor", {
		description: "Run a full diagnostic check on Senai configuration",
		handler: async (_args, ctx) => {
			const report = runSenaiDiagnostic(ctx.cwd);
			const text = formatDiagnosticReport(report);
			const reportPath = path.join(ctx.cwd, ".IDE_Plans", "pi-senai", "doctor-report.md");
			fs.mkdirSync(path.dirname(reportPath), { recursive: true });
			atomicWriteFile(reportPath, text, "utf8");
			pi.sendUserMessage(`${text}\n\nReport saved to .IDE_Plans/pi-senai/doctor-report.md`);
		},
	});
}
