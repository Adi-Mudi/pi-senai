// Feasibility and staleness checks for the architect factory.

import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectInputsConfig } from "./inputs-config.js";
import { getArchitectInputsConfigPath } from "./inputs-config.js";
import { getDriversPath } from "./drivers.js";
import type { ArchitectReport } from "./report.js";

export function isFeasible(report: ArchitectReport): boolean {
	return report.feasibility === "feasible";
}

export function areDriversStale(cwd: string, inputsConfig: ArchitectInputsConfig): boolean {
	const driversPath = getDriversPath(cwd);
	if (!fs.existsSync(driversPath)) {
		return true;
	}
	const driversMtime = fs.statSync(driversPath).mtimeMs;
	// The inputs config itself is watched: editing additionalConstraints or the
	// document list rewrites it, and both must trigger a re-run.
	const configPath = getArchitectInputsConfigPath(cwd);
	if (fs.existsSync(configPath) && fs.statSync(configPath).mtimeMs > driversMtime) {
		return true;
	}
	for (const doc of inputsConfig.documents) {
		const docPath = path.resolve(cwd, doc.path);
		if (fs.existsSync(docPath)) {
			const docMtime = fs.statSync(docPath).mtimeMs;
			if (docMtime > driversMtime) {
				return true;
			}
		}
	}
	return false;
}
