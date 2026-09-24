import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

// 多页入口：
//   - index.html   主窗口（编排：截屏 / 图片入口 / 文本翻译）
//   - result.html  结果展示窗口（由 ztools.createBrowserWindow 打开，
//                  纯展示：左图右文对照，不带 preload，不调 window.ztools API）
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5180
  },
  // 管线单测：驱动真实 ocrTranslate，stub window.ztools.ocr/translate
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  },
  build: {
    // dist/ 内含手动放置的 preload/，不能被 emptyOutDir 清空。
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        result: resolve(__dirname, 'result.html'),
        board: resolve(__dirname, 'board.html')
      }
    }
  }
})
