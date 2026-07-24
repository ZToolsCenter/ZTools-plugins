import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const distDir = join(rootDir, "dist");
const filesToCopy = [
  "index.html",
  "index.css",
  "index.js",
  "plugin.json",
  "preload.js",
  "logo.jpg"
];

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

mkdirSync(distDir, { recursive: true });

for (const file of filesToCopy) {
  cpSync(join(rootDir, file), join(distDir, file), { recursive: true });
}

console.log(`Built plugin package in ${distDir}`);
