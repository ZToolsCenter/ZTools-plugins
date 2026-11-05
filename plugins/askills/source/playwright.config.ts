import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.ASKILLS_UI_BASE_URL || "http://localhost:1420";
const channel =
  process.env.ASKILLS_UI_BROWSER_CHANNEL ||
  (process.platform === "win32" ? "msedge" : undefined);

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    channel,
    baseURL,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      process.env.ASKILLS_UI_SERVER_COMMAND || "pnpm dev --host localhost",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
