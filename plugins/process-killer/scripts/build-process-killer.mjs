// 把 src-ztools 整理成可安装、可分发的插件目录
//
// ZTools 插件仓库对静态插件的打包规则是：清单所在目录 = 安装包内容。
// 同时 src-ztools 这个目录会被发布 CLI 整份复制进插件仓库，而它复制时会跳过
// 名为 dist 的目录。于是约定：
//   src-ztools/plugin.json  ← 发布清单（main/preload/logo 指向 runtime/…）
//   src-ztools/runtime/     ← 清单 + 图标 + 运行时代码（安装包内容）
// 本地 build 只是把它整理成 dist/，用来打 zip、装进 ZTools 开发者工具试跑。
import { cp, rm, mkdir, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const src = path.join(root, 'src-ztools')
// 运行时目录：清单与图标在里面，src-ztools/plugin.json 只是发布用的清单
const pkg = path.join(src, 'runtime')
const out = path.join(root, 'dist')
const manifest = JSON.parse(await readFile(path.join(pkg, 'plugin.json'), 'utf8'))

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await cp(pkg, out, { recursive: true, filter: p => !p.endsWith('.DS_Store') })

// 清单声明的文件必须真的存在，否则装上是白屏
for (const file of [manifest.main, manifest.preload, manifest.logo]) {
  if (!file) continue
  await stat(path.join(out, file)).catch(() => {
    throw new Error('plugin.json 声明的文件不存在: ' + file)
  })
}

console.log('build ok ->', path.relative(root, out))

if (process.argv.includes('--zip')) {
  const zip = path.join(root, 'releases', `process-killer-${manifest.version}.zip`)
  await mkdir(path.dirname(zip), { recursive: true })
  await rm(zip, { force: true })
  // Windows 自带 tar（bsdtar）也能打 zip，Mac 上用 ditto 保留架构信息
  if (process.platform === 'win32') {
    execFileSync('tar.exe', ['-a', '-c', '-f', zip, '-C', out, '.'])
  } else {
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', out, zip])
  }
  console.log('zip ->', path.relative(root, zip))
}
