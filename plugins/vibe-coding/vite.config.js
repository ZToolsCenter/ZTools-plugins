import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  optimizeDeps: {
    // Markdown 渲染器会延迟加载代码高亮和公式模块；启动时预构建可避免首次渲染触发整页刷新。
    include: [
      'katex',
      'highlight.js/lib/core',
      'highlight.js/lib/languages/bash',
      'highlight.js/lib/languages/c',
      'highlight.js/lib/languages/cpp',
      'highlight.js/lib/languages/css',
      'highlight.js/lib/languages/go',
      'highlight.js/lib/languages/java',
      'highlight.js/lib/languages/javascript',
      'highlight.js/lib/languages/json',
      'highlight.js/lib/languages/markdown',
      'highlight.js/lib/languages/php',
      'highlight.js/lib/languages/python',
      'highlight.js/lib/languages/ruby',
      'highlight.js/lib/languages/rust',
      'highlight.js/lib/languages/scss',
      'highlight.js/lib/languages/sql',
      'highlight.js/lib/languages/typescript',
      'highlight.js/lib/languages/xml',
      'highlight.js/lib/languages/yaml',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 15240,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
