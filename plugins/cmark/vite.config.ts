import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Windows 上 esbuild 偶发删不掉自己的临时文件：
//   [vite:esbuild-transpile] remove C:\Users\...\Temp\esbuild-xxxx: Access is denied
// 不是代码问题，是 %TEMP% 被占用 / 被杀软锁。把 TMP 指到项目内目录即稳定。
// 必须在 esbuild 子进程启动前设置，所以放在 config 顶层求值处。
if (process.platform === 'win32') {
  const tmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.tmp')
  try {
    fs.mkdirSync(tmp, { recursive: true })
    process.env.TMP = tmp
    process.env.TEMP = tmp
  } catch (e) {
    // 建不出来就沿用系统 TEMP，最坏情况是偶发构建失败
  }
}

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 输出目录必须叫 app，不能用 dist：
    // ZTools 发布 CLI 的 COPY_IGNORE_DIRS 会跳过 dist/build/node_modules，
    // 产物放进 dist 就拿不上去。市场要求构建产物随源码一起提交。
    outDir: 'app',
    emptyOutDir: true,
    target: 'chrome108',
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ['marked', 'katex', 'highlight.js', 'dompurify'],
          // 图表库体积大且只在含 mermaid / echarts 代码块时才需要，单独拆包按需加载
          mermaid: ['mermaid'],
          echarts: ['echarts'],
        },
      },
    },
  },
  server: { port: 5273 },
})
