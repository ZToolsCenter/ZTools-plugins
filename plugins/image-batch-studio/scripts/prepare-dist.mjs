import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const preloadDir = path.join(dist, "preload");
const sharedDir = path.join(dist, "shared");
const runtimeDir = path.join(root, "scripts", "runtime");
const runtimeConfig = JSON.parse(
  await fs.readFile(path.join(root, "scripts", "sharp-runtime-targets.json"), "utf8")
);
const runtimePackage = JSON.parse(await fs.readFile(path.join(runtimeDir, "package.json"), "utf8"));
const runtimeDependencies = runtimePackage.dependencies;
if (runtimeDependencies.sharp !== runtimeConfig.sharpVersion) {
  throw new Error("Sharp runtime version must match scripts/sharp-runtime-targets.json");
}
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function npmCi(directory) {
  execFileSync(npmCommand, [
    "ci",
    "--omit=dev",
    "--omit=optional",
    "--no-audit",
    "--no-fund"
  ], {
    cwd: directory,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}

async function copyRuntimeManifest(directory) {
  await fs.copyFile(path.join(runtimeDir, "package.json"), path.join(directory, "package.json"));
  await fs.copyFile(path.join(runtimeDir, "package-lock.json"), path.join(directory, "package-lock.json"));
}

await fs.mkdir(preloadDir, { recursive: true });
await fs.mkdir(sharedDir, { recursive: true });
const pluginConfig = JSON.parse(await fs.readFile(path.join(root, "plugin.json"), "utf8"));
delete pluginConfig.development;
await fs.writeFile(path.join(dist, "plugin.json"), `${JSON.stringify(pluginConfig, null, 2)}\n`);
await fs.copyFile(path.join(root, "logo.svg"), path.join(dist, "logo.svg"));
await fs.copyFile(path.join(root, "cover.png"), path.join(dist, "cover.png"));
await copyRuntimeManifest(preloadDir);
await fs.copyFile(
  path.join(root, "scripts", "sharp-runtime-targets.json"),
  path.join(preloadDir, "sharp-runtime-targets.json")
);
await fs.writeFile(path.join(sharedDir, "package.json"), '{"type":"commonjs"}\n');

npmCi(preloadDir);
