import { defineConfig } from "vite";
import { resolve } from "node:path";

const coreRoot = resolve(__dirname, "packages/core");

// GOOSE_DEBUG=1 时进入可调试构建：保留未压缩源码 + sourcemap，
// 方便在 uTools 开发者工具和浏览器 mock 里看到 packages/core/src/ 原始路径。
// 不设置（正式发布）则压缩 + 不产 sourcemap，保持产物精简、离线包整洁。
const isDebug = process.env.GOOSE_DEBUG === "1";

// 浏览器仅用于开发 mock；发布产物只供 uTools 加载。
// uTools 插件以 file:// 加载，不允许引用任何网络 JS/CSS（发布时会被拒）。
// 此插件在 utools 构建模式下从 HTML 中删除所有 Google Fonts <link> 标签。
function stripExternalFonts() {
  return {
    name: "strip-external-fonts",
    transformIndexHtml(html) {
      return html
        .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>\s*/g, "")
        .replace(/<link[^>]+fonts\.gstatic\.com[^>]*>\s*/g, "");
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: coreRoot,
  // uTools 插件用 file:// 加载，必须相对路径。
  base: mode === "utools" ? "./" : "/",
  plugins: mode === "utools" ? [stripExternalFonts()] : [],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    // 对齐 uTools Electron 22 / Chromium 108。
    target: "es2020",
    // 可调试构建产出 sourcemap；正式发布关闭，保持离线包整洁。
    sourcemap: isDebug,
    // 可调试构建关闭压缩，开发者工具里直接读未混淆源码。
    minify: isDebug ? false : "esbuild",
    rollupOptions: {
      input: { index: resolve(coreRoot, "index.html") },
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: false,
    host: "127.0.0.1",
  },
}));
