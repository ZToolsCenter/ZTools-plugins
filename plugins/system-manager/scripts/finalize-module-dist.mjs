import { cp, lstat, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { inside, modules, root } from './config.mjs'
import { verifyRuntimeDependencyDirectory } from './runtime-dependency-integrity.mjs'

const moduleId = process.argv[2]
const module = modules.find((item) => item.id === moduleId)
if (!module) {
  throw new Error(`未知系统管家模块：${moduleId || '<empty>'}`)
}

const dist = inside(root, 'modules', moduleId, 'dist')
const manifest = inside(dist, 'plugin.json')
const release = inside(root, 'modules', moduleId, 'release')
const info = await lstat(manifest)
if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${moduleId} 的中间 manifest 不是安全普通文件`)
const packageLock = JSON.parse(await readFile(inside(root, 'package-lock.json'), 'utf8'))

for (const dependency of module.runtimeDependencies || []) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(dependency)) throw new Error(`${moduleId} 运行依赖名称无效：${dependency}`)
  const segments = dependency.split('/')
  const source = inside(root, 'node_modules', ...segments)
  const destination = inside(dist, 'preload', 'node_modules', ...segments)
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error(`${dependency} 不是安全普通依赖目录`)
  const declared = JSON.parse(await readFile(inside(root, 'modules', moduleId, 'package.json'), 'utf8')).dependencies?.[dependency]
  const packageJson = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'))
  const locked = packageLock.packages?.[`node_modules/${dependency}`]
  if (declared !== packageJson.version || packageJson.name !== dependency) {
    throw new Error(`${dependency} 必须以精确版本声明并与安装内容一致`)
  }
  if (!locked?.integrity || locked.version !== packageJson.version) {
    throw new Error(`${dependency} 缺少匹配的根锁文件 integrity`)
  }
  for (const script of ['preinstall', 'install', 'postinstall']) {
    if (packageJson.scripts?.[script]) throw new Error(`${dependency} 禁止包含 ${script} 生命周期脚本`)
  }
  await verifyRuntimeDependencyDirectory({
    directory: source,
    dependency,
    version: packageJson.version,
    packageIntegrity: locked.integrity
  })
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true })
  await verifyRuntimeDependencyDirectory({
    directory: destination,
    dependency,
    version: packageJson.version,
    packageIntegrity: locked.integrity
  })
}

await rm(manifest)
await rm(release, { recursive: true, force: true })

console.log(`[system-manager] Finalized internal module dist: ${moduleId}`)
