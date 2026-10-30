import { resolve } from "node:path";
import { defineConfig } from "playwright/test";
export default defineConfig({
  testDir: "./tests/visual",
  testMatch: ["refined-shelf.spec.ts", "search-input.spec.ts", "privacy-settings.spec.ts", "source-app-icons.spec.ts", "queue-selection.spec.ts", "card-reorder.spec.ts", "card-reorder-lifecycle.spec.ts", "group-popovers.spec.ts", "ui-version.spec.ts", "theme-application.spec.ts", "background-image-presentation.spec.ts", "background-image-editor.spec.ts", "image-background-options.spec.ts", "image-background-layout.spec.ts", "surface-theme.spec.ts", "color-picker-layer.spec.ts", "mixed-batch-paste.spec.ts", "text-source-drop.spec.ts", "settings-style.spec.ts", "blocked-applications.spec.ts", "blocked-application-icons.spec.ts", "native-application-icons.spec.ts"],
  outputDir: "./artifacts/pasteboardpro/refined-results",
  workers: 1,
  reporter: "list",
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 360 },
    colorScheme: "dark",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: "node ../../node_modules/vite/bin/vite.js --configLoader runner --host 127.0.0.1",
    cwd: resolve(__dirname, "apps/ztools"),
    url: "http://127.0.0.1:5179/?shelf=1&dock=bottom",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
