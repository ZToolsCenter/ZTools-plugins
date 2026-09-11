import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lock = JSON.parse(await fs.readFile(path.join(root, "package-lock.json"), "utf8"));
const packages = lock.packages || {};
const GROUPS = Object.freeze({
  sharp: { label: "图片引擎", estimateMb: 18, roots: ["sharp"] },
  pdf: { label: "PDF 引擎", estimateMb: 12, roots: ["pdfjs-dist", "pdf-lib"], exclude: ["canvas", "path2d-polyfill"] },
  ocr: { label: "OCR", estimateMb: 35, roots: ["tesseract.js", "@tesseract.js-data/eng", "@tesseract.js-data/chi_sim"] },
  excel: { label: "Excel 引擎", estimateMb: 8, roots: ["exceljs"] }
});

function rootKey(name) { return `node_modules/${name}`; }
function resolveDependency(fromKey, dependency) {
  let cursor = fromKey;
  while (cursor) {
    const nested = `${cursor}/node_modules/${dependency}`;
    if (packages[nested]) return nested;
    const marker = cursor.lastIndexOf("/node_modules/");
    cursor = marker >= 0 ? cursor.slice(0, marker) : "";
  }
  return packages[rootKey(dependency)] ? rootKey(dependency) : null;
}

function closure(roots, excluded = []) {
  const blocked = new Set(excluded);
  const seen = new Set();
  const pending = roots.map(rootKey);
  while (pending.length) {
    const key = pending.pop();
    if (seen.has(key)) continue;
    const entry = packages[key];
    if (!entry) throw new Error(`runtime dependency missing from lockfile: ${key}`);
    if (!entry.resolved || !entry.integrity) throw new Error(`runtime dependency is not immutable: ${key}`);
    seen.add(key);
    for (const dependency of Object.keys({ ...(entry.dependencies || {}), ...(entry.optionalDependencies || {}) })) {
      if (blocked.has(dependency) || dependency.startsWith("@types/")) continue;
      const resolved = resolveDependency(key, dependency);
      if (resolved) pending.push(resolved);
    }
  }
  return [...seen].sort();
}

const used = new Set();
const outputGroups = {};
for (const [id, group] of Object.entries(GROUPS)) {
  const keys = closure(group.roots, group.exclude);
  keys.forEach(key => used.add(key));
  outputGroups[id] = { label: group.label, estimateMb: group.estimateMb, roots: group.roots, packages: keys };
}

const outputPackages = {};
for (const key of [...used].sort()) {
  const entry = packages[key];
  const official = entry.resolved.replace("https://registry.npmmirror.com/", "https://registry.npmjs.org/");
  outputPackages[key] = {
    version: entry.version,
    integrity: entry.integrity,
    urls: [...new Set([entry.resolved, official])],
    ...(entry.os ? { os: entry.os } : {}),
    ...(entry.cpu ? { cpu: entry.cpu } : {}),
    ...(entry.libc ? { libc: entry.libc } : {})
  };
}

const manifest = { schemaVersion: 1, runtimeVersion: "0.1.0", groups: outputGroups, packages: outputPackages };
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
const outputPath = path.join(root, "preload", "runtime-manifest.json");
if (process.argv.includes("--check")) {
  const current = await fs.readFile(outputPath, "utf8").catch(() => "");
  if (current !== serialized) throw new Error("preload/runtime-manifest.json is stale; run npm run runtime:manifest");
} else await fs.writeFile(outputPath, serialized);
