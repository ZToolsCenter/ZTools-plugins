import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Vitest 独立配置：与 vite.config.js 保持一致的 '@' alias，
// 测试运行在 node 环境（被测的 mcpOperations 为纯逻辑，不依赖 DOM/fabric）。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts']
  }
})
