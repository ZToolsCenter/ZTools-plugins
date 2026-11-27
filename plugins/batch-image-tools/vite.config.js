import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { copyPublicAssets } from './scripts/copy-public.mjs'

function copyPluginPublicAssets() {
  return {
    name: 'copy-plugin-public-assets',
    closeBundle() {
      copyPublicAssets('public', 'dist')
    }
  }
}

export default defineConfig({
  plugins: [react(), copyPluginPublicAssets()],
  build: {
    outDir: 'dist',
    copyPublicDir: false,
    emptyOutDir: true
  },
  base: './'
})
