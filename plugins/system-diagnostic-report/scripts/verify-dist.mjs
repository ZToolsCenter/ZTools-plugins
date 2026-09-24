import { access, readFile, readdir, stat } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = path.join(pluginRoot, 'dist')

const requiredFiles = [
  'index.html',
  'plugin.json',
  'logo.svg',
  'README.md',
  'preload/services.js',
  'preload/package.json',
  'preload/package-lock.json',
]

function inside(root, relativePath) {
  const target = path.resolve(root, relativePath)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`发布入口越过 dist 边界：${relativePath}`)
  }
  return target
}

async function assertFile(relativePath) {
  const target = inside(distRoot, relativePath)
  await access(target)
  const fileStat = await stat(target)
  if (!fileStat.isFile()) {
    throw new Error(`发布产物不是文件：${relativePath}`)
  }
  if (fileStat.size === 0) throw new Error(`发布产物为空：${relativePath}`)
  return target
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(target))
    else if (entry.isFile()) files.push(target)
  }
  return files
}

for (const relativePath of requiredFiles) await assertFile(relativePath)

const plugin = JSON.parse(await readFile(path.join(distRoot, 'plugin.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(path.join(pluginRoot, 'package.json'), 'utf8'))
if (plugin.version !== packageJson.version) {
  throw new Error(`plugin.json (${plugin.version}) 与 package.json (${packageJson.version}) 版本不一致`)
}

for (const entry of [plugin.main, plugin.logo, plugin.preload]) {
  if (typeof entry !== 'string' || entry.length === 0) throw new Error('plugin.json 的运行入口不能为空')
  await assertFile(entry)
}

const html = await readFile(path.join(distRoot, plugin.main), 'utf8')
const resourceReferences = [...html.matchAll(/(?:src|href)=["']([^"'#?]+)(?:[?#][^"']*)?["']/g)]
  .map((match) => match[1])
  .filter((reference) => !/^(?:[a-z]+:|\/\/|data:)/i.test(reference))

if (!resourceReferences.some((reference) => /\.js$/i.test(reference))) {
  throw new Error('index.html 未引用前端 JavaScript bundle')
}

for (const reference of resourceReferences) {
  const normalized = reference.replace(/^\.\//, '').replace(/^\//, '')
  await assertFile(normalized)
}

const preloadRoot = path.join(distRoot, 'preload')
const preloadPackage = JSON.parse(await readFile(path.join(preloadRoot, 'package.json'), 'utf8'))
const declaredDependencies = Object.keys(preloadPackage.dependencies ?? {})
const preloadFiles = await walkFiles(preloadRoot)
const builtinSet = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const checkedDependencies = new Set()

for (const file of preloadFiles) {
  const relative = path.relative(preloadRoot, file)
  if (/(?:^|[/\\_.-])(?:bundle|chunk|min)(?:[/\\_.-]|$)/i.test(relative) || file.endsWith('.map')) {
    throw new Error(`preload 中存在疑似打包/压缩产物：${relative}`)
  }
  if (!/\.(?:c?js)$/i.test(file)) continue

  const source = await readFile(file, 'utf8')
  if (/webpackBootstrap|__webpack_require__|\/\*!? For license information please see/i.test(source)) {
    throw new Error(`preload 中存在疑似 bundle 内容：${relative}`)
  }

  const localRequire = createRequire(file)
  for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1]
    if (builtinSet.has(specifier)) continue
    try {
      localRequire.resolve(specifier)
      checkedDependencies.add(specifier)
    } catch (error) {
      throw new Error(`${relative} 的依赖无法解析：${specifier}`, { cause: error })
    }
  }
}

const preloadRequire = createRequire(path.join(preloadRoot, 'services.js'))
for (const dependency of declaredDependencies) {
  try {
    preloadRequire.resolve(dependency)
    checkedDependencies.add(dependency)
  } catch (error) {
    throw new Error(`preload 生产依赖无法解析：${dependency}`, { cause: error })
  }
}

console.log(
  `Verified dist: ${requiredFiles.length} required files, ${resourceReferences.length} frontend references, `
    + `${checkedDependencies.size} preload dependencies, version ${plugin.version}`,
)
