import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const publicRoot = path.join(root, 'public')
export const distRoot = path.join(root, 'dist')
export const releaseRoot = path.join(root, 'release')
export const limitBytes = 15 * 1024 * 1024

export const modules = Object.freeze([
  Object.freeze({
    id: 'system-diagnostic-report',
    sourcePreload: 'preload/services.cjs',
    finalPreload: 'preload/services.cjs',
    bridge: 'systemReport',
    runtimeDependencies: Object.freeze(['systeminformation']),
  }),
  Object.freeze({
    id: 'application-uninstaller',
    sourcePreload: 'preload/services.cjs',
    finalPreload: 'preload/services.cjs',
    bridge: 'applicationUninstaller',
  }),
  Object.freeze({
    id: 'startup-manager',
    sourcePreload: 'preload/services.js',
    finalPreload: 'preload/services.cjs',
    bridge: 'startupManager',
  }),
  Object.freeze({
    id: 'system-cleaner',
    sourcePreload: 'preload/services.js',
    finalPreload: 'preload/services.cjs',
    bridge: 'systemCleaner',
  }),
  Object.freeze({
    id: 'lan-device-discovery',
    sourcePreload: 'preload/services.js',
    finalPreload: 'preload/services.cjs',
    bridge: 'lanDiscovery',
  }),
])

const strictSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export function requireStrictSemver(value) {
  if (typeof value !== 'string' || !strictSemver.test(value)) throw new Error(`版本号不是严格 SemVer：${value}`)
  return value
}

export function inside(base, ...parts) {
  const target = path.resolve(base, ...parts)
  const relative = path.relative(base, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径越过允许边界：${parts.join('/')}`)
  }
  return target
}
