import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** ZTools 通过 file:// 加载插件，ES Module 脚本会被 CORS 拦截 */
function ztoolsFileProtocolFix() {
  return {
    name: 'ztools-file-protocol-fix',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(
            /<script type="module" crossorigin src="([^"]+)"><\/script>/,
            '<script defer src="$1"></script>'
          )
          .replace(
            /<link rel="stylesheet" crossorigin href="([^"]+)">/,
            '<link rel="stylesheet" href="$1">'
          )
      }
    }
  }
}

export default defineConfig({
  plugins: [vue(), ztoolsFileProtocolFix()],
  base: './',
  build: {
    target: 'es2015',
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/app.[ext]'
      }
    }
  }
})
