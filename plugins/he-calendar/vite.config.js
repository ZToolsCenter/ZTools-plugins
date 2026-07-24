import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { build as esbuild } from 'esbuild'
import path from 'path'

/**
 * Vite 插件：构建完成后用 esbuild 打包 preload 脚本
 * 将 tyme4ts 等依赖内联到单文件，确保 uTools 插件打包后无需 node_modules
 */
const bundlePreload = () => ({
  name: 'bundle-preload',
  apply: 'build',
  closeBundle: async () => {
    await esbuild({
      entryPoints: [path.resolve('public/preload/services.js')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: path.resolve('dist/preload/services.js'),
      external: ['electron'],
    })
    console.log('✅ preload/services.js bundled with tyme4ts')
  },
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), bundlePreload()],
  base: './' // 保持相对路径，或者根据仓库名设置为 '/he-calendar/'
})
