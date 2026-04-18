import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'copy-sqljs',
      closeBundle() {
        // vite build 可能清理了 dist/preload/vendor/，需要重新复制 sql.js 资源
        const root = __dirname
        const src = resolve(root, 'node_modules', 'sql.js')
        const dest = resolve(root, 'dist', 'preload', 'vendor', 'sqljs')
        const files = ['package.json', 'dist/sql-wasm.js', 'dist/sql-wasm.wasm']
        for (const f of files) {
          const srcPath = resolve(src, f)
          const destPath = resolve(dest, f.replace(/^dist\//, 'dist/'))
          fs.mkdirSync(dirname(destPath), { recursive: true })
          fs.copyFileSync(srcPath, destPath)
        }

        // 复制 README.md 到 dist
        const readmeSrc = resolve(root, 'README.md')
        const readmeDest = resolve(root, 'dist', 'README.md')
        if (fs.existsSync(readmeSrc)) {
          fs.copyFileSync(readmeSrc, readmeDest)
        }
      },
    },
  ],
  base: './',
  build: {
    rollupOptions: {
      output: {
        // 确保 sql.js WASM 文件被正确打包
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.wasm')) {
            return 'assets/[name]-[hash][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
