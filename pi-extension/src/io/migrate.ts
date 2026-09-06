import fs from "node:fs";
import path from "node:path";

/**
 * Migrate legacy Orchestra directories to Senai directories.
 * Only runs when the legacy directory exists and the new one does not,
 * so existing projects keep working after the rename.
 */
export function migrateLegacyOrchestraDirs(cwd: string): string[] {
  const moved: string[] = [];

  const migrations: Array<{ legacy: string[]; target: string[] }> = [
    { legacy: [".IDE_Plans", "orchestra"], target: [".IDE_Plans", "pi-senai"] },
    { legacy: [".pi", "orchestra"], target: [".pi", "senai"] },
  ];

  for (const { legacy, target } of migrations) {
    const legacyDir = path.join(cwd, ...legacy);
    const targetDir = path.join(cwd, ...target);

    if (!fs.existsSync(legacyDir)) continue;
    if (fs.existsSync(targetDir)) continue;

    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(legacyDir, targetDir);
    moved.push(path.relative(cwd, targetDir));
  }

  return moved;
}
