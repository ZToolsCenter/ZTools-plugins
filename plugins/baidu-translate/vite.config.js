import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 百度翻译插件构建配置。
 * 产物直接输出到 src-ztools/dist（plugin.json 的 main 指向 dist/index.html），
 * base 用相对路径，保证 file:// 协议加载时资源引用不破。
 */
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'src-ztools/dist',
    emptyOutDir: true,
    assetsInlineLimit: 0
  }
})
