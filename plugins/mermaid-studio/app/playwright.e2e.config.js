import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright',
  // 插件页面内联了 4MB 资源，首次加载较慢，留足余量
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    // 不记录 trace：内联 4MB 页面会产生巨量事件，反而拖慢 Electron 导致超时
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
})
