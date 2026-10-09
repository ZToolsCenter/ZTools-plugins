/**
 * Node 的 ESM 解析器不认识 Vite 的两样东西，这个钩子补上，
 * 让 design/*.mts 能直接 import 业务模块做集成测试。
 *
 * 用法：node --experimental-strip-types --import ./design/ts-register.mjs design/xxx.mts
 *
 *   1. 无扩展名的 TS 导入（Vite 认，Node 不认）→ 补 ".ts"
 *   2. 图片资源导入（`import icon from '../assets/icons/x.png'`）
 *      → 换成"相对项目根的路径字符串"。
 *      图片本身在 Node 里没有意义，但测试因此可以断言
 *      "某个分类指向的是哪张素材"，比断言一个 URL 哈希有用得多。
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i

export async function resolve(specifier, context, nextResolve) {
  // 图片：交给下面的 load 钩子处理
  if (IMG_RE.test(specifier)) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (/^[./]/.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + '.ts', context)
    }
    throw err
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && IMG_RE.test(url)) {
    const rel = path
      .relative(process.cwd(), fileURLToPath(url))
      .split(path.sep)
      .join('/')
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify('./' + rel)}`
    }
  }
  return nextLoad(url, context)
}
