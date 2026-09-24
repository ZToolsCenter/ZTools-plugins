import { defineConfig } from '@playwright/test'

const hostDevelopmentRoot = process.env.ZTOOLS_E2E_APP_ROOT || ''
const webServer = [
  {
    command: 'npm exec vite -- --host 127.0.0.1 --port 15240 --strictPort',
    url: 'http://127.0.0.1:15240',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  {
    command: 'node tests/e2e/reasoning-mock-server.mjs',
    url: 'http://127.0.0.1:15241/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
]

if (hostDevelopmentRoot) {
  webServer.push({
    command: `pnpm --dir ${JSON.stringify(`${hostDevelopmentRoot}/internal-plugins/setting`)} exec vite --host 127.0.0.1 --port 15177 --strictPort`,
    url: 'http://127.0.0.1:15177',
    reuseExistingServer: false,
    timeout: 120_000,
  })
}

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  webServer,
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
