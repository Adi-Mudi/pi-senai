import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

export interface TestHome {
	/** Absolute path to the temp project directory (cwd of the test). */
	cwd: string;
	/** Absolute path to the synthetic HOME. */
	home: string;
	/** The env overrides to pass into child_process.spawn. */
	env: NodeJS.ProcessEnv;
	/** Cleanup callback — safe to call multiple times. */
	cleanup: () => void;
}

export interface MakeHomeOptions {
	/** Extra subdirectories to create inside cwd. */
	layout?: string[];
	/** Extra files to write (absolute paths under cwd). */
	files?: Array<{ path: string; content: string }>;
	/** Optional human label embedded in the dir name for debugging. */
	label?: string;
}

const OWNERSHIP_MARKER = ".pi-e2e-owned";

/** Returns true when `pi` is on PATH and RUN_E2E=1 is set. */
export function shouldRunE2E(): boolean {
	if (process.env.RUN_E2E !== "1") return false;
	try {
		execSync("command -v pi", { stdio: "ignore", shell: "/bin/bash" });
		return true;
	} catch {
		return false;
	}
}

/** Recognized provider keys (matches Doc/test-plan.md). */
const PROVIDER_KEY_VARS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GOOGLE_API_KEY",
	"MISTRAL_API_KEY",
	"KIMI_API_KEY",
	"KIMI_CODE_HOME",
];

/** The dummy key the CI workflow injects. Treated as "no real key" so
 *  tests that need a real LLM skip locally and on CI alike. */
const DUMMY_KEYS = new Set([
	"sk-ant-e2e-dummy-not-used",
	"",
]);

/** Returns true if a recognized provider key is set to a non-dummy value
 *  in the environment. Tests that exercise real LLM calls should gate
 *  on this and skip cleanly when false. */
export function hasRealLlmKey(): boolean {
	for (const k of PROVIDER_KEY_VARS) {
		const v = process.env[k];
		if (v && v.length > 0 && !DUMMY_KEYS.has(v)) return true;
	}
	return false;
}

/** Returns true when Tier 2 (real-LLM) E2E should run. Stricter than
 *  `shouldRunE2E`: requires both the gate flag and a recognized provider
 *  API key in the environment. Without a key the test would crash on
 *  the first model call. */
export function shouldRunLLME2E(): boolean {
	if (!shouldRunE2E()) return false;
	if (process.env.RUN_LLM_E2E !== "1") return false;
	return hasRealLlmKey();
}

/** Walk up from this helper file until we find a package.json with the
 *  pi-senai name (scoped or unscoped). Returns the absolute path to that
 *  project root, or null. */
function findProjectRoot(start: string): string | null {
	let dir = start;
	for (let i = 0; i < 16; i++) {
		const pkg = path.join(dir, "package.json");
		if (fs.existsSync(pkg)) {
			try {
				const json = JSON.parse(fs.readFileSync(pkg, "utf8")) as { name?: string };
				if (
					json &&
					typeof json.name === "string" &&
					(json.name === "pi-senai" || json.name.endsWith("/pi-senai") || json.name.endsWith("/pi-senai-x"))
				) {
					return dir;
				}
			} catch { /* keep walking */ }
		}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
	return null;
}

/** Absolute file:// URL of a compiled module under `dist/pi-extension/src/`.
 *  E2E subprocesses run with cwd set to the temp project dir, so a relative
 *  specifier like `./dist/...` cannot resolve. Callers must use this. */
export function distModuleUrl(relative: string): string {
	const thisDir = path.dirname(fileURLToPath(import.meta.url));
	const root = findProjectRoot(thisDir);
	if (!root) throw new Error("distModuleUrl: could not locate the pi-senai project root");
	return pathToFileURL(path.join(root, "dist", "pi-extension", "src", relative)).href;
}

export function makeTestHome(opts: MakeHomeOptions = {}): TestHome {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-senai-e2e-"));
	const home = path.join(root, "home");
	const cwd = path.join(root, "project");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(cwd, { recursive: true });
	fs.writeFileSync(path.join(root, OWNERSHIP_MARKER), "owned");

	// Symlink the pi-senai extension into the synthetic HOME so
	// `pi --mode rpc` picks it up. The extension lives at the project
	// root (its package.json has the `pi.extensions` field that pi reads).
	const thisDir = path.dirname(fileURLToPath(import.meta.url));
	const projectRoot = findProjectRoot(thisDir);
	if (projectRoot) {
		const extDir = path.join(home, ".pi", "agent", "extensions");
		fs.mkdirSync(extDir, { recursive: true });
		fs.symlinkSync(projectRoot, path.join(extDir, "pi-senai"));
	}

	for (const sub of opts.layout ?? ["src", "test"]) {
		fs.mkdirSync(path.join(cwd, sub), { recursive: true });
	}
	for (const f of opts.files ?? []) {
		const full = path.isAbsolute(f.path) ? f.path : path.join(cwd, f.path);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, f.content, "utf8");
	}

	const tmpDir = path.join(root, "tmp");
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: home,
		TMPDIR: tmpDir,
		XDG_CACHE_HOME: path.join(home, ".cache"),
		XDG_CONFIG_HOME: path.join(home, ".config"),
		XDG_DATA_HOME: path.join(home, ".local/share"),
	};
	fs.mkdirSync(tmpDir, { recursive: true });
	fs.mkdirSync(path.join(home, ".config"), { recursive: true });

	let cleaned = false;
	return {
		cwd,
		home,
		env,
		cleanup: () => {
			if (cleaned) return;
			cleaned = true;
			// Refuse to remove anything outside the marked root.
			const marker = path.join(root, OWNERSHIP_MARKER);
			if (!fs.existsSync(marker)) return;
			fs.rmSync(root, { recursive: true, force: true });
		},
	};
}
