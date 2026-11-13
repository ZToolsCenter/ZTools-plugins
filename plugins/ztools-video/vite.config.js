import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { videoPreview } from './dev/preview.js'

const host = '127.0.0.1'
const port = 15182
export default defineConfig({
  plugins: [vue(), videoPreview(`http://${host}:${port}`)],
  base: './',
  server: { host, port, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./src-ztools/dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        player: fileURLToPath(new URL('./player.html', import.meta.url)),
      },
    },
  },
})
