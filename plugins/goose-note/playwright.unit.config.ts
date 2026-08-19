import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests/unit",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
});
