import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  outputDir: "./artifacts/pasteboardpro/playwright-results",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "artifacts/pasteboardpro/playwright-report.json" }]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @pasteboard-pro/ztools dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5179/?visual=1&shelf=1",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @pasteboard-pro/atools dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5180/?visual=1",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
