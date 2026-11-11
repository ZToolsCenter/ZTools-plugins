import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PlatformScanner, ScannedApp } from './types'

export type LinuxStatLike = {
  isFile(): boolean
  isDirectory(): boolean
  mode?: number
}

export type LinuxScannerDeps = {
  readdir?: (dir: string) => Promise<string[]>
  stat?: (filePath: string) => Promise<LinuxStatLike>
  readFile?: (filePath: string, encoding?: BufferEncoding) => Promise<string>
  homedir?: () => string
  join?: (...parts: string[]) => string
}

function isSkippableScanError(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false
  const code = (err as { code?: string }).code
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM'
}

function isExecutable(st: LinuxStatLike): boolean {
  return typeof st.mode === 'number' && (st.mode & 0o111) !== 0
}

/** Strip desktop Exec field codes and return the first command token. */
export function parseDesktopExec(execLine: string): string | null {
  const stripped = execLine.replace(/%[fFuUdDnNickvm]/g, '').trim()
  if (!stripped) return null

  if (stripped.startsWith('"')) {
    const end = stripped.indexOf('"', 1)
    if (end > 1) return stripped.slice(1, end)
  }

  const token = stripped.split(/\s+/)[0]
  return token || null
}

export function parseDesktopFile(content: string): { name: string; exec: string } | null {
  const lines = content.split(/\r?\n/)
  let inEntry = false
  let name: string | undefined
  let exec: string | undefined

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]'
      continue
    }
    if (!inEntry) continue

    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq)
    const value = line.slice(eq + 1)
    if (key === 'Name' && name === undefined) name = value
    if (key === 'Exec' && exec === undefined) exec = value
  }

  if (!name || !exec) return null
  const parsedExec = parseDesktopExec(exec)
  if (!parsedExec) return null
  return { name, exec: parsedExec }
}

export function createLinuxScanner(deps: LinuxScannerDeps = {}): PlatformScanner {
  const readdir = deps.readdir ?? ((dir) => fs.readdir(dir))
  const stat = deps.stat ?? ((filePath) => fs.stat(filePath))
  const readFile =
    deps.readFile ?? ((filePath, encoding = 'utf8') => fs.readFile(filePath, encoding))
  const homedir = deps.homedir ?? (() => os.homedir())
  const join = deps.join ?? path.join

  async function scanDesktopDir(dir: string): Promise<ScannedApp[]> {
    const out: ScannedApp[] = []

    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (err) {
      if (isSkippableScanError(err)) return []
      throw err
    }

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.desktop')) continue
      const full = join(dir, entry)
      let st: LinuxStatLike
      try {
        st = await stat(full)
      } catch (err) {
        if (isSkippableScanError(err)) continue
        throw err
      }
      if (!st.isFile()) continue

      let content: string
      try {
        content = await readFile(full, 'utf8')
      } catch (err) {
        if (isSkippableScanError(err)) continue
        throw err
      }

      const parsed = parseDesktopFile(content)
      if (!parsed) continue
      out.push({
        name: parsed.name,
        path: parsed.exec,
        platform: 'linux',
      })
    }

    return out
  }

  async function scanExecutables(dir: string): Promise<ScannedApp[]> {
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
      let st: LinuxStatLike
      try {
        st = await stat(full)
      } catch (err) {
        if (isSkippableScanError(err)) continue
        throw err
      }
      if (!st.isFile() || !isExecutable(st)) continue
      out.push({
        name: entry,
        path: full,
        platform: 'linux',
      })
    }

    return out
  }

  return {
    async scanSystem() {
      const roots = [
        '/usr/share/applications',
        join(homedir(), '.local', 'share', 'applications'),
      ]
      const apps: ScannedApp[] = []
      for (const root of roots) {
        apps.push(...(await scanDesktopDir(root)))
      }
      return apps
    },

    async scanCustomDir(dir: string) {
      try {
        return await scanExecutables(dir)
      } catch (err) {
        if (isSkippableScanError(err)) return []
        throw err
      }
    },
  }
}
