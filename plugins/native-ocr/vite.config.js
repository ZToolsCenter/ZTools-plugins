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
      // 注：KaTeX 字体由 Vite 自动从 node_modules 打包进 dist/assets（含 fingerprint），
      // 无需再手动拷贝一份，避免包体翻倍。
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
