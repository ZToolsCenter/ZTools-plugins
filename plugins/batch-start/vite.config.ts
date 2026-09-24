import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, build as viteBuild, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, 'src-ztools')

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]

/** Align with official CLI vue-vite template: UI → src-ztools/dist, preload → src-ztools/preload/services.js */
function ztoolsPluginBuild(): Plugin {
  return {
    name: 'ztools-plugin-build',
    async closeBundle() {
      const preloadDir = path.join(pluginRoot, 'preload')
      if (!existsSync(preloadDir)) {
        mkdirSync(preloadDir, { recursive: true })
      }

      await viteBuild({
        configFile: false,
        publicDir: false,
        build: {
          outDir: preloadDir,
          emptyOutDir: false,
          copyPublicDir: false,
          lib: {
            entry: path.resolve(__dirname, 'src/preload.ts'),
            formats: ['cjs'],
            fileName: () => 'services.js',
          },
          rollupOptions: {
            external: nodeExternals,
            output: {
              entryFileNames: 'services.js',
              format: 'cjs',
              exports: 'named',
            },
          },
        },
        logLevel: 'warn',
      })

      // remove accidental public assets if any
      const strayLogo = path.join(preloadDir, 'logo.png')
      if (existsSync(strayLogo)) {
        try {
          const { unlinkSync } = await import('node:fs')
          unlinkSync(strayLogo)
        } catch {
          // ignore
        }
      }

      const logoSrc = path.resolve(__dirname, 'public/logo.png')
      if (existsSync(logoSrc)) {
        copyFileSync(logoSrc, path.join(pluginRoot, 'logo.png'))
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), ztoolsPluginBuild()],
  // Required for ZTools file:// loading — absolute /assets/* will blank the page
  base: './',
  publicDir: 'public',
  build: {
    // Official CLI template outDir
    outDir: 'src-ztools/dist',
    emptyOutDir: true,
  },
})
