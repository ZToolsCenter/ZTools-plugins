import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    /*
     * `features.optionsAPI: false` 会把 Vue 的 `__VUE_OPTIONS_API__` 编译期定成 false，
     * 把运行时的 Options API（`data()` / `methods` / mixins 那一整套合并逻辑）整段摇掉。
     *
     * 本项目**一行 Options API 都没有**（全部是 `<script setup>`），
     * 所以这是零行为变化的瘦身：产物里少一段永远走不到的分支。
     * 别的 Vue 特性都没关（`prodDevtools` 默认就是 false，不用写）。
     */
    vue({ features: { optionsAPI: false } })
  ],
  base: './',
  // dev 端口固定 5181（5173~5182、3000、8000、8080 已被其他插件占用）
  server: {
    port: 5181,
    strictPort: true
  },
  build: {
    // 插件本体在 src-ztools/，产物直接落进去，那份目录单独就能装
    outDir: fileURLToPath(new URL('./src-ztools/dist', import.meta.url)),
    emptyOutDir: true,
    // 宿主是 Electron（本机实测 Chromium 146），不需要为老浏览器降级语法。
    // 只影响 esbuild 的语法降级，不改一行运行逻辑。
    target: 'esnext'
  }
})
