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
        const root = __dirname

        // 复制 sql.js 完整模块到 dist/preload/node_modules/sql.js
        // esbuild 保留了 require('sql.js')，需要确保模块可用
        const sqlSrc = resolve(root, 'node_modules', 'sql.js')
        const sqlDest = resolve(root, 'dist', 'preload', 'node_modules', 'sql.js')
        if (fs.existsSync(sqlSrc)) {
          // 先清空目标目录
          function emptyDir(dir) {
            if (fs.existsSync(dir)) {
              fs.readdirSync(dir).forEach((f) => {
                const path = resolve(dir, f)
                fs.statSync(path).isDirectory() ? fs.rmSync(path, { recursive: true }) : fs.unlinkSync(path)
              })
            } else {
              fs.mkdirSync(dir, { recursive: true })
            }
          }
          emptyDir(sqlDest)
          // 递归复制
          function copyRecursive(src, dst) {
            const stat = fs.statSync(src)
            if (stat.isFile()) {
              fs.mkdirSync(dirname(dst), { recursive: true })
              fs.copyFileSync(src, dst)
            } else if (stat.isDirectory()) {
              fs.mkdirSync(dst, { recursive: true })
              fs.readdirSync(src).forEach((f) => copyRecursive(resolve(src, f), resolve(dst, f)))
            }
          }
          copyRecursive(sqlSrc, sqlDest)
          console.log('[copy-sqljs] sql.js module -> dist/preload/node_modules/sql.js')
        }

        // 复制 wasm 兜底资源
        const vendorSrc = resolve(root, 'node_modules', 'sql.js')
        const vendorDest = resolve(root, 'dist', 'preload', 'vendor', 'sqljs')
        const wasmFiles = ['dist/sql-wasm.js', 'dist/sql-wasm.wasm']
        for (const f of wasmFiles) {
          const srcPath = resolve(vendorSrc, f)
          const destPath = resolve(vendorDest, f.replace(/^dist\//, 'dist/'))
          if (fs.existsSync(srcPath)) {
            fs.mkdirSync(dirname(destPath), { recursive: true })
            fs.copyFileSync(srcPath, destPath)
          }
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
