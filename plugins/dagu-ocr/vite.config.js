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
  // 宿主的开发入口是 http://127.0.0.1:5173/index.html（见 plugin.json 的 development.main）。
  // 不指定 host 时 vite 监听 localhost，Node 17+ 在 Windows 上把它解析成 IPv6 的 ::1，
  // 宿主连 127.0.0.1 会被拒绝，页面空白。
  server: {
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(pluginRoot, 'index.html'),
        overlay: resolve(pluginRoot, 'overlay.html'),
        pin: resolve(pluginRoot, 'pin.html'),
      },
    },
  },
});
