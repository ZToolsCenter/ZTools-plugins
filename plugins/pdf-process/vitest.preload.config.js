import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Avoid Vite scanning public/ (e.g. .pytest_cache EPERM on Windows)
  publicDir: false,
  test: {
    globals: true,
    environment: 'node',
    include: ['public/preload/convert/__tests__/**/*.test.js'],
  },
})
