import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 4,
    testTimeout: 30_000,
    include: [
      "packages/**/tests/**/*.test.ts",
      "apps/**/tests/**/*.test.ts",
    ],
  },
});
