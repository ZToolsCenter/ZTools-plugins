import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Source and compiled CommonJS files are both checked in. Tests must
    // exercise the TypeScript source instead of a potentially stale .js file.
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
