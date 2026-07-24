import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const finalizeDist = () => ({
  name: 'finalize-dist',
  closeBundle() {
    const readmePath = resolve(__dirname, 'README.md')
    const distPath = resolve(__dirname, 'dist')

    if (existsSync(readmePath)) {
      mkdirSync(distPath, { recursive: true })
      copyFileSync(readmePath, resolve(distPath, 'README.md'))
    }

    const pluginPath = resolve(distPath, 'plugin.json')
    if (existsSync(pluginPath)) {
      const pluginConfig = JSON.parse(readFileSync(pluginPath, 'utf-8'))
      pluginConfig.main = 'index.html'
      writeFileSync(pluginPath, `${JSON.stringify(pluginConfig, null, 2)}\n`)
    }
  }
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), finalizeDist()],
  base: './'
})
