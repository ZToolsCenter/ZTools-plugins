import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'src-ztools/dist',
    emptyOutDir: true,
    /*
     * 图片一律输出成独立文件，不要 base64 内联。
     * 默认阈值是 4KB，会把小图标塞进 JS —— 分类图标有 4 张低于这个线，
     * 结果 JS 从 131KB 涨到 148KB（gzip +14KB），而体积并没有省下：
     * 这些资源是要被浏览器单独缓存、单独加载的。
     */
    assetsInlineLimit: 0
  }
})
