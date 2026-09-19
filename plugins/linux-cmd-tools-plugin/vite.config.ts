import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Markdown from 'unplugin-vue-markdown/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      include: [/\.vue$/, /\.md$/]
    }),
    Markdown({
      markdownOptions: {
        html: false
      }
    })
  ],
  base: './',
  build: {
    outDir: 'src-ztools/dist',
    emptyOutDir: true,
    cssTarget: 'esnext',
  }
})
