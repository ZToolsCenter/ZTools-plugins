import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [NaiveUiResolver()]
    })
  ],
  base: './',
  server: {
    port: 1688
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['legacy-js-api']
      }
    }
  },
  optimizeDeps: {
    include: [
      'naive-ui',
      'vue-codemirror',
      '@codemirror/lang-java',
      '@codemirror/lang-javascript',
      '@codemirror/lang-sql',
      '@codemirror/lang-vue',
      '@codemirror/theme-one-dark',
      'vxe-table'
    ]
  }
})
