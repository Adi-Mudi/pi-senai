import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

const GOLDEN_DIR = path.join(import.meta.dirname, "__golden_prompts__");
const GOLDEN_FILE = path.join(GOLDEN_DIR, "planning.b64");

function loadGolden(): string {
	return Buffer.from(fs.readFileSync(GOLDEN_FILE, "utf8").trim(), "base64").toString("utf8");
}

function maybeUpdateGolden(text: string): void {
	if (process.env.UPDATE_SNAPSHOTS !== "1") return;
	fs.mkdirSync(GOLDEN_DIR, { recursive: true });
	fs.writeFileSync(GOLDEN_FILE, Buffer.from(text, "utf8").toString("base64") + "\n", "utf8");
}

const REQUIRED_SUBSTRINGS = [
	"Plan stage rule",
	"spawn four fresh scout subagents",
	"## Document Scope",
	"Artifact paths for this run",
	"plan/scouts/scout-angle_1.md",
	"plan/reviews/review-correctness.md",
	"deliver/security-report.md",
];

describe("e2e/04-prompt-injection", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedSenaiConfig(home);
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("/senai-plan injects the expected plan-stage prompt", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-plan check prompt injection" });
			await client.waitForIdle();
			const { messages } = await client.getMessages();

			// The injected prompt lives on the assistant turn the parent produced
			// after the slash command. We scan every message that has a string
			// body and pick the first one containing "<pi-senai stage=\"plan\">".
			let systemPrompt = "";
			for (const m of messages) {
				const body = typeof m?.content === "string"
					? m.content
					: Array.isArray(m?.content)
						? m.content.map((c: any) => c?.text ?? "").join("\n")
						: "";
				if (body.includes('<pi-senai stage="plan">')) {
					systemPrompt = body;
					break;
				}
			}
			assert.ok(systemPrompt.length > 0, "no plan-stage message captured");

			maybeUpdateGolden(systemPrompt);

			// Either match the golden (preferred) or assert required substrings
			// when the golden file is absent (first run).
			let golden = "";
			try {
				golden = loadGolden();
				// Treat the stub as empty so first-run matches by substrings.
				if (golden.length < 50) golden = "";
			} catch { /* first run: skip golden */ }

			if (golden) {
				assert.strictEqual(systemPrompt, golden, "plan-stage prompt drifted from golden; run with UPDATE_SNAPSHOTS=1 to refresh");
			} else {
				for (const sub of REQUIRED_SUBSTRINGS) {
					assert.ok(systemPrompt.includes(sub), `plan prompt missing required substring: ${sub}`);
				}
			}
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)})`);
			}
			throw err;
		}
	});
});
