import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const preloadEntry = path.resolve(rootDir, 'public', 'preload', 'services.js')
const preloadSourcePattern = /[\\/]public[\\/]preload[\\/]/

export default defineConfig({
  publicDir: false,
  build: {
    target: 'es2020',
    outDir: path.resolve(rootDir, 'dist', 'preload'),
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: preloadEntry,
      formats: ['cjs'],
      fileName: () => 'services.js',
    },
    commonjsOptions: {
      include: [preloadSourcePattern, /node_modules/],
      transformMixedEsModules: true,
    },
  },
})
