import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 让 dist/ 自包含：把插件元数据与宿主脚本一并拷进产物。
 *
 * 为什么必须有它：这 4 个文件不在 src/ 依赖图里，vite 不会自动带上。
 * 它们原本是靠仓库外的 build.cjs 在打 .zpx 时补进包的 —— 但**市场 CI 只跑
 * `npm run build`**（见 ZTools-plugins 的 build-plugins / detect-build-requirements），
 * 不会执行 build.cjs，产物就会缺 plugin.json / preload.js 而无法上架。
 *
 * 不能依赖 process.cwd()：本仓库是用 `vite build <root>` 从别的目录调用的，
 * cwd 不是仓库根。必须在 configResolved 里拿 vite 解析后的 root。
 */
const PLUGIN_ASSETS = ['plugin.json', 'preload.js', 'logo.png', 'README.md'];

function copyPluginAssets() {
  let rootDir = process.cwd();
  return {
    name: 'copy-plugin-assets',
    apply: 'build',
    configResolved(cfg) {
      rootDir = cfg.root;
    },
    closeBundle() {
      const outDir = path.resolve(rootDir, 'dist');
      for (const f of PLUGIN_ASSETS) {
        const src = path.join(rootDir, f);
        if (existsSync(src)) copyFileSync(src, path.join(outDir, f));
      }
    },
  };
}

// base: './' —— ZTools 以本地文件协议加载插件，资源必须走相对路径。
// 插件窗口宽度固定 800px，此处不做任何响应式假设，版式按窄窗口设计。
export default defineConfig({
  base: './',
  plugins: [vue(), copyPluginAssets()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    // 单文件内联：插件目录越扁平越好，避免 asar 内相对路径问题
    assetsInlineLimit: 8192,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2000,
  },
});
