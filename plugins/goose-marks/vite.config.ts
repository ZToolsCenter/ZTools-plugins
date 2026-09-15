import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import UnoCSS from '@unocss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { debugSourcemap, debugMinify } from './vite.debug'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  base: './',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  plugins: [
    UnoCSS(),
    react()
  ],
  server: {
    port: 7001,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    // uTools 7.8.0 内核为 Chromium 108；显式锁定 JS/CSS 转译目标，避免 Vite 8 默认 Chrome 111 产物。
    target: 'chrome108',
    cssTarget: 'chrome108',
    // 禁用 modulePreload 避免 uTools 环境中的警告
    modulePreload: false,
    // sourcemap / minify 策略由 vite.debug 决定（GOOSE_DEBUG=1 调试构建带 map 且不压缩；
    // 正式构建走 'hidden'+scripts/utools-build 删除 map）。
    sourcemap: debugSourcemap,
    minify: debugMinify,
    rolldownOptions: {
      output: {
        // Vite 8 底层为 rolldown：manualChunks 静默失效，必须用 codeSplitting.groups。
        // 用正则 test + 降序 priority（高者先匹配，命中后该模块从其余组移除）；
        // 路径分隔符用 [\\/] 兼容 Windows（rolldown 官方建议，见 memory）。
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 50,
              minSize: 0
            },
            {
              // HeroUI v3 及其底层 react-aria / react-stately 全家桶。
              name: 'vendor-heroui',
              test: /[\\/]node_modules[\\/](@heroui[\\/]|@react-aria[\\/]|@react-stately[\\/]|@react-types[\\/]|react-aria|react-stately|tailwind-variants[\\/])/,
              priority: 40,
              minSize: 0
            },
            {
              // AI SDK（懒加载，仅在自定义 AI 调用时拉取）独立成块，不进启动包。
              name: 'vendor-ai-sdk',
              test: /[\\/]node_modules[\\/](@ai-sdk[\\/]|ai[\\/]|@opentelemetry[\\/]|zod[\\/]|@standard-schema[\\/])/,
              priority: 35,
              minSize: 0
            },
            {
              name: 'vendor-icons',
              test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
              priority: 30,
              minSize: 0
            },
            {
              name: 'vendor-state',
              test: /[\\/]node_modules[\\/]zustand[\\/]/,
              priority: 25,
              minSize: 0
            },
            {
              // 兜底：其余第三方依赖统一进 vendor，便于长期缓存且避免散碎 chunk。
              name: 'vendor',
              test: /[\\/]node_modules[\\/]/,
              priority: 10,
              minSize: 0
            }
          ]
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
})
