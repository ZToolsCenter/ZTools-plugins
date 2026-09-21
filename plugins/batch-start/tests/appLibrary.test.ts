import { describe, it, expect } from 'vitest'
import {
  upsertApp,
  listApps,
  mergeScannedApps,
  reconcileMissingPluginApps,
} from '../src/services/appLibrary'
import { makeAppId } from '../src/services/db'
import { commandAppPath, pluginAppPath } from '../src/services/scanner/ztoolsPlugins'
import { createMemoryDb } from './mocks/memoryDb'

describe('appLibrary', () => {
  it('mergeScannedApps keeps categoryId on path match', async () => {
    const db = createMemoryDb()
    await upsertApp(db, {
      _id: makeAppId('1'),
      name: 'Old',
      path: 'C:/Tool/a.exe',
      source: 'scan',
      categoryId: 'category:x',
      platform: 'win32',
    })
    await mergeScannedApps(db, [
      { name: 'New', path: 'C:/Tool/a.exe', platform: 'win32' },
    ])
    const apps = await listApps(db)
    expect(apps).toHaveLength(1)
    expect(apps[0].categoryId).toBe('category:x')
    expect(apps[0].name).toBe('New')
  })

  it('mergeScannedApps matches paths case-insensitively', async () => {
    const db = createMemoryDb()
    await upsertApp(db, {
      _id: makeAppId('1'),
      name: 'Old',
      path: 'C:/Tool/a.exe',
      source: 'scan',
      categoryId: 'category:x',
      platform: 'win32',
    })
    await mergeScannedApps(db, [
      { name: 'New', path: 'c:/tool/A.exe', platform: 'win32' },
    ])
    const apps = await listApps(db)
    expect(apps).toHaveLength(1)
    expect(apps[0].categoryId).toBe('category:x')
    expect(apps[0].name).toBe('New')
  })

  it('mergeScannedApps upserts ztools commands with stable ids', async () => {
    const db = createMemoryDb()
    const path = commandAppPath('colors', '颜色助手')
    await mergeScannedApps(db, [
      {
        name: '颜色助手',
        path,
        platform: 'win32',
        source: 'ztools',
        pluginName: 'colors',
        pluginTitle: '调色板',
        launchCmd: '颜色助手',
        stableIdHint: `cmd:colors:${encodeURIComponent('颜色助手')}`,
      },
    ])
    await mergeScannedApps(db, [
      {
        name: '颜色助手',
        path,
        platform: 'win32',
        source: 'ztools',
        pluginName: 'colors',
        pluginTitle: '调色板',
        launchCmd: '颜色助手',
        stableIdHint: `cmd:colors:${encodeURIComponent('颜色助手')}`,
      },
    ])
    const apps = await listApps(db)
    expect(apps).toHaveLength(1)
    expect(apps[0]._id).toBe(makeAppId(`cmd:colors:${encodeURIComponent('颜色助手')}`))
    expect(apps[0].source).toBe('ztools')
    expect(apps[0].launchCmd).toBe('颜色助手')
  })

  it('reconcile removes missing cmds and legacy plugin rows', async () => {
    const db = createMemoryDb()
    const keepPath = commandAppPath('colors', '颜色助手')
    const gonePath = commandAppPath('colors', 'gone')
    await mergeScannedApps(db, [
      {
        name: '颜色助手',
        path: keepPath,
        platform: 'win32',
        source: 'ztools',
        pluginName: 'colors',
        launchCmd: '颜色助手',
      },
      {
        name: 'gone',
        path: gonePath,
        platform: 'win32',
        source: 'ztools',
        pluginName: 'colors',
        launchCmd: 'gone',
      },
    ])
    // legacy per-plugin row
    await upsertApp(db, {
      _id: makeAppId('plugin:legacy'),
      name: 'Legacy',
      path: pluginAppPath('legacy'),
      source: 'plugin',
      categoryId: null,
      platform: 'win32',
      launchCmd: 'x',
    })

    const apps = await listApps(db)
    const keep = apps.find((a) => a.launchCmd === '颜色助手')!
    const gone = apps.find((a) => a.launchCmd === 'gone')!
    const legacy = apps.find((a) => a.source === 'plugin')!
    await db.put({
      _id: 'group:1',
      name: '工作',
      cmds: ['work'],
      appIds: [keep._id, gone._id, legacy._id],
      order: 0,
      featureSynced: true,
    })

    await reconcileMissingPluginApps(db, [keepPath])
    const after = await listApps(db)
    expect(after.map((a) => a.launchCmd)).toEqual(['颜色助手'])
    const group = (await db.get('group:1')) as { appIds: string[]; featureSynced: boolean }
    expect(group.appIds).toEqual([keep._id])
    expect(group.featureSynced).toBe(false)
  })
})
