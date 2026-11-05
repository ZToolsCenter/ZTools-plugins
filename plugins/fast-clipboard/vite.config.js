import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'

/*
 * 构建戳：每次构建生成一个唯一值，做两件事——
 *   1. `define.__BUILD_STAMP__` 注进渲染进程：页面"记得"自己是哪次构建的；
 *   2. `closeBundle` 把同一个值写进 dist/BUILD_ID：磁盘上的"最新构建"是谁。
 *
 * dev 模式（file:// 加载 dist）下插件视图是持久化的——失焦关闭只是隐藏窗口，
 * 页面里的旧 JS 会一直跑下去。侧栏在 onShown 时用 preload 读 BUILD_ID 对比，
 * 不一致就 location.reload()：重新构建完，下次打开插件自动生效，不用手动
 * "结束运行"。市场版（asar 内）读到的就是自己那份 BUILD_ID，恒等，不会误刷。
 */
const pluginJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'src-ztools/plugin.json'), 'utf8'))
const buildStamp = `${pluginJson.version}-${Date.now()}`

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'write-build-stamp',
      closeBundle() {
        const file = path.resolve(__dirname, 'src-ztools/dist/BUILD_ID')
        fs.writeFileSync(file, buildStamp, 'utf8')
      }
    }
  ],
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp),
    // 界面上显示的版本徽标（侧栏底部）——一眼看出当前跑的是哪一版
    __APP_VERSION__: JSON.stringify(pluginJson.version)
  },
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
