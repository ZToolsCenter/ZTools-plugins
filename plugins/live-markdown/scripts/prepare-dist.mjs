import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyPreload } from "./release-files.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

if (!fs.existsSync(distDir)) {
  throw new Error("dist directory does not exist. Run `vite build` first.");
}

// 1. Rewrite dist/index.html so it loads via file:// without CORS errors in Chromium / Electron WebContentsView
const indexHtmlPath = path.join(distDir, "index.html");
if (fs.existsSync(indexHtmlPath)) {
  let html = fs.readFileSync(indexHtmlPath, "utf8");
  html = html
    .replace(/<script\s+type="module"\s+crossorigin\s+src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
    .replace(/<script\s+type="module"\s+src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
    .replace(/<link\s+rel="stylesheet"\s+crossorigin\s+href="([^"]+)">/g, '<link rel="stylesheet" href="$1">')
    .replace(/\scrossorigin(?:="[^"]*")?/g, "");
  fs.writeFileSync(indexHtmlPath, html, "utf8");
}

// 2. Wrap dist/assets/*.js in IIFE so classic <script defer> runs in isolated scope
const assetsDir = path.join(distDir, "assets");
if (fs.existsSync(assetsDir)) {
  for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      const jsPath = path.join(assetsDir, entry.name);
      const rawJs = fs.readFileSync(jsPath, "utf8");
      if (!rawJs.startsWith("(function(){")) {
        fs.writeFileSync(jsPath, `(function(){"use strict";\n${rawJs}\n})();\n`, "utf8");
      }
    }
  }
}

// 3. Generate release dist/plugin.json
const rawPluginJson = fs.readFileSync(path.join(rootDir, "plugin.json"), "utf8");
const pluginConfig = JSON.parse(rawPluginJson);
pluginConfig.main = "index.html";
delete pluginConfig.development;

fs.writeFileSync(
  path.join(distDir, "plugin.json"),
  `${JSON.stringify(pluginConfig, null, 2)}\n`,
  "utf8"
);

// 4. Copy static assets and readable preload/*.cjs
const staticFiles = ["logo.svg", "README.md", "CHANGELOG.md", "LICENSE", "NOTICE"];
for (const fileName of staticFiles) {
  const sourcePath = path.join(rootDir, fileName);
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, path.join(distDir, fileName));
  }
}

const preloadSrcDir = path.join(rootDir, "preload");
const preloadDistDir = path.join(distDir, "preload");
fs.mkdirSync(preloadDistDir, { recursive: true });

copyPreload(preloadSrcDir, preloadDistDir);

console.log("[prepare-dist] Packaged dist/ with file://-compatible index.html, release plugin.json, and readable preload/*.cjs.");
