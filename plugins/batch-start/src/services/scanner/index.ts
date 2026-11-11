import { listApps, mergeScannedApps, reconcileMissingPluginApps } from '../appLibrary'
import { getSettings, type ZtoolsDb } from '../db'
import { listGroups } from '../launchGroup'
import type { Platform } from '../../types'
import { rejectUninstallApps } from './filter'
import { createLinuxScanner } from './linux'
import { createMacScanner } from './mac'
import type { PlatformScanner, ScannedApp } from './types'
import { createWinScanner } from './win'
import {
  BATCH_START_MANAGE_CMDS,
  scanZtoolsCommands,
} from './ztoolsPlugins'

export type { PlatformScanner, ScannedApp } from './types'
export { createWinScanner } from './win'
export { createMacScanner } from './mac'
export { createLinuxScanner } from './linux'
export { isUninstallEntry, rejectUninstallApps } from './filter'
export {
  scanZtoolsCommands,
  scanZtoolsPlugins,
  listTextCmds,
  pickFirstLaunchCmd,
  commandAppPath,
  pluginAppPath,
  EXCLUDED_PLUGIN_NAMES,
  BATCH_START_MANAGE_CMDS,
  shouldSkipPlugin,
} from './ztoolsPlugins'

export function getScanner(platform: string = process.platform): PlatformScanner {
  switch (platform) {
    case 'darwin':
      return createMacScanner()
    case 'linux':
      return createLinuxScanner()
    case 'win32':
    default:
      return createWinScanner()
  }
}

function asPlatform(platform: string): Platform {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') return platform
  return 'win32'
}

/** Manage cmds + cmds from launch groups registered by this plugin */
export async function collectBatchStartOwnedCmds(db: ZtoolsDb): Promise<Set<string>> {
  const owned = new Set<string>(BATCH_START_MANAGE_CMDS)
  const groups = await listGroups(db)
  for (const group of groups) {
    for (const cmd of group.cmds) {
      const text = String(cmd).trim()
      if (text) owned.add(text)
    }
  }
  return owned
}

export type RunFullScanDeps = {
  scanner?: PlatformScanner
  now?: () => number
  /** Injected for tests; defaults to scanning plugin manifests for text cmds */
  scanZtoolsCommands?: (
    platform: Platform,
    excludeCmds?: Set<string>,
  ) => Promise<ScannedApp[]>
  /** @deprecated use scanZtoolsCommands */
  scanZtoolsPlugins?: (platform: Platform) => Promise<ScannedApp[]>
}

export async function runFullScan(
  db: ZtoolsDb,
  platform: string = process.platform,
  deps: RunFullScanDeps = {},
): Promise<Awaited<ReturnType<typeof mergeScannedApps>>> {
  const scanner = deps.scanner ?? getScanner(platform)
  const settings = await getSettings(db)
  const hostPlatform = asPlatform(platform)

  const scanned: ScannedApp[] = rejectUninstallApps([...(await scanner.scanSystem())])
  for (const dir of settings.customScanDirs) {
    scanned.push(...rejectUninstallApps(await scanner.scanCustomDir(dir)))
  }

  const excludeCmds = await collectBatchStartOwnedCmds(db)
  let commands: ScannedApp[]
  if (deps.scanZtoolsCommands) {
    commands = await deps.scanZtoolsCommands(hostPlatform, excludeCmds)
  } else if (deps.scanZtoolsPlugins) {
    commands = await deps.scanZtoolsPlugins(hostPlatform)
  } else {
    commands = await scanZtoolsCommands(hostPlatform, { excludeCmds })
  }
  scanned.push(...commands)

  await mergeScannedApps(db, scanned)
  await reconcileMissingPluginApps(
    db,
    commands.map((c) => c.path),
  )

  const lastScanAt = deps.now?.() ?? Date.now()
  await db.put({ ...settings, lastScanAt })
  return listApps(db)
}
