import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const imgModules = path.join(root, "dist", "preload", "node_modules", "@img");
const manifest = JSON.parse(await fs.readFile(path.join(root, "dist", "plugin.json"), "utf8"));
const requiredPackages = [
  "sharp-darwin-arm64",
  "sharp-libvips-darwin-arm64",
  "sharp-darwin-x64",
  "sharp-libvips-darwin-x64"
];

const missing = [];
for (const packageName of requiredPackages) {
  try {
    await fs.access(path.join(imgModules, packageName));
  } catch {
    missing.push(packageName);
  }
}

if (missing.length > 0) {
  throw new Error(`Missing macOS sharp runtime packages: ${missing.join(", ")}`);
}

if (manifest.unpack !== "*.dylib") {
  throw new Error("plugin.json must unpack Sharp's libvips dylibs for ZTools 3.0.1 ASAR installs");
}

console.log(JSON.stringify({ ok: true, packages: requiredPackages, unpack: manifest.unpack }, null, 2));
