import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// dist 是可直接导入和供官方 Action 打包的完整插件目录。
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
