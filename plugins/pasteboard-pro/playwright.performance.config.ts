import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests/performance",
  outputDir: "./artifacts/virtual-timeline/results",
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "artifacts/virtual-timeline/report.json" }]],
  use: {
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    baseURL: "http://127.0.0.1:5187",
    viewport: { width: 1200, height: 800 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node apps/ztools/node_modules/vite/bin/vite.js apps/ztools --config apps/ztools/vite.config.ts --host 127.0.0.1 --port 5187",
    url: "http://127.0.0.1:5187",
    reuseExistingServer: false,
  },
});
