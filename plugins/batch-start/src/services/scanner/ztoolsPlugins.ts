import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Platform } from '../../types'
import type { ScannedApp } from './types'

/** One list item per divertible text command */
export const CMD_URI_PREFIX = 'ztools-cmd://'
/** Legacy per-plugin URI from 0.1.1 — treated as stale */
export const LEGACY_PLUGIN_URI_PREFIX = 'ztools-plugin://'

export const EXCLUDED_PLUGIN_NAMES = new Set(['setting', 'system', 'batch-start'])

/** Static manage cmds declared in batch-start plugin.json */
export const BATCH_START_MANAGE_CMDS = new Set(['批量启动', '应用启动组'])

/** Skip setting/system, batch-start (and variants), and title「批量启动」 */
export function shouldSkipPlugin(pluginName: string, pluginTitle?: string): boolean {
  const name = pluginName.trim().toLowerCase()
  if (name === 'setting' || name === 'system') return true
  if (name === 'batch-start' || name.startsWith('batch-start')) return true
  if (EXCLUDED_PLUGIN_NAMES.has(name)) return true
  if (pluginTitle?.trim() === '批量启动') return true
  return false
}

/** @deprecated use shouldSkipPlugin */
export function isExcludedBatchStartPlugin(pluginName: string, pluginTitle?: string): boolean {
  return shouldSkipPlugin(pluginName, pluginTitle)
}

export function commandAppPath(pluginName: string, cmd: string): string {
  return `${CMD_URI_PREFIX}${pluginName}/${encodeURIComponent(cmd)}`
}

export function isZtoolsCommandPath(appPath: string): boolean {
  const lower = appPath.toLowerCase()
  return lower.startsWith(CMD_URI_PREFIX) || lower.startsWith(LEGACY_PLUGIN_URI_PREFIX)
}

/** @deprecated use commandAppPath */
export function pluginAppPath(pluginName: string): string {
  return `${LEGACY_PLUGIN_URI_PREFIX}${pluginName}`
}

/** @deprecated use isZtoolsCommandPath */
export function isPluginAppPath(appPath: string): boolean {
  return isZtoolsCommandPath(appPath)
}

export type ListTextCmdsOptions = {
  /** Extra cmd strings to skip (e.g. launch-group cmds registered by this plugin) */
  excludeCmds?: Set<string> | ReadonlySet<string>
  /** Skip features whose code starts with group: (dynamic launch-group features) */
  skipGroupFeatures?: boolean
}

export function listTextCmds(features: unknown, options: ListTextCmdsOptions = {}): string[] {
  if (!Array.isArray(features)) return []
  const exclude = options.excludeCmds
  const skipGroup = options.skipGroupFeatures !== false
  const seen = new Set<string>()
  const cmds: string[] = []
  for (const feature of features) {
    const code = (feature as { code?: unknown })?.code
    if (skipGroup && typeof code === 'string' && code.startsWith('group:')) continue
    const list = (feature as { cmds?: unknown })?.cmds
    if (!Array.isArray(list)) continue
    for (const cmd of list) {
      if (typeof cmd !== 'string') continue
      const text = cmd.trim()
      if (!text || seen.has(text)) continue
      if (BATCH_START_MANAGE_CMDS.has(text)) continue
      if (exclude?.has(text)) continue
      seen.add(text)
      cmds.push(text)
    }
  }
  return cmds
}

/** @deprecated use listTextCmds()[0] */
export function pickFirstLaunchCmd(features: unknown): string | null {
  return listTextCmds(features)[0] ?? null
}

type PluginJson = {
  name?: string
  title?: string
  version?: string
  logo?: string
  features?: unknown
}

export type InstalledPluginInfo = {
  name: string
  title: string
  path: string
  version?: string
  logo?: string
  features?: unknown
}

