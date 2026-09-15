import { access, lstat, readFile, readdir, stat } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'

import { distRoot, inside, limitBytes, modules, requireStrictSemver, root } from './config.mjs'
import { verifyRuntimeDependencyDirectory } from './runtime-dependency-integrity.mjs'

const strictProductionCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"
const expectedToolNames = Object.freeze([
  'get_capabilities',
  'collect_diagnostic_report',
  'render_diagnostic_report',
  'export_diagnostic_report',
  'scan_applications',
  'list_applications',
  'inspect_application',
  'prepare_application_removal',
  'execute_application_removal',
  'scan_startup_items',
  'list_startup_items',
  'prepare_startup_change',
  'set_startup_item_enabled',
  'undo_startup_change',
  'scan_system_junk',
  'list_system_junk',
  'prepare_system_cleanup',
  'clean_system_junk',
  'list_network_interfaces',
  'prepare_lan_scan',
  'scan_lan_devices',
  'get_operation_result',
])

function verifySchemaNode(schema, location, seen = new Set()) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`${location} 必须是 JSON Schema 对象`)
  if (seen.has(schema)) return
  seen.add(schema)

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.includes('string') && (!Number.isInteger(schema.maxLength) || schema.maxLength < 1)) {
    throw new Error(`${location} 的字符串缺少正整数 maxLength`)
  }
  if (types.includes('array')) {
    if (!Number.isInteger(schema.maxItems) || schema.maxItems < 1) throw new Error(`${location} 的数组缺少正整数 maxItems`)
    if (!schema.items || typeof schema.items !== 'object') throw new Error(`${location} 的数组缺少 items schema`)
  }
  if (types.includes('object')) {
    const controlled = schema.additionalProperties === false
      || (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !Array.isArray(schema.additionalProperties))
    if (!controlled) throw new Error(`${location} 的对象必须关闭或约束 additionalProperties`)
    if (schema.required && (!Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length)) {
      throw new Error(`${location}.required 无效或包含重复字段`)
    }
  }

  for (const keyword of ['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else']) {
    if (schema[keyword] && typeof schema[keyword] === 'object') verifySchemaNode(schema[keyword], `${location}.${keyword}`, seen)
  }
  for (const keyword of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    if (!schema[keyword] || typeof schema[keyword] !== 'object') continue
    for (const [name, child] of Object.entries(schema[keyword])) verifySchemaNode(child, `${location}.${keyword}.${name}`, seen)
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    if (!Array.isArray(schema[keyword])) continue
    schema[keyword].forEach((child, index) => verifySchemaNode(child, `${location}.${keyword}[${index}]`, seen))
  }
}

function verifyTools(manifest) {
  if (!manifest.tools || typeof manifest.tools !== 'object' || Array.isArray(manifest.tools)) throw new Error('plugin.json 缺少 tools 对象')
  const names = Object.keys(manifest.tools)
  if (JSON.stringify(names) !== JSON.stringify(expectedToolNames)) {
    throw new Error(`MCP 工具必须按固定顺序完整声明：${expectedToolNames.join(', ')}`)
  }
  for (const [name, declaration] of Object.entries(manifest.tools)) {
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) throw new Error(`工具 ${name} 声明无效`)
    if (typeof declaration.description !== 'string' || declaration.description.length < 8 || declaration.description.length > 800) {
      throw new Error(`工具 ${name} 缺少有界说明`)
    }
    for (const schemaName of ['inputSchema', 'outputSchema']) {
      const schema = declaration[schemaName]
      if (!schema || schema.type !== 'object' || schema.additionalProperties !== false || !schema.properties || typeof schema.properties !== 'object') {
        throw new Error(`工具 ${name}.${schemaName} 必须是关闭额外字段的对象 schema`)
      }
      verifySchemaNode(schema, `tools.${name}.${schemaName}`)
    }
    for (const [field, schema] of Object.entries(declaration.inputSchema.properties)) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type]
      if (types.includes('array') && (!Number.isInteger(schema.minItems) || schema.minItems < 1)) {
        throw new Error(`工具 ${name} 的输入数组 ${field} 必须声明正整数 minItems`)
      }
    }
  }

  for (const name of ['export_diagnostic_report', 'execute_application_removal', 'set_startup_item_enabled', 'undo_startup_change', 'clean_system_junk', 'scan_lan_devices']) {
    if (!manifest.tools[name].description.includes('需要用户在系统管家界面短时授权')) {
      throw new Error(`有副作用工具 ${name} 未明确短时授权要求`)
    }
  }
  for (const name of ['prepare_application_removal', 'execute_application_removal', 'prepare_system_cleanup', 'clean_system_junk']) {
    const description = manifest.tools[name].description
    if (!description.includes('废纸篓') || !description.includes('人工恢复')) throw new Error(`工具 ${name} 未说明可恢复删除边界`)
  }
  for (const name of ['prepare_startup_change', 'set_startup_item_enabled', 'undo_startup_change']) {
    if (!manifest.tools[name].description.includes('启动项')) throw new Error(`工具 ${name} 未说明启动项副作用`)
  }
  for (const name of ['prepare_lan_scan', 'scan_lan_devices']) {
    if (!manifest.tools[name].description.includes('ICMP')) throw new Error(`工具 ${name} 未说明主动 LAN 探测副作用`)
  }

  const pagedTools = ['scan_applications', 'list_applications', 'scan_startup_items', 'list_startup_items', 'scan_system_junk', 'list_system_junk']
  for (const name of pagedTools) {
    const pageSize = manifest.tools[name].inputSchema.properties.pageSize
    if (!pageSize || pageSize.type !== 'integer' || pageSize.minimum !== 1 || pageSize.maximum !== 100 || pageSize.default !== 50) {
      throw new Error(`工具 ${name} 的 pageSize 必须限制为 1..100 且默认 50`)
    }
  }
  for (const name of ['list_applications', 'list_startup_items', 'list_system_junk']) {
    if ('offset' in manifest.tools[name].inputSchema.properties || !manifest.tools[name].inputSchema.properties.cursor) {
      throw new Error(`工具 ${name} 必须使用不透明 cursor 分页，禁止暴露 offset`)
    }
  }
}

