/**
 * 同时启动插件 dev server 与 dist watch build。
 *
 * 开发模式下插件主界面走 http dev server 热更新,而桌面悬浮窗口固定加载
 * dist/desktop.html(ZTools createBrowserWindow 只接受相对路径/file://),
 * 所以改动源码后需要自动重建产物,悬浮窗才能吃到最新代码。
 *
 * 任一子进程退出都会结束另一进程;Ctrl+C 时两者一并终止。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Windows 上 spawn('vite') 找到的是 .cmd 垫片,Node 禁止直接启动而报 ENOENT,
// 改为用当前 node 运行 vite 的 JS 入口,跨平台且无需 shell。
// vite 的 exports 不暴露 bin 路径,只能从包目录拼出来。
const require = createRequire(import.meta.url)
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')

const jobs = [
  { name: 'server', args: ['vite'] },
  { name: 'watch', args: ['vite', 'build', '--watch'] }
]

const children = []
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
  }
  process.exit(code)
}

for (const job of jobs) {
  const child = spawn(process.execPath, [viteBin, ...job.args.slice(1)], { stdio: 'inherit' })
  console.log(`[dev] ${job.name}: ${job.args.join(' ')}`)
  child.on('exit', (code) => {
    console.log(`[dev] ${job.name} 退出 (code=${code ?? 'signal'})`)
    shutdown(code ?? 1)
  })
  children.push(child)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
