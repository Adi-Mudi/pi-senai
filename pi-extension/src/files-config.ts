import * as fs from "node:fs";
import * as path from "node:path";

export const FILES_CONFIG_FILE = "files.json";

export interface FilesConfig {
  version: number;
  files: string[];
}

export function getFilesConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "orchestra", FILES_CONFIG_FILE);
}

export function loadFilesConfig(cwd: string): FilesConfig | null {
  const configPath = getFilesConfigPath(cwd);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as FilesConfig;
    validateFilesConfig(parsed);
    return parsed;
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
  if (typeof config.version !== "number") {
    throw new Error("Missing or invalid 'version' field");
  }
  if (!Array.isArray(config.files)) {
    throw new Error("Missing or invalid 'files' field");
  }
  for (const f of config.files) {
    if (typeof f !== "string") {
      throw new Error("'files' must contain only strings");
    }
  }
}
