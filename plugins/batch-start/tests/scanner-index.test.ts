import { describe, expect, it } from 'vitest'
import { getSettings } from '../src/services/db'
import { listApps } from '../src/services/appLibrary'
import { runFullScan } from '../src/services/scanner'
import type { PlatformScanner, ScannedApp } from '../src/services/scanner/types'
import { createMemoryDb } from './mocks/memoryDb'

function stubScanner(apps: ScannedApp[], customByDir: Record<string, ScannedApp[]> = {}): PlatformScanner {
  return {
    async scanSystem() {
      return apps
    },
    async scanCustomDir(dir: string) {
      if (!(dir in customByDir) && dir.includes('Missing')) return []
      return customByDir[dir] ?? []
    },
  }
}

describe('runFullScan', () => {
  it('merges customScanDirs, sets lastScanAt, skips missing dirs', async () => {
    const db = createMemoryDb()
    await db.put({
      _id: 'settings',
      customScanDirs: ['C:/Apps', 'C:/Missing'],
      lastScanAt: null,
    })

    const scanner = stubScanner(
      [{ name: 'SystemApp', path: 'C:/System/App.exe', platform: 'win32' }],
      {
        'C:/Apps': [{ name: 'CustomApp', path: 'C:/Apps/custom.exe', platform: 'win32' }],
        'C:/Missing': [],
      },
    )

    const now = 1_700_000_000_000
    await runFullScan(db, 'win32', { scanner, now: () => now })

    const apps = await listApps(db)
    const paths = apps.map((a) => a.path.toLowerCase())
    expect(paths.some((p) => p.endsWith('app.exe'))).toBe(true)
    expect(paths.some((p) => p.endsWith('custom.exe'))).toBe(true)

    const settings = await getSettings(db)
    expect(settings.lastScanAt).toBe(now)
    expect(settings.customScanDirs).toEqual(['C:/Apps', 'C:/Missing'])
  })
})
