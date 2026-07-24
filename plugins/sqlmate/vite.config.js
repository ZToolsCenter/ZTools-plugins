import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'fs'
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// 构建完成后把 README.md 复制到 dist/
function copyReadme() {
  return {
    name: 'copy-readme',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, 'README.md'),
        resolve(__dirname, 'dist/README.md')
      )
    }
  }
}

// 构建完成后从 dist/plugin.json 中移除 development 字段
// development 字段仅用于本地开发（dev server），发布版本不应包含
function stripDevConfig() {
  return {
    name: 'strip-dev-config',
    closeBundle() {
      const pluginJsonPath = resolve(__dirname, 'dist/plugin.json')
      const config = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'))
      delete config.development
      writeFileSync(pluginJsonPath, JSON.stringify(config, null, 2), 'utf-8')

      // 删除 dist/preload/node_modules —— ZTools 市场不分发 node_modules，
      // xlsx 等依赖已内联到 lib/ 目录下
      const distNodeModules = resolve(__dirname, 'dist/preload/node_modules')
      rmSync(distNodeModules, { recursive: true, force: true })
      // 删除 package-lock.json（发布不需要）
      rmSync(resolve(__dirname, 'dist/preload/package-lock.json'), { force: true })
      // 保留 package.json（声明 "type": "commonjs"，preload 层必须用 CJS）
      // 但清理其中的 dependencies 字段
      const preloadPkgPath = resolve(__dirname, 'dist/preload/package.json')
      if (fs.existsSync(preloadPkgPath)) {
        const pkg = JSON.parse(readFileSync(preloadPkgPath, 'utf-8'))
        delete pkg.dependencies
        writeFileSync(preloadPkgPath, JSON.stringify(pkg, null, 2), 'utf-8')
      } else {
        // preload/package.json 不存在时主动创建（声明 CJS 模式）
        writeFileSync(preloadPkgPath, JSON.stringify({ type: 'commonjs' }, null, 2), 'utf-8')
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), copyReadme(), stripDevConfig()],
  base: './'
})
