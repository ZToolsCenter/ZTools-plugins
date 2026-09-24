import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const manifestRoot = fileURLToPath(new URL('./runtime-integrity/', import.meta.url))
const dependencyPattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const digestPattern = /^[a-f0-9]{64}$/

function manifestName(dependency, version) {
  if (!dependencyPattern.test(dependency) || !versionPattern.test(version)) {
    throw new Error(`运行依赖完整性标识无效：${dependency}@${version}`)
  }
  return `${dependency.replace(/^@/, '').replace('/', '__')}-${version}.json`
}

async function walkFiles(directory, relative = '') {
  const output = []
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error(`运行依赖禁止符号链接：${childRelative}`)
    if (info.isDirectory()) output.push(...await walkFiles(target, childRelative))
    else if (info.isFile()) output.push({ relative: childRelative, target })
    else throw new Error(`运行依赖包含非常规文件：${childRelative}`)
  }
  return output
}

export async function loadRuntimeIntegrityManifest({ dependency, version, packageIntegrity }) {
  const target = path.join(manifestRoot, manifestName(dependency, version))
  const manifest = JSON.parse(await readFile(target, 'utf8'))
  if (manifest.name !== dependency || manifest.version !== version || manifest.packageIntegrity !== packageIntegrity) {
    throw new Error(`${dependency}@${version} 的逐文件清单未绑定当前锁文件 integrity`)
  }
  if (!manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object') {
    throw new Error(`${dependency}@${version} 的逐文件清单无效`)
  }
  for (const [relative, digest] of Object.entries(manifest.files)) {
    if (!relative || path.isAbsolute(relative) || relative.includes('\\') || path.posix.normalize(relative) !== relative || relative.startsWith('../') || !digestPattern.test(digest)) {
      throw new Error(`${dependency}@${version} 的逐文件清单条目无效：${relative}`)
    }
  }
  return manifest
}

export async function verifyRuntimeDependencyDirectory({ directory, dependency, version, packageIntegrity }) {
  const manifest = await loadRuntimeIntegrityManifest({ dependency, version, packageIntegrity })
  const files = await walkFiles(directory)
  const actualNames = files.map((file) => file.relative)
  const expectedNames = Object.keys(manifest.files).sort((left, right) => left.localeCompare(right, 'en'))
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    const unexpected = actualNames.filter((name) => !manifest.files[name])
    const missing = expectedNames.filter((name) => !actualNames.includes(name))
    throw new Error(`${dependency}@${version} 文件集合不匹配（额外：${unexpected.join(', ') || '无'}；缺少：${missing.join(', ') || '无'}）`)
  }
  for (const file of files) {
    const digest = createHash('sha256').update(await readFile(file.target)).digest('hex')
    if (digest !== manifest.files[file.relative]) {
      throw new Error(`${dependency}@${version} 文件哈希不匹配：${file.relative}`)
    }
  }
  return { files: files.length }
}
