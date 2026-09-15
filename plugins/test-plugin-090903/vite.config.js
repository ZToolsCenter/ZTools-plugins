import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./src-ztools/dist', import.meta.url)),
    emptyOutDir: true
  }
})
