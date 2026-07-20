import * as fs from "node:fs";
import * as path from "node:path";
import { looksLikeTestPath } from "./files-discovery.js";

export const FILES_CONFIG_FILE = "files.json";

export const CURRENT_FILES_CONFIG_VERSION = 2;

const DEFAULT_EXCLUDED_PATHS = [
  ".git/",
  "node_modules/",
  "__pycache__/",
  ".venv/",
  "venv/",
  "dist/",
  "build/",
  "target/",
  ".pi/",
  ".idea/",
  ".vscode/",
];

export interface FilesConfigV1 {
  version: 1;
  files: string[];
}

export interface FilesConfig {
  version: 2;
  codePaths: string[];
  inputDocuments: string[];
  testPaths: string[];
  excludedPaths: string[];
}

export function getFilesConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "senai", FILES_CONFIG_FILE);
}

export function loadFilesConfig(cwd: string): FilesConfig | null {
  const configPath = getFilesConfigPath(cwd);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as FilesConfigV1 | FilesConfig;
    if (parsed.version === 1) {
      return migrateFilesConfig(parsed as FilesConfigV1);
    }
    validateFilesConfig(parsed as FilesConfig);
    return parsed as FilesConfig;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid files config at ${configPath}: ${err.message}`);
  }
}

export function saveFilesConfig(cwd: string, config: FilesConfig): void {
  const configPath = getFilesConfigPath(cwd);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

export function validateFilesConfig(config: FilesConfig): void {
  if (config.version !== CURRENT_FILES_CONFIG_VERSION) {
    throw new Error(
      `Unsupported files.json version: ${config.version}. Expected version: ${CURRENT_FILES_CONFIG_VERSION}. Run /senai-configure-files to recreate.`,
    );
  }
  const arrays = ["codePaths", "inputDocuments", "testPaths", "excludedPaths"] as const;
  for (const key of arrays) {
    if (!Array.isArray(config[key])) {
      throw new Error(`Missing or invalid '${key}' field`);
    }
    for (const f of config[key]) {
      if (typeof f !== "string") {
        throw new Error(`'${key}' must contain only strings`);
      }
    }
  }
}

export function migrateFilesConfig(v1: FilesConfigV1): FilesConfig {
  const codePaths: string[] = [];
  const inputDocuments: string[] = [];
  const testPaths: string[] = [];

  for (const f of v1.files) {
    const lower = f.toLowerCase();
    if (f.endsWith("/")) {
      if (looksLikeTestPath(f)) {
        testPaths.push(f);
      } else {
        codePaths.push(f);
      }
    } else if (lower.startsWith("doc/") || lower.startsWith("docs/")) {
      inputDocuments.push(f);
    } else if (looksLikeTestPath(f)) {
      testPaths.push(f);
    } else {
      inputDocuments.push(f);
    }
  }

  return {
    version: 2,
    codePaths,
    inputDocuments,
    testPaths,
    excludedPaths: [...DEFAULT_EXCLUDED_PATHS],
  };
}
