import { readFile, readdir, rm, mkdir, copyFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(root, 'public')
const distRoot = path.join(root, 'dist')
const maxBytes = 15 * 1024 * 1024

async function copyTree(source, target) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) await copyTree(from, to)
    else if (entry.isFile()) await copyFile(from, to)
  }
}

async function walk(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(target, relative))
    else if (entry.isFile()) files.push({ relative, target, size: (await stat(target)).size })
  }
  return files
}

await rm(distRoot, { recursive: true, force: true })
await copyTree(publicRoot, distRoot)
await copyFile(path.join(root, 'README.md'), path.join(distRoot, 'README.md'))
await copyFile(path.join(root, 'SECURITY.md'), path.join(distRoot, 'SECURITY.md'))
try { await copyTree(path.join(root, 'screenshots'), path.join(distRoot, 'screenshots')) } catch {}

const required = ['index.html', 'app.js', 'styles.css', 'plugin.json', 'logo.svg', 'preload/services.js', 'preload/core.cjs', 'preload/roots.cjs', 'README.md', 'SECURITY.md']
for (const relative of required) await stat(path.join(distRoot, relative))
const manifest = JSON.parse(await readFile(path.join(distRoot, 'plugin.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (manifest.version !== packageJson.version) throw new Error('plugin.json 与 package.json 版本不一致')
const files = await walk(distRoot)
const distBytes = files.reduce((sum, file) => sum + file.size, 0)
if (distBytes >= maxBytes) throw new Error(`dist 超过 15 MiB：${distBytes}`)
if (files.some((file) => file.relative.endsWith('.map') || /(?:^|\/)(?:node_modules|src|tests)(?:\/|$)/.test(file.relative))) {
  throw new Error('发布物包含开发文件、依赖目录或 sourcemap')
}
const preloadFiles = files.filter((file) => file.relative.startsWith('preload/'))
for (const file of preloadFiles) {
  const source = await readFile(file.target, 'utf8')
  if (/webpackBootstrap|__webpack_require__|sourceMappingURL/.test(source)) throw new Error(`preload 不可审核：${file.relative}`)
}

console.log(JSON.stringify({ files: files.length, distBytes, limitBytes: maxBytes, internalModuleDist: true }))
