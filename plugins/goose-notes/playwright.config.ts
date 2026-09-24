import { defineConfig } from "playwright/test";

const headedMode = process.env.PW_HEADED === "1";
const autoStartServer = process.env.E2E_AUTO_START === "1";
const browserChannel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  webServer: autoStartServer
    ? {
        // 本地跑 E2E 时自动启动 Vite，避免手动分两步执行。
        command: "bun run dev",
        url: "http://localhost:6001",
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "output/playwright/report",
        open: "never",
      },
    ],
  ],
  outputDir: "output/playwright/test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:6001",
    channel: browserChannel,
    // 默认无头执行，配合 PW_HEADED=1 可切到可视化浏览器调试。
    headless: !headedMode,
    viewport: {
      width: 1440,
      height: 900,
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
