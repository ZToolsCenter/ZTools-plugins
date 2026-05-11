import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'copy-license',
      closeBundle() {
        fs.copyFileSync(path.resolve(rootDir, 'LICENSE'), path.resolve(rootDir, 'dist', 'LICENSE'));
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  server: {
    port: 8000,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
