import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

function copyExtras() {
  return {
    name: 'copy-extras',
    closeBundle() {
      copyFileSync(resolve('README.md'), resolve('dist/README.md'))
      if (existsSync(resolve('LICENSE'))) {
        copyFileSync(resolve('LICENSE'), resolve('dist/LICENSE'))
      }
      const binSrc = resolve('bin')
      const binDest = resolve('dist/bin')
      if (existsSync(binSrc)) {
        cpSync(binSrc, binDest, { recursive: true })
      }
    }
  }
}

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    copyExtras()
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
