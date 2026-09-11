import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';
import { resolve } from 'path';

export default defineConfig({
  envDir: 'env',
  server: {
    port: 5273,
    proxy: {
      '/api': {
        target: 'http://localhost:4456',
        changeOrigin: true
      }
    }
  },
  plugins: [
    vue(),
    AutoImport({
      imports: [
        'vue',
        {
          'naive-ui': ['useDialog', 'useMessage', 'useNotification', 'useLoadingBar']
        }
      ],
      dts: 'auto-imports.d.ts'
    }),
    Components({
      resolvers: [NaiveUiResolver()],
      dts: 'components.d.ts'
    }),
    ViteImageOptimizer({
      png: { quality: 80 },
      jpeg: { quality: 80 },
      jpg: { quality: 80 },
      webp: { quality: 80 }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  base: './',
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        chunkFileNames: 'js/[name]-[hash].js',
        entryFileNames: 'js/[name]-[hash].js',
        assetFileNames(assetInfo) {
          const ext = assetInfo.name?.split('.').pop();
          if (ext === 'css') return 'css/[name]-[hash][extname]';
          if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext!))
            return 'img/[name]-[hash][extname]';
          if (['woff', 'woff2', 'ttf', 'eot'].includes(ext!)) return 'fonts/[name]-[hash][extname]';
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks(id) {
          if (id.includes('node_modules/vue-router')) return 'vue-router';
          if (id.includes('node_modules/chart.js') || id.includes('node_modules/vue-chartjs'))
            return 'chartjs';
          if (id.includes('node_modules/naive-ui') || id.includes('node_modules/@css-render'))
            return 'naive-ui';
          if (id.includes('node_modules/marked')) return 'marked';
          if (id.includes('node_modules/diff')) return 'diff';
        }
      }
    }
  }
});
