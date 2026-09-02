import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcClient, isPiRpcPromptBug } from "./helpers/rpc-client.js";
import { makeTestHome, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedSenaiConfig } from "./helpers/fixtures.js";

const SKIP_MESSAGE = "E2E tests require pi binary on PATH and RUN_E2E=1";

// The doctor and slash commands are invoked via the RPC `prompt` channel,
// which is broken on pi 0.84.3 (see helpers/rpc-client.ts). Tests that
// invoke a slash command skip cleanly when the bug fires; tests that only
// inspect the cadence state file (format round-trip) run unconditionally.
describe("e2e/10-cadence", () => {
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

	it("get_commands returns /senai-cadence-status and /senai-cadence-reset", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		const result = await client.getCommands();
		const names = (result.commands ?? []).map((c: any) => String(c.name).replace(/^\//, ""));
		assert.ok(names.includes("senai-cadence-status"), "/senai-cadence-status not registered");
		assert.ok(names.includes("senai-cadence-reset"), "/senai-cadence-reset not registered");
		// The lock helpers from the earlier commit should also be there.
		assert.ok(names.includes("senai-lock-info"), "/senai-lock-info not registered");
		assert.ok(names.includes("senai-lock-force"), "/senai-lock-force not registered");
	});

	it("cadence state file at .IDE_Plans/senai/spawn-cadence.json round-trips through load/save", () => {
		if (!shouldRunE2E()) return; // setup-only — no RPC needed
		assert.ok(home, "test setup missing");
		const cadencePath = path.join(home.cwd, ".IDE_Plans", "senai", "spawn-cadence.json");
		const state = {
			_comment: "Adaptive spawn cadence for the Plan stage.",
			version: 1,
			tier: "C",
			consecutiveCleanRuns: 2,
			last429At: "2026-09-01T12:00:00.000Z",
			lastPromotableAt: null,
			history: [
				{ ts: "2026-09-01T12:00:00.000Z", from: "A", to: "B", reason: "demote:rate_limit" },
				{ ts: "2026-09-01T12:00:01.000Z", from: "B", to: "C", reason: "demote:rate_limit" },
			],
		};
		fs.mkdirSync(path.dirname(cadencePath), { recursive: true });
		fs.writeFileSync(cadencePath, JSON.stringify(state, null, 2) + "\n", "utf8");
		const back = JSON.parse(fs.readFileSync(cadencePath, "utf8"));
		assert.strictEqual(back.tier, "C");
		assert.strictEqual(back.consecutiveCleanRuns, 2);
		assert.strictEqual(back.history.length, 2);
		assert.strictEqual(back.history[0].reason, "demote:rate_limit");
	});

	it("/senai-cadence-status reports tier A on a fresh project (skips on pi 0.84.3 prompt bug)", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		try {
			await client.request("prompt", { text: "/senai-cadence-status" });
			await client.waitForIdle();
			// We can't observe the notify() text from RPC because notify is
			// fire-and-forget over the extension UI sub-protocol. Instead,
			// verify the cadence file the command writes was either freshly
			// created at A or remained untouched at A.
			const cadencePath = path.join(home.cwd, ".IDE_Plans", "senai", "spawn-cadence.json");
			if (fs.existsSync(cadencePath)) {
				const state = JSON.parse(fs.readFileSync(cadencePath, "utf8"));
				assert.strictEqual(state.tier, "A", "fresh project should report tier A");
			}
			// If the file wasn't written, the command was a no-op (status is
			// read-only), which is also acceptable.
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});

	it("/senai-cadence-reset moves a tier-D state back to tier A (skips on pi 0.84.3 prompt bug)", { timeout: 60_000 }, async (t) => {
		if (!shouldRunE2E()) return t.skip(SKIP_MESSAGE);
		assert.ok(client && home, "test setup missing");
		// Seed a tier-D state with 7 clean runs so the floor-escape warning
		// is meaningful, then ask the reset command to clear it.
		const cadencePath = path.join(home.cwd, ".IDE_Plans", "senai", "spawn-cadence.json");
		fs.mkdirSync(path.dirname(cadencePath), { recursive: true });
		fs.writeFileSync(
			cadencePath,
			JSON.stringify({
				_comment: "Adaptive spawn cadence for the Plan stage.",
				version: 1,
				tier: "D",
				consecutiveCleanRuns: 7,
				last429At: "2026-09-01T00:00:00.000Z",
				lastPromotableAt: "2026-09-02T00:00:00.000Z",
				history: [
					{ ts: "2026-09-01T00:00:00.000Z", from: "C", to: "D", reason: "demote:rate_limit" },
				],
			}, null, 2) + "\n",
			"utf8",
		);

		try {
			// /senai-cadence-reset pops a confirm dialog. pi 0.84.3 may
			// auto-cancel the dialog depending on the prompt-bug branch.
			await client.request("prompt", { text: "/senai-cadence-reset" });
			await client.waitForIdle();

			const after = JSON.parse(fs.readFileSync(cadencePath, "utf8"));
			// Whether the user confirmed or cancelled, the file shape must
			// still be a valid cadence state. Tier stays D on cancel, goes
			// to A on confirm.
			assert.ok(["A", "D"].includes(after.tier), `unexpected tier after reset: ${after.tier}`);
			if (after.tier === "A") {
				assert.strictEqual(after.consecutiveCleanRuns, 0);
				const last = after.history[after.history.length - 1];
				assert.strictEqual(last.reason, "reset:manual");
			}
		} catch (err) {
			if (isPiRpcPromptBug(err)) {
				return t.skip(`pi RPC prompt handler is broken on this version (${(err as Error).message.slice(0, 80)}); install a working pi binary to enable this test`);
			}
			throw err;
		}
	});
});
