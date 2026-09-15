import path from 'node:path'
import {
  assignCategory as assignCategorySvc,
  listApps as listAppsSvc,
  upsertApp,
} from './services/appLibrary'
import {
  createCategory as createCategorySvc,
  deleteCategory as deleteCategorySvc,
  listCategories as listCategoriesSvc,
  renameCategory as renameCategorySvc,
} from './services/category'
import {
  getDb,
  getSettings as getSettingsSvc,
  makeAppId,
  newId,
  type ZtoolsDb,
} from './services/db'
import { routePluginEnter } from './services/enterRouter'
import {
  reconcileFeatures,
  removeGroupFeature,
  syncGroupFeature,
  type FeatureApi,
} from './services/featureSync'
import {
  deleteGroup as deleteGroupSvc,
  getGroup,
  listGroups as listGroupsSvc,
  saveGroup as saveGroupSvc,
  type GroupInput,
} from './services/launchGroup'
import { launchGroupApps } from './services/launcher'
import { runFullScan } from './services/scanner'
import type {
  AppDoc,
  CategoryDoc,
  GroupDoc,
  LaunchResult,
  Platform,
  SettingsDoc,
} from './types'

type ZtoolsHost = {
  db: { promises: ZtoolsDb }
  setFeature: FeatureApi['setFeature']
  removeFeature: FeatureApi['removeFeature']
  getFeatures: FeatureApi['getFeatures']
  showOpenDialog: (options: Record<string, unknown>) => string[] | undefined
  showToast: (message: string, options?: Record<string, unknown>) => Promise<unknown> | unknown
  outPlugin: (isKill?: boolean) => Promise<unknown> | unknown
  onPluginEnter: (callback: (param: { code?: string }) => void) => void
  onPluginOut: (callback: (isKill: boolean) => void) => void
  shellOpenPath: (fullPath: string) =>
    | Promise<{ success: boolean; error?: string }>
    | { success: boolean; error?: string }
  getFileIcon?: (filePath: string) => string | null
}

function host(): ZtoolsHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).ztools ?? (window as any).ztools
}

function db(): ZtoolsDb {
  return getDb()
}

function featureApi(): FeatureApi {
  const z = host()
  return {
    setFeature: (feature) => z.setFeature(feature),
    removeFeature: (code) => z.removeFeature(code),
    getFeatures: () => z.getFeatures?.() ?? [],
  }
}

function currentPlatform(): Platform {
  const p = process.platform
  if (p === 'darwin' || p === 'linux' || p === 'win32') return p
  return 'win32'
}

function manualOpenFilters(): Array<{ name: string; extensions: string[] }> | undefined {
  if (process.platform === 'win32') {
    return [{ name: 'Apps', extensions: ['exe', 'bat', 'cmd', 'lnk'] }]
  }
  return undefined
}

async function resolveGroupPaths(group: GroupDoc): Promise<string[]> {
  const apps = await listAppsSvc(db())
  const byId = new Map(apps.map((a) => [a._id, a]))
  return group.appIds
    .map((id) => byId.get(id)?.path)
    .filter((p): p is string => !!p)
}

async function launchGroupById(groupId: string): Promise<LaunchResult> {
  const group = await getGroup(db(), groupId)
  if (!group) {
    return { success: 0, failed: 0, errors: [] }
  }
  const paths = await resolveGroupPaths(group)
  return launchGroupApps(paths)
}

const batchStart = {
  listApps: (): Promise<AppDoc[]> => listAppsSvc(db()),
  listCategories: (): Promise<CategoryDoc[]> => listCategoriesSvc(db()),
  listGroups: (): Promise<GroupDoc[]> => listGroupsSvc(db()),
  getSettings: (): Promise<SettingsDoc> => getSettingsSvc(db()),

  createCategory: (name: string): Promise<CategoryDoc> => createCategorySvc(db(), name),
  renameCategory: (id: string, name: string): Promise<CategoryDoc> =>
    renameCategorySvc(db(), id, name),
  deleteCategory: (id: string): Promise<void> => deleteCategorySvc(db(), id),
  assignCategory: (appId: string, categoryId: string | null): Promise<AppDoc> =>
    assignCategorySvc(db(), appId, categoryId),

  async addManualApp(): Promise<AppDoc | null> {
    const z = host()
    const selected = z.showOpenDialog({
      properties: ['openFile'],
      filters: manualOpenFilters(),
    })
    if (!selected?.length) return null

    const filePath = selected[0]
    const name = path.basename(filePath, path.extname(filePath))
    const icon = z.getFileIcon?.(filePath) ?? null
    return upsertApp(db(), {
      _id: makeAppId(newId()),
      name,
      path: filePath,
      icon,
      source: 'manual',
      categoryId: null,
      platform: currentPlatform(),
    })
  },

  async addCustomScanDir(): Promise<SettingsDoc | null> {
    const z = host()
    const selected = z.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (!selected?.length) return null

    const dir = selected[0]
    const settings = await getSettingsSvc(db())
    if (settings.customScanDirs.includes(dir)) return settings

    await db().put({
      ...settings,
      customScanDirs: [...settings.customScanDirs, dir],
    })
    return getSettingsSvc(db())
  },

  async removeCustomScanDir(dir: string): Promise<SettingsDoc> {
    const settings = await getSettingsSvc(db())
    await db().put({
      ...settings,
      customScanDirs: settings.customScanDirs.filter((d) => d !== dir),
    })
    return getSettingsSvc(db())
  },

  runScan: (): Promise<AppDoc[]> => runFullScan(db()),

  async saveGroup(input: GroupInput, id?: string): Promise<GroupDoc> {
    const group = await saveGroupSvc(db(), input, id)
    return syncGroupFeature(group, featureApi(), db())
  },

  async deleteGroup(groupId: string): Promise<void> {
    await deleteGroupSvc(db(), groupId)
    await removeGroupFeature(groupId, featureApi())
  },

  async retrySyncGroup(groupId: string): Promise<GroupDoc | null> {
    const group = await getGroup(db(), groupId)
    if (!group) return null
    return syncGroupFeature(group, featureApi(), db())
  },

  reconcileFeatures: (): Promise<void> => reconcileFeatures(db(), featureApi()),

  launchGroup: (groupId: string): Promise<LaunchResult> => launchGroupById(groupId),
}

window.batchStart = batchStart

// Do not keep the plugin resident in background after dismiss / group launch.
host().onPluginOut((isKill) => {
  if (!isKill) {
    void Promise.resolve(host().outPlugin(true))
  }
})

host().onPluginEnter(async (param) => {
  try {
    await reconcileFeatures(db(), featureApi())
  } catch {
    // feature sync failure should not block launch / manage
  }
  const action = routePluginEnter(param?.code)

  if (action.type === 'launch-group') {
    const result = await launchGroupById(action.groupId)
    await Promise.resolve(
      host().showToast(`成功 ${result.success} / 失败 ${result.failed}`),
    )
    // Kill process — only run when invoked
    await Promise.resolve(host().outPlugin(true))
    return
  }

  // manage: leave UI open until user exits (then onPluginOut kills)
})

export type BatchStartApi = typeof batchStart
