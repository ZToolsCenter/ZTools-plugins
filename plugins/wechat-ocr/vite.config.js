import { fileURLToPath, URL } from 'node:url'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

function copyReadme() {
  return {
    name: 'copy-readme',
    closeBundle() {
      copyFileSync(resolve('README.md'), resolve('dist/README.md'))
    }
  }
}

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    copyReadme()
  ],
  base: './',
  server: {
    port: 5179
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
