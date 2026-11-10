import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@renderer': fileURLToPath(new URL('./vendor/lx/src/renderer', import.meta.url)) } },
  base: './',
  build: {
    outDir: 'src-ztools/dist',
    emptyOutDir: true
  }
})
