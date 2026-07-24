import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyPluginAssets() {
  return {
    name: "copy-ztools-assets",
    closeBundle() {
      const root = process.cwd();
      const dist = path.join(root, "dist");
      for (const item of ["plugin.json", "preload.js", "logo.png"]) {
        copyRecursive(path.join(root, item), path.join(dist, item));
      }
    }
  };
}

export default defineConfig({
  plugins: [vue(), copyPluginAssets()],
  base: "./"
});