export type ScanZtoolsCommandsDeps = {
  pluginsRoot?: string
  readDir?: (dir: string) => Promise<string[]>
  readFile?: (file: string, encoding: 'utf-8') => Promise<string>
  access?: (file: string) => Promise<void>
  /** Cmds to exclude (batch-start manage cmds + registered launch-group cmds) */
  excludeCmds?: Set<string> | ReadonlySet<string>
  /**
   * Preferred source of truth: currently installed plugins from ZTools registry.
   * When provided (or auto-loaded via ztools.internal), disk leftovers are ignored.
   */
  listInstalledPlugins?: () => Promise<InstalledPluginInfo[] | null>
}

async function resolveLogoIcon(
  pluginDir: string,
  logo: string | undefined,
  access: (file: string) => Promise<void>,
): Promise<string | null> {
  if (!logo || logo.includes('://')) return null
  const logoPath = path.isAbsolute(logo) ? logo : path.join(pluginDir, logo)
  try {
    await access(logoPath)
    return pathToFileURL(logoPath).href
  } catch {
    return null
  }
}

function stableCmdId(pluginName: string, cmd: string): string {
  return `cmd:${pluginName}:${encodeURIComponent(cmd)}`
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Parse version from artifact name like `foo-1.2.3-abcd1234.asar` */
export function versionFromArtifactName(entry: string): string | null {
  const base = entry.replace(/\.asar$/i, '')
  const m = base.match(/-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-[0-9a-f]{6,}$/i)
  return m?.[1] ?? null
}

/**
 * Load installed plugins from ZTools host registry (requires internal API privilege).
 * Returns null when unavailable / denied — callers should fall back carefully.
 */
export async function loadInstalledPluginsFromHost(): Promise<InstalledPluginInfo[] | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const z = (globalThis as any).ztools ?? (typeof window !== 'undefined' ? (window as any).ztools : null)
    if (!z?.internal) return null
    const raw =
      (await z.internal.getPlugins?.()) ?? (await z.internal.getAllPlugins?.()) ?? null
    if (!Array.isArray(raw)) return null
    const installed: InstalledPluginInfo[] = []
    for (const p of raw as Record<string, unknown>[]) {
      const name = typeof p.name === 'string' ? p.name.trim() : ''
      if (!name) continue
      const info: InstalledPluginInfo = {
        name,
        title: typeof p.title === 'string' && p.title.trim() ? p.title.trim() : name,
        path: typeof p.path === 'string' ? p.path : '',
        features: p.features,
      }
      if (typeof p.version === 'string') info.version = p.version
      if (typeof p.logo === 'string') info.logo = p.logo
      installed.push(info)
    }
    return installed
  } catch {
    return null
  }
}

function appsFromPlugin(
  platform: Platform,
  plugin: {
    name: string
    title: string
    path: string
    logo?: string | null
    features?: unknown
  },
  excludeCmds: Set<string> | ReadonlySet<string> | undefined,
  icon: string | null,
): ScannedApp[] {
  if (shouldSkipPlugin(plugin.name, plugin.title)) return []
  const cmds = listTextCmds(plugin.features, {
    excludeCmds,
    skipGroupFeatures: true,
  })
  return cmds.map((cmd) => ({
    name: cmd,
    path: commandAppPath(plugin.name, cmd),
    platform,
    icon,
    source: 'ztools' as const,
    pluginName: plugin.name,
    pluginTitle: plugin.title,
    launchCmd: cmd,
    stableIdHint: stableCmdId(plugin.name, cmd),
  }))
}

async function readPluginJson(
  pluginPath: string,
  readFile: (file: string, encoding: 'utf-8') => Promise<string>,
): Promise<PluginJson | null> {
  try {
    const raw = await readFile(path.join(pluginPath, 'plugin.json'), 'utf-8')
    return JSON.parse(raw) as PluginJson
  } catch {
    return null
  }
}

/**
 * Disk fallback: read directory plugins + `.asar` packages.
 * Skips `.asar.unpacked` / `.installing`. Dedupes by plugin name (newest version wins)
 * so upgrade leftovers don't flood the list — but cannot know "uninstalled" without registry.
 */
