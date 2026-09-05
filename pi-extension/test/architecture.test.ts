import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Architecture invariant tests.
 *
 * These guard the layered-folder layout established by the architecture
 * upgrade. They prevent the "shim accumulation" anti-pattern from
 * re-emerging during future refactors (e.g., when commands.ts or
 * architect.ts are split incrementally).
 *
 * A "shim" here means a file at src/ root that exists only to re-export
 * from a layered location. During a phased refactor, shims are useful
 * as a transition tool, but they should always be removed at the end.
 */

function isShim(content: string): boolean {
	const trimmed = content.trim();
	if (trimmed.length >= 200) return false;
	// A shim is one or more `export * from "..."` lines, nothing else.
	const lines = trimmed.split("\n").filter((l) => l.trim() !== "");
	if (lines.length === 0) return false;
	return lines.every((l) => /^export \* from ["'][^"']+["'];?$/.test(l.trim()));
}

describe("architecture invariants", () => {
	it("no leftover shim files at src/ root", () => {
		const srcRoot = path.join(import.meta.dirname, "..", "src");
		const offenders: string[] = [];
		for (const f of fs.readdirSync(srcRoot)) {
			if (!f.endsWith(".ts")) continue;
			const filePath = path.join(srcRoot, f);
			if (!fs.statSync(filePath).isFile()) continue;
			const content = fs.readFileSync(filePath, "utf8");
			if (isShim(content)) offenders.push(f);
		}
		assert.deepEqual(
			offenders,
			[],
			`Found ${offenders.length} shim file(s) at src/ root that should have been removed: ${offenders.join(", ")}. ` +
				"See .IDE_Plans/architecture_refactor_plan for why shims are transitional, not permanent.",
		);
	});

	it("core/ contains only domain modules (no shim re-exports)", () => {
		// Sanity check: layered folders should never contain shims.
		const coreDir = path.join(import.meta.dirname, "..", "src", "core");
		for (const f of fs.readdirSync(coreDir)) {
			if (!f.endsWith(".ts")) continue;
			const content = fs.readFileSync(path.join(coreDir, f), "utf8");
			assert.equal(isShim(content), false, `${f} in core/ looks like a shim`);
		}
	});
});
