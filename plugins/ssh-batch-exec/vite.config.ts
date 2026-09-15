import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 构建后置处理：
 * 1. 复制 plugin.json / logo.png 到 dist（ZTools 识别插件必需）
 * 2. 把 public/node_modules（ssh2 等 CommonJS 依赖）复制为 dist/node_modules，
 *    保证 dist/preload.js 同级存在源码可读的 Node 依赖
 */
function copyPluginAssets(): Plugin {
  return {
    name: "copy-plugin-assets",
    closeBundle() {
      const root = path.dirname(fileURLToPath(import.meta.url));
      const dist = path.join(root, "dist");
      fs.copyFileSync(path.join(root, "plugin.json"), path.join(dist, "plugin.json"));
      fs.copyFileSync(path.join(root, "logo.png"), path.join(dist, "logo.png"));
      // 复制 CHANGELOG.md / README.md（发布校验需要 dist 内含有效更新日志）
      for (const f of ["CHANGELOG.md", "README.md"]) {
        const src = path.join(root, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, f));
      }

      const srcDeps = path.join(root, "public", "node_modules");
      const dstDeps = path.join(dist, "node_modules");
      if (fs.existsSync(srcDeps)) {
        fs.rmSync(dstDeps, { recursive: true, force: true });
        fs.cpSync(srcDeps, dstDeps, { recursive: true });
      } else {
        console.warn("[build] 未找到 public/node_modules，请先在 public 目录执行 npm install");
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [vue(), copyPluginAssets()],
});
