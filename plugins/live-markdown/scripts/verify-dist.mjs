import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { inspectRelease, listFiles } from "./release-files.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const requiredFiles = [
  "index.html",
  "plugin.json",
  "logo.svg",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "preload/services.cjs",
  "preload/fs-workspace.cjs",
  "preload/exporter.cjs",
  "preload/webdav-sync.cjs"
];

for (const relativePath of requiredFiles) {
  const fullPath = path.join(distDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`[verify-dist] Missing required file in dist/: ${relativePath}`);
  }
}

const rootPluginConfig = JSON.parse(
  fs.readFileSync(path.join(rootDir, "plugin.json"), "utf8")
);

if ("development" in rootPluginConfig) {
  throw new Error(
    "[verify-dist] Root plugin.json must not contain a dead `development.main` server URL when loaded directly in ZTools developer tools."
  );
}

if (
  rootPluginConfig.main !== "dist/index.html" ||
  rootPluginConfig.preload !== "preload/services.cjs"
) {
  throw new Error(
    "[verify-dist] Root plugin.json must point main to dist/index.html and preload to preload/services.cjs."
  );
}

const distPluginConfig = JSON.parse(
  fs.readFileSync(path.join(distDir, "plugin.json"), "utf8")
);

if ("development" in distPluginConfig) {
  throw new Error("[verify-dist] dist/plugin.json must not contain the `development` field.");
}

if (distPluginConfig.main !== "index.html" || distPluginConfig.preload !== "preload/services.cjs") {
  throw new Error("[verify-dist] dist/plugin.json has unexpected main or preload paths.");
}

const preloadFiles = listFiles(path.join(rootDir, "preload")).map((file) => `preload/${file}`);

for (const relativePath of preloadFiles) {
  const srcContent = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  const distContent = fs.readFileSync(path.join(distDir, relativePath), "utf8");
  if (srcContent !== distContent) {
    throw new Error(`[verify-dist] Preload mismatch between source and dist: ${relativePath}`);
  }
  if (relativePath.endsWith(".cjs")) {
    execFileSync(process.execPath, ["--check", path.join(distDir, relativePath)], { stdio: "pipe" });
  } else if (relativePath.endsWith(".json")) JSON.parse(distContent);
}

if (fs.existsSync(path.join(distDir, "node_modules"))) {
  throw new Error("[verify-dist] dist/ must not contain node_modules.");
}

const distIndexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
if (distIndexHtml.includes('type="module"') || distIndexHtml.includes("crossorigin")) {
  throw new Error(
    "[verify-dist] dist/index.html must not contain type=\"module\" or crossorigin attributes, as they cause CORS failures over file:// protocol."
  );
}

const release = inspectRelease(distDir);
for (const relativePath of release.files.filter((file) => /^assets\/.*\.js$/.test(file))) {
  // The release deliberately uses classic scripts for file:// compatibility.
  // Parsing as a classic script catches module-only asset rewrites before UI tests.
  new Script(fs.readFileSync(path.join(distDir, relativePath), "utf8"), { filename: relativePath });
}
console.log(`[verify-dist] ${release.files.length} files, ${release.bytes} unpacked bytes; integrity and 15MB budget passed.`);