async function walk(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error(`发布目录禁止符号链接：${path.relative(distRoot, target)}`)
    if (entry.isDirectory()) output.push(...await walk(target))
    else if (entry.isFile()) output.push(target)
  }
  return output
}

async function requireFile(relative) {
  const target = inside(distRoot, relative)
  await access(target)
  const info = await stat(target)
  if (!info.isFile() || info.size === 0) throw new Error(`发布文件无效：${relative}`)
  return target
}

for (const relative of [
  'index.html',
  'plugin.json',
  'logo.svg',
  'README.md',
  'SECURITY.md',
  'screenshots/main.png',
  'preload/index.cjs',
  'preload/router.cjs',
  'preload/mcp-tools.cjs',
  'preload/agent-access.cjs',
  'preload/validation.cjs',
  'preload/suite-runtime.cjs',
  '_system-manager/navigation.js',
  '_system-manager/navigation.css',
]) await requireFile(relative)

const manifest = JSON.parse(await readFile(path.join(distRoot, 'plugin.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
requireStrictSemver(packageJson.version)
if (manifest.name !== 'system-manager') throw new Error(`根插件 ID 错误：${manifest.name}`)
if (manifest.version !== packageJson.version) throw new Error('plugin.json 与 package.json 版本不一致')
verifyTools(manifest)
for (const field of ['main', 'preload', 'logo']) {
  const value = manifest[field]
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || path.normalize(value).startsWith('..')) {
    throw new Error(`${field} 不是安全相对路径`)
  }
  await requireFile(value)
}

const expectedFeatures = modules.map((module) => module.id)
const actualFeatures = Array.isArray(manifest.features) ? manifest.features.map((feature) => feature.code) : []
if (JSON.stringify(actualFeatures) !== JSON.stringify(expectedFeatures)) {
  throw new Error(`Feature 必须按固定顺序完整声明：${expectedFeatures.join(', ')}`)
}
for (const feature of manifest.features) {
  if (new Set(feature.platform || []).size !== 3 || !['darwin', 'win32', 'linux'].every((value) => feature.platform.includes(value))) {
    throw new Error(`Feature ${feature.code} 未覆盖三平台`)
  }
  if (!Array.isArray(feature.cmds) || feature.cmds.length === 0) throw new Error(`Feature ${feature.code} 缺少触发词`)
}

for (const module of modules) {
  const prefix = `modules/${module.id}`
  const htmlPath = await requireFile(`${prefix}/index.html`)
  await requireFile(`${prefix}/logo.svg`)
  await requireFile(`${prefix}/${module.finalPreload}`)
  if (module.sourcePreload !== module.finalPreload && await relativeExists(`${prefix}/${module.sourcePreload}`)) {
    throw new Error(`${module.id} 仍包含未重命名的 preload：${module.sourcePreload}`)
  }
  const html = await readFile(htmlPath, 'utf8')
  if (!html.includes('data-system-manager-navigation="style"') || !html.includes('data-system-manager-navigation="script"')) {
    throw new Error(`${module.id} 缺少返回系统管家导航注入`)
  }
  if (!html.includes('data-system-manager-home="../../index.html"')) {
    throw new Error(`${module.id} 的返回路径不可访问`)
  }
}

async function relativeExists(relative) {
  try { await lstat(inside(distRoot, relative)); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

const files = await walk(distRoot)
const relativeFiles = files.map((file) => path.relative(distRoot, file).split(path.sep).join('/'))
const runtimeDependencyPrefixes = new Set()
for (const module of modules) {
  const modulePackage = JSON.parse(await readFile(path.join(root, 'modules', module.id, 'package.json'), 'utf8'))
  for (const dependency of module.runtimeDependencies || []) {
    const prefix = `modules/${module.id}/preload/node_modules/${dependency}/`
    runtimeDependencyPrefixes.add(prefix)
    const packagePath = `${prefix}package.json`
    await requireFile(packagePath)
    const installed = JSON.parse(await readFile(inside(distRoot, packagePath), 'utf8'))
    const locked = packageLock.packages?.[`node_modules/${dependency}`]
    const declared = modulePackage.dependencies?.[dependency]
    if (!locked?.integrity || declared !== installed.version || locked.version !== installed.version || installed.name !== dependency) {
      throw new Error(`${module.id} 的运行依赖 ${dependency} 未按根锁文件精确交付`)
    }
    await verifyRuntimeDependencyDirectory({
      directory: inside(distRoot, prefix.slice(0, -1)),
      dependency,
      version: installed.version,
      packageIntegrity: locked.integrity
    })
    if (typeof installed.license !== 'string' || !installed.license) throw new Error(`${dependency} 缺少许可证声明`)
    for (const script of ['preinstall', 'install', 'postinstall']) {
      if (installed.scripts?.[script]) throw new Error(`${dependency} 禁止包含 ${script} 生命周期脚本`)
    }
  }
}

function isAllowedRuntimeDependencyFile(relative) {
  return [...runtimeDependencyPrefixes].some((prefix) => {
    if (!relative.startsWith(prefix)) return false
    return !/(?:^|\/)node_modules(?:\/|$)/.test(relative.slice(prefix.length))
  })
}

const nestedManifests = relativeFiles.filter((relative) => relative !== 'plugin.json' && relative.endsWith('/plugin.json'))
if (nestedManifests.length) throw new Error(`发布物包含嵌套 plugin.json：${nestedManifests.join(', ')}`)
const forbidden = relativeFiles.filter((relative) => relative.endsWith('.map')
  || /(?:^|\/)(?:src|tests)(?:\/|$)/.test(relative)
  || (/(?:^|\/)node_modules(?:\/|$)/.test(relative) && !isAllowedRuntimeDependencyFile(relative)))
if (forbidden.length) throw new Error(`发布物包含开发文件：${forbidden.join(', ')}`)
const moduleDocumentation = relativeFiles.filter((relative) => /^modules\/[^/]+\/(?:README\.md|SECURITY\.md|screenshots\/)/.test(relative))
if (moduleDocumentation.length) throw new Error(`最终模块包含重复文档或截图：${moduleDocumentation.join(', ')}`)

for (const relative of ['index.html', ...modules.map((module) => `modules/${module.id}/index.html`)]) {
  const html = await readFile(inside(distRoot, relative), 'utf8')
  const policies = [...html.matchAll(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi)]
  if (policies.length !== 1 || !policies[0][0].includes(`content="${strictProductionCsp}"`)) {
    throw new Error(`${relative} 未使用唯一严格生产 CSP`)
  }
  if (/unsafe-inline|127\.0\.0\.1|localhost|ws:\/\//i.test(policies[0][0])) throw new Error(`${relative} CSP 包含开发或不安全来源`)
  const cspIndex = html.indexOf(policies[0][0])
  const firstResourceIndex = html.search(/<(?:script|link|style|img)\b/i)
  if (firstResourceIndex !== -1 && cspIndex > firstResourceIndex) throw new Error(`${relative} 的 CSP 必须位于首个可加载资源之前`)
}

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const hostRuntimeModules = new Set(['electron'])
for (const file of files.filter((target) => /(?:^|[/\\])preload[/\\].*\.(?:c?js)$/i.test(target))) {
  const source = await readFile(file, 'utf8')
  const relative = path.relative(distRoot, file).split(path.sep).join('/')
  if (isAllowedRuntimeDependencyFile(relative)) continue
  if (/webpackBootstrap|__webpack_require__|sourceMappingURL|eval\s*\(/.test(source)) {
    throw new Error(`preload 不可审核：${relative}`)
  }
  const localRequire = createRequire(file)
  for (const match of source.matchAll(/\b(?:require|runtimeRequire)\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1]
    if (builtins.has(specifier) || hostRuntimeModules.has(specifier)) continue
    try { localRequire.resolve(specifier) } catch (error) {
      throw new Error(`${relative} 的依赖无法解析：${specifier}`, { cause: error })
    }
  }
}

const totalBytes = (await Promise.all(files.map((file) => stat(file)))).reduce((sum, info) => sum + info.size, 0)
if (totalBytes >= limitBytes) throw new Error(`dist ${totalBytes} bytes，必须严格小于 15 MiB`)
console.log(`Verified system-manager dist: ${files.length} files, ${totalBytes} bytes (< 15 MiB)`)
