import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import copy from 'rollup-plugin-copy'

function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true })
  }
}

export default defineConfig({
  plugins: [
    vue(),
    copy({
      targets: [
        { src: 'logo.svg', dest: 'dist/' },
        { src: 'preload.js', dest: 'dist/' },
        { src: 'plugin.json', dest: 'dist/' },
        { src: 'src/release_npm/node_modules', dest: 'dist/' }
      ],
      hook: 'writeBundle'
    }),
    {
      name: 'strip-native-only-deps',
      closeBundle() {
        // ssh2 ships optional native helpers we don't need; remove to shrink output
        ;[
          'dist/node_modules/cpu-features',
          'dist/node_modules/nan'
        ].forEach((d) => removeDir(path.resolve(__dirname, d)))
      }
    }
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
