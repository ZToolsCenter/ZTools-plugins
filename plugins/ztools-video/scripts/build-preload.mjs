import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * 把 preload 里依赖第三方包的模块打成自包含文件。
 *
 * 插件仓库的发布流程会忽略任何名为 node_modules 的目录（包括嵌套的），
 * 所以 preload 不能在运行时 require parse5；这里把依赖内联进产物。
 * provider.js 保持独立文件，端到端测试会替换它来注入测试数据。
 */
await build({
  entryPoints: [`${root}preload-src/catalog.cjs`],
  outfile: `${root}src-ztools/preload/catalog.js`,
  bundle: true,
  platform: 'node',
  target: 'node16',
  format: 'cjs',
  // Electron 提供 electron 模块，不能打进产物。
  external: ['electron'],
  legalComments: 'none',
  logLevel: 'info',
})
