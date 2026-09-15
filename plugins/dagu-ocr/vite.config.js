import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const pluginRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: pluginRoot,
  plugins: [vue()],
  css: {
    lightningcss: {
      errorRecovery: true,
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(pluginRoot, 'index.html'),
        annotate: resolve(pluginRoot, 'annotate.html'),
      },
    },
  },
});
