import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// dist 是可直接导入 zTools 的完整插件目录。
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
