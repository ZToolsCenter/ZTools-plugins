import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import UnoCSS from '@unocss/vite'
import { defineConfig } from 'vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { sites } from './build/sites-vite-plugin'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  plugins: [
    UnoCSS(),
    react(),
    sites(),
    cloudflare({
      config: {
        main: './worker/index.ts',
        compatibility_date: '2026-07-10'
      }
    })
  ],
  build: {
    modulePreload: false,
    chunkSizeWarningLimit: 600
  }
})
