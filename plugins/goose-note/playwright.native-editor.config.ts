import { defineConfig } from "playwright/test";

const port = Number(process.env.NATIVE_EDITOR_TEST_PORT ?? 6012);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/native-editor-e2e",
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  webServer: {
    command: `node scripts/serve-native-editor.mjs ${port}`,
    url: `${baseURL}/index.html`,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
  reporter: [["list"]],
  outputDir: "output/playwright/native-editor-test-results",
  use: {
    baseURL,
    headless: process.env.PW_HEADED !== "1",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
