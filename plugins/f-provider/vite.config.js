import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
//
// 多页入口：
//   - index.html              主窗口（设置/识别/翻译/截图识别触发器）
//   - screen-ocr-result.html  截图识别结果展示窗口（由 ztools.createBrowserWindow 打开，
//                             纯展示：左图右文，不带 preload，不调 window.ztools API）
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5179
  },
  build: {
    // dist/ 内含手动放置的 native/（.node 原生模块，运行中的 ZTools 会加载并锁定）
    // 与 preload/，不能被 emptyOutDir 清空，否则构建时会因文件被占用而失败。
    // Vite 仍会覆盖它自己产出的 html / assets，无需清空整个目录。
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        screenOcrResult: resolve(__dirname, 'screen-ocr-result.html')
      }
    }
  }
})
