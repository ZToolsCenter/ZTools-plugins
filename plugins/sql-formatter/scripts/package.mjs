import * as asar from '@electron/asar'
import AdmZip from 'adm-zip'
import { constants, createBrotliCompress } from 'node:zlib'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const release = path.join(root, 'release')
const asarPath = path.join(release, 'sql-formatter.asar')
const zpxPath = path.join(release, 'sql-formatter-1.0.0.zpx')
const zipPath = path.join(release, 'sql-formatter-1.0.0.zip')

if (!existsSync(path.join(dist, 'plugin.json'))) {
  throw new Error('dist/plugin.json 不存在，请先执行 npm run build')
}

await rm(release, { recursive: true, force: true })
await mkdir(release, { recursive: true })

// ZPX 是 Brotli 压缩后的标准 ASAR，与 ZTools 3.1.0 的 packZpx 实现一致。
await asar.createPackage(dist, asarPath)
await pipeline(
  createReadStream(asarPath),
  createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
  createWriteStream(zpxPath)
)
await rm(asarPath, { force: true })

// ZIP 作为兼容安装包，归档根目录直接包含 plugin.json。
const zip = new AdmZip()
zip.addLocalFolder(dist)
zip.writeZip(zipPath)

console.log(`Created ${zpxPath}`)
console.log(`Created ${zipPath}`)
