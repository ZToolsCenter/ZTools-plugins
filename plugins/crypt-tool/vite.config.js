import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cpSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 将 preload 层 node_modules 复制到 dist，满足 ZTools 运行时 require 解析
function preloadNodeModulesPlugin() {
  return {
    name: 'copy-preload-node-modules',
    closeBundle() {
      const src = join(__dirname, 'public', 'preload', 'node_modules')
      const dest = join(__dirname, 'dist', 'preload', 'node_modules')
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true })
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), preloadNodeModulesPlugin()],
  base: './'
})
