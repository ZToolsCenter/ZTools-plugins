import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    target: 'chrome120',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        capture: fileURLToPath(new URL('capture.html', import.meta.url)),
        pin: fileURLToPath(new URL('pin.html', import.meta.url))
      }
    }
  }
})