/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Local convert writers need Node env (pptxgenjs/fs); run via npm run test:convert
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'public/preload/convert/__tests__/**',
    ],
  },
})
