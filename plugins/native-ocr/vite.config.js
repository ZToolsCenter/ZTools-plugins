import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// KaTeX 字体只保留 woff2：Electron/Chromium 只会用到 woff2（assets/*.css 里 @font-face
// 的 src 顺序是 woff2 在前，.woff / .ttf 永远取不到），删掉后两者省约 860KB。
// 陷阱：KaTeX_Main-Regular-<hash>.woff2 也以 ".woff" 为前缀，必须用 endsWith 判尾，
// 用 includes 会把 woff2 一起删掉、公式渲染直接崩。
function pruneUnusedKatexFonts(assetsDir) {
  if (!existsSync(assetsDir)) return
  let removed = 0
  let freedBytes = 0
  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith('.woff') && !name.endsWith('.ttf')) continue
    const file = join(assetsDir, name)
    try {
      const size = statSync(file).size
      rmSync(file, { force: true })
      removed += 1
      freedBytes += size
    } catch (_) {
      // 单个文件删除失败不中断构建
    }
  }
  console.log(`[copy-extras] 字体裁剪：删除 ${removed} 个 .woff/.ttf，释放 ${(freedBytes / 1024).toFixed(1)} KB`)
}

function copyExtras() {
  // 跟随 build.outDir，避免配置了 --outDir 时把附件复制到别处（也便于独立验证字体裁剪）。
  let outDir = resolve('dist')
  return {
    name: 'copy-extras',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      copyFileSync(resolve('README.md'), join(outDir, 'README.md'))
      if (existsSync(resolve('LICENSE'))) {
        copyFileSync(resolve('LICENSE'), join(outDir, 'LICENSE'))
      }
      const binSrc = resolve('bin')
      const binDest = join(outDir, 'bin')
      if (existsSync(binSrc)) {
        cpSync(binSrc, binDest, { recursive: true })
      }
      // 注：KaTeX 字体由 Vite 自动从 node_modules 打包进 out/assets（含 fingerprint），
      // 无需再手动拷贝一份，避免包体翻倍。
      pruneUnusedKatexFonts(join(outDir, 'assets'))
    }
  }
}

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    copyExtras()
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
