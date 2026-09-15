import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 使用相对资源路径，保证构建产物可从 ZTools 本地插件目录直接加载。
  base: './'
})
