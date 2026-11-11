import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PlatformScanner, ScannedApp } from './types'
import { isUninstallEntry, rejectUninstallApps } from './filter'

const execFileAsync = promisify(execFile)

const CUSTOM_MAX_DEPTH = 4
const LAUNCH_EXTS = new Set(['.exe', '.bat', '.cmd', '.lnk'])
/** Resolve shortcuts in batches to avoid one PowerShell process per .lnk */
const LNK_BATCH_SIZE = 80

export type WinDirentLike = {
  name: string
  isFile(): boolean
  isDirectory(): boolean
}

export type WinScannerDeps = {
  readdir?: (dir: string) => Promise<WinDirentLike[]>
  resolveLnks?: (lnkPaths: string[]) => Promise<Map<string, string>>
  env?: NodeJS.ProcessEnv
  join?: (...parts: string[]) => string
}

function displayName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

function isSkippableScanError(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false
  const code = (err as { code?: string }).code
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM'
}

/**
 * Batch-resolve .lnk targets via one PowerShell process.
 * Names come from Node paths (correct Unicode); only TargetPath is read from COM.
 * Results are written to a UTF-8 file to avoid GBK console mojibake on Chinese Windows.
 */
export async function defaultResolveLnks(lnkPaths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (lnkPaths.length === 0) return map

  for (let i = 0; i < lnkPaths.length; i += LNK_BATCH_SIZE) {
    const chunk = lnkPaths.slice(i, i + LNK_BATCH_SIZE)
    const part = await resolveLnkChunk(chunk)
    for (const [k, v] of part) map.set(k, v)
  }
  return map
}

async function resolveLnkChunk(lnkPaths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-lnk-'))
  const inFile = path.join(tmpDir, 'in.json')
  const outFile = path.join(tmpDir, 'out.json')

  try {
    await fs.writeFile(inFile, JSON.stringify(lnkPaths), 'utf8')

    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$inFile = ${JSON.stringify(inFile)}
$outFile = ${JSON.stringify(outFile)}
$utf8 = New-Object System.Text.UTF8Encoding $false
$raw = [System.IO.File]::ReadAllText($inFile, $utf8)
$paths = $raw | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
$list = New-Object System.Collections.Generic.List[object]
foreach ($p in $paths) {
  try {
    $s = $shell.CreateShortcut([string]$p)
    $t = [string]$s.TargetPath
    if (-not [string]::IsNullOrWhiteSpace($t)) {
      $list.Add([pscustomobject]@{ path = [string]$p; target = $t }) | Out-Null
    }
  } catch {}
}
$json = ($list | ConvertTo-Json -Compress -Depth 3)
if (-not $json) { $json = '[]' }
if ($json[0] -ne '[') { $json = '[' + $json + ']' }
[System.IO.File]::WriteAllText($outFile, $json, $utf8)
`

    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )

    const outRaw = await fs.readFile(outFile, 'utf8')
    const parsed = JSON.parse(outRaw || '[]') as Array<{ path?: string; target?: string }>
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    for (const row of rows) {
      if (row?.path && row?.target) map.set(row.path, row.target)
    }
  } catch {
    // batch failed — leave map empty for this chunk
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }

  return map
}

async function defaultReaddir(dir: string): Promise<WinDirentLike[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries.map((e) => ({
    name: e.name,
    isFile: () => e.isFile(),
    isDirectory: () => e.isDirectory(),
  }))
}

export function createWinScanner(deps: WinScannerDeps = {}): PlatformScanner {
  const readdir = deps.readdir ?? defaultReaddir
  const resolveLnks = deps.resolveLnks ?? defaultResolveLnks
  const env = deps.env ?? process.env
  const join = deps.join ?? path.join

  async function collectEntries(
    dir: string,
    options: { maxDepth: number; lnkOnly: boolean },
  ): Promise<{ files: ScannedApp[]; lnkPaths: string[] }> {
    const files: ScannedApp[] = []
    const lnkPaths: string[] = []

    async function walk(current: string, depth: number): Promise<void> {
      if (depth > options.maxDepth) return

      let entries: WinDirentLike[]
      try {
        entries = await readdir(current)
      } catch (err) {
        if (isSkippableScanError(err)) return
        throw err
      }

      const subdirs: string[] = []
      for (const entry of entries) {
        const full = join(current, entry.name)
        if (entry.isDirectory()) {
          subdirs.push(full)
          continue
        }
        if (!entry.isFile()) continue

        const ext = path.extname(entry.name).toLowerCase()
        if (options.lnkOnly) {
          if (ext !== '.lnk') continue
        } else if (!LAUNCH_EXTS.has(ext)) {
          continue
        }

        if (ext === '.lnk') {
          // Skip uninstall shortcuts before expensive COM resolve
          if (isUninstallEntry(displayName(entry.name), full)) continue
          lnkPaths.push(full)
        } else {
          const name = displayName(entry.name)
          if (isUninstallEntry(name, full)) continue
          files.push({
            name,
            path: full,
            platform: 'win32',
          })
        }
      }

      // Walk subdirectories with limited concurrency
      const CONCURRENCY = 8
      for (let i = 0; i < subdirs.length; i += CONCURRENCY) {
        const batch = subdirs.slice(i, i + CONCURRENCY)
        await Promise.all(batch.map((d) => walk(d, depth + 1)))
      }
    }

    await walk(dir, 0)
    return { files, lnkPaths }
  }

  async function collectFromDir(
    dir: string,
    options: { maxDepth: number; lnkOnly: boolean },
  ): Promise<ScannedApp[]> {
    const { files, lnkPaths } = await collectEntries(dir, options)
    if (lnkPaths.length === 0) return files

    const targets = await resolveLnks(lnkPaths)
    const fromLnks: ScannedApp[] = []
    for (const lnk of lnkPaths) {
      const target = targets.get(lnk)
      if (!target) continue
      const name = displayName(lnk)
      if (isUninstallEntry(name, target)) continue
      // Display name from Node path — preserves Chinese correctly
      fromLnks.push({
        name,
        path: target,
        platform: 'win32',
      })
    }
    return rejectUninstallApps([...files, ...fromLnks])
  }

  return {
    async scanSystem() {
      const roots: string[] = []
      if (env.APPDATA) {
        roots.push(join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
      }
      const programData = env.ProgramData ?? env.PROGRAMDATA
      if (programData) {
        roots.push(join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
      }

      const results = await Promise.all(
        roots.map((root) =>
          collectFromDir(root, { maxDepth: Number.POSITIVE_INFINITY, lnkOnly: true }),
        ),
      )
      return results.flat()
    },

    async scanCustomDir(dir: string) {
      try {
        return await collectFromDir(dir, { maxDepth: CUSTOM_MAX_DEPTH, lnkOnly: false })
      } catch (err) {
        if (isSkippableScanError(err)) return []
        throw err
      }
    },
  }
}
