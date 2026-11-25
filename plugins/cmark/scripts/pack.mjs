/**
 * 打包：vite build 之后，把 plugin.json / preload 相关文件复制到 dist，
 * 再用 @electron/asar 打成 cmark-<version>.asar
 *
 * 用法：node scripts/pack.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'app')

if (!fs.existsSync(dist)) {
  console.error('app 目录不存在，先跑 npm run build')
  process.exit(1)
}

// 1. plugin.json / logo
// 项目根那份的 main 是 "app/index.html"（市场要求：产物在非 dist 目录），
// 但 asar 的根目录就是 app/ 本身，再指 app/index.html 会变成 app/app/index.html。
// 所以往 app/ 里写一份 main 指向 index.html 的副本。
const pjRoot = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'))
const pjApp = { ...pjRoot, main: 'index.html' }
fs.writeFileSync(path.join(dist, 'plugin.json'), JSON.stringify(pjApp, null, 2) + '\n', 'utf8')
const logoSvg = path.join(root, 'public', 'logo.png')
if (fs.existsSync(logoSvg)) fs.copyFileSync(logoSvg, path.join(dist, 'logo.png'))
// 2. preload 及其依赖（递归：ports/ 与 panels/ 是子目录）
fs.copyFileSync(path.join(root, 'preload.js'), path.join(dist, 'preload.js'))
const preloadDir = path.join(root, 'preload')
fs.cpSync(preloadDir, path.join(dist, 'preload'), {
  recursive: true,
  filter: (src) => {
    const st = fs.statSync(src)
    if (st.isDirectory()) return true
    return src.endsWith('.js') || src.endsWith('.json')
  },
})

// 关键：uTools 导入源码工程时，工程目录就是 app/，Electron 加载 preload.js 会向上找
// 最近的 package.json。仓库根那份是 "type": "module"（vite 需要），会把 app/preload.js
// 误判成 ES Module 而直接拒绝加载 —— 表现是 preload 整体不执行、设置与 Git 面板全打不开。
// 所以在 app/ 里放一份只说 commonjs 的 package.json，就近覆盖。
fs.writeFileSync(
  path.join(dist, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
)

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
console.log('app 就绪，版本 ' + pkg.version)
console.log('下一步：npx @electron/asar pack app cmark-' + pkg.version + '.asar')