export async function scanPluginsFromDisk(
  platform: Platform,
  deps: ScanZtoolsCommandsDeps = {},
): Promise<ScannedApp[]> {
  const pluginsRoot = deps.pluginsRoot ?? path.join(os.homedir(), '.ztools', 'plugins')
  const readDir = deps.readDir ?? ((dir) => fs.readdir(dir))
  const readFile = deps.readFile ?? ((file, enc) => fs.readFile(file, enc))
  const access = deps.access ?? ((file) => fs.access(file))

  let entries: string[]
  try {
    entries = await readDir(pluginsRoot)
  } catch {
    return []
  }

  type Cand = {
    name: string
    title: string
    version: string
    root: string
    logo?: string
    features?: unknown
  }
  const bestByName = new Map<string, Cand>()

  for (const entry of entries) {
    if (entry === '.installing' || entry.endsWith('.asar.unpacked')) continue
    const root = path.join(pluginsRoot, entry)
    const json = await readPluginJson(root, readFile)
    if (!json) continue

    const pluginName = typeof json.name === 'string' ? json.name.trim() : ''
    if (!pluginName || shouldSkipPlugin(pluginName, json.title)) continue

    const title =
      typeof json.title === 'string' && json.title.trim() ? json.title.trim() : pluginName
    const version =
      (typeof json.version === 'string' && json.version.trim()) ||
      versionFromArtifactName(entry) ||
      '0.0.0'

    const prev = bestByName.get(pluginName)
    if (prev && compareSemver(version, prev.version) < 0) continue

    bestByName.set(pluginName, {
      name: pluginName,
      title,
      version,
      root,
      logo: typeof json.logo === 'string' ? json.logo : undefined,
      features: json.features,
    })
  }

  const results: ScannedApp[] = []
  for (const cand of bestByName.values()) {
    const icon = await resolveLogoIcon(cand.root, cand.logo, access)
    results.push(
      ...appsFromPlugin(
        platform,
        {
          name: cand.name,
          title: cand.title,
          path: cand.root,
          logo: cand.logo,
          features: cand.features,
        },
        deps.excludeCmds,
        icon,
      ),
    )
  }
  return results
}

/**
 * Discover ZTools text commands for **currently installed** plugins when possible.
 * Prefers ZTools registry via `ztools.internal.getPlugins` so uninstalled leftovers
 * under ~/.ztools/plugins are ignored.
 */
export async function scanZtoolsCommands(
  platform: Platform,
  deps: ScanZtoolsCommandsDeps = {},
): Promise<ScannedApp[]> {
  const listInstalled = deps.listInstalledPlugins ?? loadInstalledPluginsFromHost
  const installed = await listInstalled()

  // Registry is authoritative when available (including empty = no installed plugins).
  if (installed !== null) {
    const results: ScannedApp[] = []
    const readFile = deps.readFile ?? ((file, enc) => fs.readFile(file, enc))
    const access = deps.access ?? ((file) => fs.access(file))

    for (const plugin of installed) {
      if (shouldSkipPlugin(plugin.name, plugin.title)) continue

      let features = plugin.features
      let logo = plugin.logo
      // Registry entries usually already include features; refill from disk/asar if missing.
      if (!Array.isArray(features) || features.length === 0) {
        if (!plugin.path) continue
        const json = await readPluginJson(plugin.path, readFile)
        if (!json) continue
        features = json.features
        if (!logo && typeof json.logo === 'string') logo = json.logo
      }

      const icon =
        logo && logo.includes('://')
          ? logo
          : plugin.path
            ? await resolveLogoIcon(plugin.path, logo, access)
            : null

      results.push(
        ...appsFromPlugin(
          platform,
          {
            name: plugin.name,
            title: plugin.title,
            path: plugin.path,
            logo,
            features,
          },
          deps.excludeCmds,
          icon,
        ),
      )
    }
    return results
  }

  return scanPluginsFromDisk(platform, deps)
}

/** @deprecated alias */
export const scanZtoolsPlugins = scanZtoolsCommands
export type ScanZtoolsPluginsDeps = ScanZtoolsCommandsDeps
