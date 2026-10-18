// 将 src-ztools 打包为 ZTools 可安装的 .zpx（gzip 压缩的 asar）。
// 运行方式：npm run package:zpx
import { createRequire } from 'node:module'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = path.join(projectRoot, 'src-ztools')
const releaseDir = path.join(projectRoot, 'release')
const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'plugin.json'), 'utf8'))

// 安装前的自检：清单引用的入口必须都在插件目录内。
for (const key of ['main', 'logo', 'preload']) {
  const value = manifest[key]
  if (typeof value !== 'string' || !value.trim()) continue
  const target = path.join(pluginRoot, value)
  try {
    await stat(target)
  } catch {
    throw new Error(`插件清单引用的 ${key} 不存在：${target}`)
  }
}

await mkdir(releaseDir, { recursive: true })
const targetZpx = path.join(releaseDir, `${manifest.name}-${manifest.version}.zpx`)
const stagingRoot = await mkdtemp(path.join(os.tmpdir(), `zpx-staging-${manifest.name}-`))
const tempAsar = path.join(os.tmpdir(), `zpx-${manifest.name}-${Date.now()}.asar`)

try {
  // 打包副本移除 development 入口，安装后的插件只加载本地构建页面。
  const stagingPlugin = path.join(stagingRoot, 'plugin')
  await cp(pluginRoot, stagingPlugin, { recursive: true })
  const productionManifest = { ...manifest }
  delete productionManifest.development
  await writeFile(
    path.join(stagingPlugin, 'plugin.json'),
    `${JSON.stringify(productionManifest, null, 2)}\n`,
    'utf8'
  )

  await asar.createPackage(stagingPlugin, tempAsar)

  // 校验 asar 内的清单与源码清单一致，避免打包出错。
  const packed = JSON.parse(asar.extractFile(tempAsar, 'plugin.json').toString('utf8'))
  if (packed.name !== manifest.name || packed.version !== manifest.version) {
    throw new Error('打包结果中的 plugin.json 与源码清单不一致')
  }
  const entries = asar.listPackage(tempAsar).map((entry) => String(entry).replace(/\\/g, '/').replace(/^\/+/, ''))
  for (const required of [manifest.main, manifest.logo, manifest.preload]) {
    const normalized = String(required).replace(/\\/g, '/')
    if (!entries.includes(normalized)) throw new Error(`打包结果缺少 ${normalized}`)
  }

  await pipeline(createReadStream(tempAsar), createGzip({ level: 9 }), createWriteStream(targetZpx))
  const size = (await stat(targetZpx)).size
  console.log(`已生成插件包：${targetZpx}（${(size / 1024).toFixed(1)} KB，${entries.length} 个文件）`)
} finally {
  await rm(tempAsar, { force: true })
  await rm(stagingRoot, { recursive: true, force: true })
}
