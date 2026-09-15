import { defineConfig } from 'vite'

export default defineConfig({
  // ZTools 从 file:// 或 ASAR 内加载 index.html，产物必须使用相对资源路径。
  base: './',
  build: {
    target: 'chrome146'
  }
})
