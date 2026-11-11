import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PlatformScanner, ScannedApp } from './types'

export type MacStatLike = {
  isFile(): boolean
  isDirectory(): boolean
  mode?: number
}

export type MacScannerDeps = {
  readdir?: (dir: string) => Promise<string[]>
  stat?: (filePath: string) => Promise<MacStatLike>
  homedir?: () => string
  join?: (...parts: string[]) => string
}

function isSkippableScanError(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false
  const code = (err as { code?: string }).code
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM'
}

function isExecutable(st: MacStatLike): boolean {
  return typeof st.mode === 'number' && (st.mode & 0o111) !== 0
}

function appNameFromBundle(bundlePath: string): string {
  return path.basename(bundlePath, '.app')
}

export function createMacScanner(deps: MacScannerDeps = {}): PlatformScanner {
  const readdir = deps.readdir ?? ((dir) => fs.readdir(dir))
  const stat = deps.stat ?? ((filePath) => fs.stat(filePath))
  const homedir = deps.homedir ?? (() => os.homedir())
  const join = deps.join ?? path.join

  async function collectApps(
    dir: string,
    options: { includeExecutables: boolean },
  ): Promise<ScannedApp[]> {
    const out: ScannedApp[] = []

    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (err) {
      if (isSkippableScanError(err)) return []
      throw err
    }

    for (const entry of entries) {
      const full = join(dir, entry)
      let st: MacStatLike
      try {
        st = await stat(full)
      } catch (err) {
        if (isSkippableScanError(err)) continue
        throw err
      }

      if (st.isDirectory() && entry.toLowerCase().endsWith('.app')) {
        out.push({
          name: appNameFromBundle(full),
          path: full,
          platform: 'darwin',
        })
        continue
      }

      if (options.includeExecutables && st.isFile() && isExecutable(st)) {
        out.push({
          name: entry,
          path: full,
          platform: 'darwin',
        })
      }
    }

    return out
  }

  return {
    async scanSystem() {
      const roots = ['/Applications', join(homedir(), 'Applications')]
      const apps: ScannedApp[] = []
      for (const root of roots) {
        apps.push(...(await collectApps(root, { includeExecutables: false })))
      }
      return apps
    },

    async scanCustomDir(dir: string) {
      try {
        return await collectApps(dir, { includeExecutables: true })
      } catch (err) {
        if (isSkippableScanError(err)) return []
        throw err
      }
    },
  }
}
