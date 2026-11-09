// Owner: v038_resource_limits (Sol).
import { defineConfig } from 'vitest/config';
export default defineConfig({ cacheDir: '/Users/harris/Desktop/ZTools-plugins/plugins/pasteboard-pro/artifacts/pasteboardpro/clipboard-format-g0/v038-resource-limits/vite-cache',
  test: { include: ['packages/snapshot-store/tests/g3-verification-budget/limits/*.test.ts'], fileParallelism: false,
    maxWorkers: 1, minWorkers: 1, testTimeout: 115000, hookTimeout: 115000 } });
