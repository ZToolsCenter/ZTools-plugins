import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import { distRoot, inside, limitBytes, releaseRoot, requireStrictSemver, root } from './config.mjs'
import { createZip, inspectZip, sha256 } from './zip.mjs'

async function walk(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error(`打包目录禁止符号链接：${path.relative(distRoot, target)}`)
    if (entry.isDirectory()) output.push(...await walk(target))
    else if (entry.isFile()) output.push(target)
  }
  return output
}

async function syncPath(targetPath) {
  const handle = await open(targetPath, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function syncDirectory(targetPath) {
  try { await syncPath(targetPath) } catch (error) {
    if (process.platform === 'win32' && ['EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(error.code)) return
    throw error
  }
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const version = requireStrictSemver(packageJson.version)
const files = await walk(distRoot)
const distBytes = (await Promise.all(files.map((file) => stat(file)))).reduce((sum, info) => sum + info.size, 0)
if (distBytes >= limitBytes) throw new Error(`dist ${distBytes} bytes，必须严格小于 15 MiB`)
await mkdir(releaseRoot, { recursive: true })
const releaseInfo = await lstat(releaseRoot)
if (!releaseInfo.isDirectory() || releaseInfo.isSymbolicLink()) throw new Error('release 必须是插件内普通目录')
const filename = `system-manager-${version}.zip`
const target = inside(releaseRoot, filename)
const temporary = inside(releaseRoot, `.${filename}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
let zipBytes
let entries
try {
  zipBytes = await createZip(files, distRoot, temporary)
  if (zipBytes >= limitBytes) throw new Error(`ZIP ${zipBytes} bytes，必须严格小于 15 MiB`)
  entries = inspectZip(await readFile(temporary))
  if (entries.length !== files.length) throw new Error(`ZIP 文件数不一致：${entries.length}/${files.length}`)
  const expected = new Map(await Promise.all(files.map(async (file) => {
    const name = path.relative(distRoot, file).split(path.sep).join('/')
    const content = await readFile(file)
    return [name, { size: content.length, sha256: sha256(content) }]
  })))
  for (const entry of entries) {
    const source = expected.get(entry.name)
    if (!source || source.size !== entry.size || source.sha256 !== entry.sha256) throw new Error(`ZIP 内容与 dist 不一致：${entry.name}`)
    expected.delete(entry.name)
  }
  if (expected.size) throw new Error(`ZIP 缺少 dist 文件：${[...expected.keys()].join(', ')}`)
  await syncPath(temporary)
  await rename(temporary, target)
  await syncDirectory(releaseRoot)
} catch (error) {
  await rm(temporary, { force: true })
  throw error
}
console.log(`Created ${target}: ${zipBytes} bytes, ${entries.length} verified entries (< 15 MiB)`)
