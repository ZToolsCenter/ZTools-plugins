import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // ZTools 用 file:// 加载页面，多文件 ESM 分块会被 CORS 拦截，
    // 因此把 JS/CSS 全部内联进 index.html，保证离线可用。
    viteSingleFile({ removeViteModuleLoader: true })
  ],
  // 插件页面通过 file:// 加载，必须使用相对路径
  base: './',
  build: {
    // 插件根目录（plugin.json 所在目录）在上一级，
    // 注意：ztools publish 复制文件时会跳过任何名为 dist/build 的目录，
    // 而构建产物就是插件页面本身，必须随插件发布，因此输出到根目录的 web/。
    outDir: fileURLToPath(new URL('../web', import.meta.url)),
    emptyOutDir: true,
    // Mermaid 体积较大，关闭 chunk 体积告警
    chunkSizeWarningLimit: 8192,
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    // Mermaid 内部大量动态 import，必须全部打成单块
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
