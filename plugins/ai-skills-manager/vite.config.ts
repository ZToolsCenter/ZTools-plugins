import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './', // 这里的 relative path 使得 ZTools 能够通过相对路径寻找资源文件
})
