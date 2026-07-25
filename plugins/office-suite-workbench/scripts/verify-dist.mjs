import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const failures = [];

async function requireFile(relativePath) {
  const absolutePath = path.join(dist, relativePath);
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile() || stat.size === 0) failures.push(`${relativePath} is empty or not a file`);
  } catch {
    failures.push(`${relativePath} is missing`);
  }
}

for (const file of [
  "index.html",
  "plugin.json",
  "logo.svg",
  "preload/services.cjs",
  "preload/officecli-runner.cjs",
  "preload/command-parser.cjs",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md"
]) {
  await requireFile(file);
}

let manifest;
try {
  manifest = JSON.parse(await fs.readFile(path.join(dist, "plugin.json"), "utf8"));
} catch (error) {
  failures.push(`plugin.json is not valid JSON: ${error.message}`);
}

if (manifest) {
  if (manifest.name !== "office-suite-workbench") failures.push("plugin.json has an unexpected name");
  if (manifest.main !== "index.html") failures.push("plugin.json main must point to index.html");
  if (manifest.preload !== "preload/services.cjs") failures.push("plugin.json preload path is incorrect");
  if (manifest.development !== undefined) failures.push("release plugin.json must not contain development settings");
  if (!manifest.tools?.office_document) failures.push("office_document tool declaration is missing");
  if (manifest.pluginSetting?.backgroundRunning !== true) failures.push("MCP plugin must enable backgroundRunning");
}

for (const file of ["services.cjs", "officecli-runner.cjs", "command-parser.cjs"]) {
  const source = await fs.readFile(path.join(root, "preload", file), "utf8");
  const packaged = await fs.readFile(path.join(dist, "preload", file), "utf8");
  if (source !== packaged) failures.push(`dist/preload/${file} is stale`);
  try {
    execFileSync(process.execPath, ["--check", path.join(dist, "preload", file)], { stdio: "pipe" });
  } catch {
    failures.push(`dist/preload/${file} does not parse as CommonJS`);
  }
}

try {
  await fs.access(path.join(dist, "node_modules"));
  failures.push("dist must not contain node_modules")
} catch {
  // Expected: the release preload has no third-party Node dependencies.
}

if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log("✓ dist manifest, assets, readable preload and license notices verified");
}
