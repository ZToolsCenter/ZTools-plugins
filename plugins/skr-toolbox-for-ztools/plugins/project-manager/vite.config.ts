import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const isUtools = mode === 'utools';
  const isZtools = mode === 'ztools';
  const isPlugin = isUtools || isZtools;
  return {
    base: isPlugin ? './' : '/',
    plugins: [vue(), UnoCSS()],
    build: {
      outDir: isZtools ? 'dist-ztools' : isUtools ? 'dist-utools' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;

            if (id.includes('element-plus')) return 'vendor-element-plus';
            if (id.includes('@tauri-apps')) return 'vendor-tauri';
            if (id.includes('vue') || id.includes('pinia') || id.includes('vue-i18n')) return 'vendor-vue';
            if (id.includes('marked') || id.includes('diff2html') || id.includes('ansi_up') || id.includes('pinyin-pro')) {
              return 'vendor-utils';
            }

            return 'vendor-misc';
          },
        },
      },
    },
    define: {
      'import.meta.env.VITE_TARGET': JSON.stringify(isZtools ? 'ztools' : isUtools ? 'utools' : 'tauri')
    },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  };
});
