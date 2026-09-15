import { access, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { distRoot, inside, modules, publicRoot, root } from './config.mjs'
import { navigationScript, navigationStyle } from './navigation-assets.mjs'

const navigationDirectory = inside(distRoot, '_system-manager')
const navigationScriptPath = path.join(navigationDirectory, 'navigation.js')
const navigationStylePath = path.join(navigationDirectory, 'navigation.css')
const strictProductionCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"

async function htmlFiles(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await htmlFiles(target))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) output.push(target)
  }
  return output
}

function webRelative(fromDirectory, target) {
  const relative = path.relative(fromDirectory, target).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

async function injectNavigation(htmlPath, module) {
  let source = await readFile(htmlPath, 'utf8')
  if (source.includes('data-system-manager-navigation')) return
  if (!/<\/head\s*>/i.test(source) || !/<\/body\s*>/i.test(source)) {
    throw new Error(`模块 HTML 缺少 head/body 结束标签：${path.relative(distRoot, htmlPath)}`)
  }
  const directory = path.dirname(htmlPath)
  const stylesheet = webRelative(directory, navigationStylePath)
  const script = webRelative(directory, navigationScriptPath)
  const home = webRelative(directory, path.join(distRoot, 'index.html'))
  source = source.replace(/<body\b([^>]*)>/i, (tag, attributes) => {
    if (/data-system-manager-module\s*=/.test(attributes)) throw new Error(`${module.id} 重复声明系统管家模块标识`)
    return `<body${attributes} data-system-manager-module="${module.id}">`
  })
  source = source.replace(/<\/head\s*>/i, `  <link rel="stylesheet" href="${stylesheet}" data-system-manager-navigation="style" />\n</head>`)
  source = source.replace(/<\/body\s*>/i, `  <script src="${script}" data-system-manager-home="${home}" data-system-manager-feature="${module.id}" data-system-manager-navigation="script" defer></script>\n</body>`)
  await writeFile(htmlPath, source)
}

async function enforceProductionCsp(htmlPath) {
  let source = await readFile(htmlPath, 'utf8')
  source = source.replace(/<meta\b[^>]*>/gi, (tag) => {
    return /http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag) ? '' : tag
  })
  if (!/<head\b[^>]*>/i.test(source)) throw new Error(`HTML 缺少 head 起始标签：${path.relative(distRoot, htmlPath)}`)
  source = source.replace(/<head\b[^>]*>/i, (tag) => `${tag}\n  <meta http-equiv="Content-Security-Policy" content="${strictProductionCsp}" data-system-manager-csp="production" />`)
  await writeFile(htmlPath, source)
}

async function finalizeModulePreload(module, target) {
  const source = inside(target, module.sourcePreload)
  const destination = inside(target, module.finalPreload)
  const info = await lstat(source)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${module.id} preload 不是安全普通文件`)
  if (source === destination) return
  try {
    await lstat(destination)
    throw new Error(`${module.id} final preload 已存在，拒绝覆盖`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await rename(source, destination)
}

for (const relative of ['index.html', 'plugin.json', 'logo.svg', 'preload']) {
  await access(path.join(publicRoot, relative))
}

await rm(distRoot, { recursive: true, force: true })
await mkdir(distRoot, { recursive: true })
await cp(publicRoot, distRoot, { recursive: true, force: true })
await copyDocumentation()
await mkdir(navigationDirectory, { recursive: true })
await writeFile(navigationScriptPath, navigationScript)
await writeFile(navigationStylePath, navigationStyle)
await enforceProductionCsp(inside(distRoot, 'index.html'))

for (const module of modules) {
  const source = inside(root, 'modules', module.id, 'dist')
  const target = inside(distRoot, 'modules', module.id)
  await access(path.join(source, 'index.html'))
  await cp(source, target, { recursive: true, force: true })
  await rm(path.join(target, 'plugin.json'), { force: true })
  await finalizeModulePreload(module, target)
  for (const relative of ['README.md', 'SECURITY.md', 'screenshots']) {
    await rm(inside(target, relative), { recursive: true, force: true })
  }
  for (const html of await htmlFiles(target)) {
    await injectNavigation(html, module)
    await enforceProductionCsp(html)
  }
}

async function copyDocumentation() {
  for (const name of ['README.md', 'SECURITY.md']) {
    const source = inside(root, name)
    await access(source)
    await cp(source, inside(distRoot, name), { force: true })
  }
  const screenshots = inside(root, 'screenshots')
  await access(path.join(screenshots, 'main.png'))
  await cp(screenshots, inside(distRoot, 'screenshots'), { recursive: true, force: true })
}

console.log(`Assembled dashboard and ${modules.length} modules into ${distRoot}`)
