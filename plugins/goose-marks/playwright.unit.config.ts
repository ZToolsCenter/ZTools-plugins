import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/unit',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
})
