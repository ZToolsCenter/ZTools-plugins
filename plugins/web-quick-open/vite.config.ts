import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

function copyReadmePlugin() {
  return {
    name: 'copy-readme',
    closeBundle() {
      const readmePath = resolve(__dirname, 'README.md')
      const distPath = resolve(__dirname, 'dist')
      if (!existsSync(readmePath)) return

      mkdirSync(distPath, { recursive: true })
      copyFileSync(readmePath, resolve(distPath, 'README.md'))
      copyFileSync(resolve(__dirname, 'CHANGELOG.md'), resolve(distPath, 'CHANGELOG.md'))
      const developmentPath = resolve(__dirname, 'docs/development.md')
      if (existsSync(developmentPath)) {
        mkdirSync(resolve(distPath, 'docs'), { recursive: true })
        copyFileSync(developmentPath, resolve(distPath, 'docs/development.md'))
      }
    }
  }
}

export default defineConfig({
  plugins: [vue(), copyReadmePlugin()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
