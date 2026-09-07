// Returns the absolute path to the pi-senai package root directory.
// Tries the compiled dist layout first, then falls back to the source
// layout, so the same code works in published packages (dist/) and
// during local development (src/).
//
// Replaces the "Never use __dirname for package assets" rule from Pi's
// docs/development.md:47, which prescribes getPackageDir() from Pi's
// internal src/config.ts. That helper is not exported to extensions,
// so pi-senai uses this dual-path resolver instead.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export function getPackageAssetDir(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	// dist layout: dist/pi-extension/src/io/ -> up 4 -> package root
	const distLayout = path.resolve(here, "..", "..", "..", "..");
	if (fs.existsSync(path.join(distLayout, "package.json"))) {
		return distLayout;
	}
	// source layout: pi-extension/src/io/ -> up 3 -> package root
	return path.resolve(here, "..", "..", "..");
}
