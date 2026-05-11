import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'remove-crossorigin',
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, '')
      }
    },
    viteStaticCopy({
      targets: [
        { src: 'README.md', dest: '' },
        { src: 'screenshot1.png', dest: '' },
        { src: 'screenshot2.png', dest: '' }
      ]
    })
  ],
  base: './',
  build: {
    assetsDir: 'assets',
    modulePreload: {
      polyfill: false
    },
    assetsInlineLimit: 4096,
  }
})
