import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const distDir = join(rootDir, "dist");

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
  console.log(`Removed ${distDir}`);
}
