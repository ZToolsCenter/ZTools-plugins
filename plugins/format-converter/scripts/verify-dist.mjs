import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const failures = [];

async function requireFile(relativePath) {
  try {
    const stat = await fs.stat(path.join(dist, relativePath));
    if (!stat.isFile() || stat.size === 0) failures.push(`${relativePath} is empty`);
  } catch { failures.push(`${relativePath} is missing`); }
}

const required = [
  "index.html", "plugin.json", "logo.svg", "README.md", "CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md",
  "preload/services.cjs", "preload/capture-temp-store.cjs", "preload/format-registry.cjs", "preload/path-policy.cjs", "preload/runtime-probe.cjs",
  "preload/conversion-engine.cjs", "preload/job-manager.cjs", "preload/engine-utils.cjs", "preload/text-converter.cjs",
  "preload/image-converter.cjs", "preload/pdf-converter.cjs", "preload/office-converter.cjs", "preload/officecli-installer.cjs",
  "preload/runtime-loader.cjs", "preload/runtime-installer.cjs", "preload/runtime-manifest.json",
  "preload/node_modules/iconv-lite/package.json"
];
await Promise.all(required.map(requireFile));

let manifest;
try { manifest = JSON.parse(await fs.readFile(path.join(dist, "plugin.json"), "utf8")); }
catch (error) { failures.push(`plugin.json invalid: ${error.message}`); }
if (manifest) {
  if (manifest.name !== "format-converter") failures.push("unexpected plugin name");
  if (manifest.main !== "index.html") failures.push("main must be index.html");
  if (manifest.preload !== "preload/services.cjs") failures.push("preload path is invalid");
  if (manifest.development !== undefined) failures.push("release manifest contains development config");
  if (manifest.pluginSetting?.backgroundRunning !== true) failures.push("backgroundRunning must be true");
  for (const tool of ["format_conversion_plan", "format_conversion_execute", "format_conversion_job"]) if (!manifest.tools?.[tool]) failures.push(`missing MCP tool ${tool}`);
}

const preloadFiles = (await fs.readdir(path.join(root, "preload"))).filter(file => file.endsWith(".cjs"));
for (const file of preloadFiles) {
  const source = await fs.readFile(path.join(root, "preload", file), "utf8");
  const packaged = await fs.readFile(path.join(dist, "preload", file), "utf8").catch(() => "");
  if (source !== packaged) failures.push(`preload/${file} is stale`);
  try { execFileSync(process.execPath, ["--check", path.join(dist, "preload", file)], { stdio: "pipe" }); }
  catch { failures.push(`preload/${file} does not parse`); }
}

try {
  execFileSync(process.execPath, ["-e", "require('iconv-lite');require('./services.cjs')"], { cwd: path.join(dist, "preload"), stdio: "pipe" });
} catch (error) { failures.push(`preload runtime cannot load: ${error.stderr?.toString().trim() || error.message}`); }

async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    total += entry.isDirectory() ? await directoryBytes(absolute) : (await fs.stat(absolute)).size;
  }
  return total;
}
const distBytes = await directoryBytes(dist);
if (distBytes >= 15 * 1024 ** 2) failures.push(`release payload is ${(distBytes / 1024 ** 2).toFixed(2)} MB; EdgeOne limit is below 15 MB`);
for (const forbidden of ["sharp", "pdfjs-dist", "pdf-lib", "tesseract.js", "exceljs", "@img", "@napi-rs"]) {
  try { await fs.access(path.join(dist, "preload", "node_modules", forbidden)); failures.push(`heavy runtime must be installed on demand: ${forbidden}`); } catch {}
}

if (failures.length) {
  failures.forEach(failure => console.error(`✗ ${failure}`));
  process.exitCode = 1;
} else console.log(`✓ format-converter release verified (${(distBytes / 1024 ** 2).toFixed(2)} MB, heavy engines install on demand)`);
