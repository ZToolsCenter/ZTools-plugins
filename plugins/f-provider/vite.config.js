import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
//
// 单页入口：
//   - index.html 主窗口（设置 / OCR 识别 / 翻译 / 代码翻译）
//     截图识别（screen-ocr / screen-latex）也在此主窗口内完成：进入即自动截屏，
//     识别结果在主窗口左右分栏展示，不再开独立结果窗口。
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
        main: resolve(__dirname, 'index.html')
      }
    }
  }
})
