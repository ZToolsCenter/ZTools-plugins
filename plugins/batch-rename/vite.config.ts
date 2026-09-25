import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

const projectDirectory = fileURLToPath(new URL('.', import.meta.url))

function packagePlugin(): Plugin {
  return {
    name: 'package-ztools-plugin',
    closeBundle() {
      const projectRoot = projectDirectory
      const outputDirectory = resolve(projectRoot, 'dist')
      const pluginConfig = JSON.parse(
        readFileSync(resolve(projectRoot, 'plugin.json'), 'utf8')
      ) as Record<string, unknown>

      pluginConfig.main = 'index.html'
      delete pluginConfig.development

      mkdirSync(resolve(outputDirectory, 'preload'), { recursive: true })
      writeFileSync(
        resolve(outputDirectory, 'plugin.json'),
        `${JSON.stringify(pluginConfig, null, 2)}\n`,
        'utf8'
      )
      copyFileSync(resolve(projectRoot, 'logo.png'), resolve(outputDirectory, 'logo.png'))
      buildSync({
        entryPoints: [resolve(projectRoot, 'preload/services.js')],
        outfile: resolve(outputDirectory, 'preload/services.js'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node24'
      })
    }
  }
}

export default defineConfig({
  plugins: [vue(), packagePlugin()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
