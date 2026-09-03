/**
 * Test discipline tool registration.
 *
 * Exposes the deterministic scanner (test-discipline.ts) as a Pi tool the
 * LLM can call. Mirrors the registerArchitectTools pattern in
 * architect-tools.ts.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
    scanTestFilesOnDisk,
    resolveTestPaths,
    type ScanReport,
} from "./test-discipline.js";

export function registerTestDisciplineTools(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "senai_scan_test_smells",
        label: "Scan test files for anti-patterns",
        description:
            "Scan the configured test paths for common test anti-patterns (zero-assertion, over-mocking, mirror-logic, flaky-timing, no-AAA, mystery-guest, private-method, god-test). Returns a JSON report with file:line findings and severity counts. Deterministic — same input always produces the same output.",
        parameters: Type.Object({
            cwd: Type.Optional(Type.String({ description: "Project root. Defaults to the current session cwd." })),
            paths: Type.Optional(Type.Array(Type.String(), {
                description: "Optional explicit list of file paths to scan. If omitted, reads testPaths from files.json.",
            })),
            strict: Type.Optional(Type.Boolean({
                description: "If true, also report informational findings with strict markers. Default false.",
            })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = (params.cwd as string | undefined) ?? ctx.cwd;
            const explicit = (params.paths as string[] | undefined);
            const paths = explicit && explicit.length > 0 ? explicit : resolveTestPaths(cwd);
            const strict = (params.strict as boolean | undefined) ?? false;
            const report: ScanReport = scanTestFilesOnDisk(paths);
            return {
                content: [{ type: "text", text: JSON.stringify({ ...report, strict }, null, 2) }],
                details: { report, strict },
            };
        },
    });
}
