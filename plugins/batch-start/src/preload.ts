import path from 'node:path'
import {
  assignCategory as assignCategorySvc,
  removeCategory as removeCategorySvc,
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
  patchUiPrefs as patchUiPrefsSvc,
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
import {
  countSuccessfulZtoolsLaunches,
  launchGroupApps,
  ZTOOLS_REDIRECT_SETTLE_MS,
  type LaunchTarget,
} from './services/launcher'
import { runFullScan } from './services/scanner'
import { isZtoolsCommandPath } from './services/scanner/ztoolsPlugins'
import type {
  AppDoc,
  CategoryDoc,
  GroupDoc,
  LaunchResult,
  Platform,
  SettingsDoc,
  UiPrefs,
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
  redirect: (label: string | [string, string], payload?: string) => boolean
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

function appToLaunchTarget(app: AppDoc): LaunchTarget | null {
  if (app.source === 'ztools' || app.source === 'plugin' || isZtoolsCommandPath(app.path)) {
    return {
      key: app.path,
      kind: 'ztools',
      pluginTitle: app.pluginTitle || undefined,
      launchCmd: app.launchCmd,
    }
  }
  if (app.path) return { key: app.path, kind: 'path', path: app.path }
  return null
}

async function resolveGroupTargets(group: GroupDoc): Promise<LaunchTarget[]> {
  const apps = await listAppsSvc(db())
  const byId = new Map(apps.map((a) => [a._id, a]))
  const targets: LaunchTarget[] = []
  for (const id of group.appIds) {
    const app = byId.get(id)
    if (!app) continue
    const target = appToLaunchTarget(app)
    if (target) targets.push(target)
  }
  return targets
}

async function executeLaunch(targets: LaunchTarget[]): Promise<LaunchResult> {
  const z = host()
  return launchGroupApps(
    targets,
    (p) => z.shellOpenPath(p),
    (label, payload) => z.redirect(label, payload),
  )
}

async function launchGroupById(groupId: string): Promise<LaunchResult> {
  const group = await getGroup(db(), groupId)
  if (!group) {
    return { success: 0, failed: 0, errors: [] }
  }
  return executeLaunch(await resolveGroupTargets(group))
}

async function launchAppById(appId: string): Promise<LaunchResult> {
  const app = (await db().get(appId)) as AppDoc | null
  if (!app) {
    return { success: 0, failed: 1, errors: [{ path: appId, error: 'app not found' }] }
  }
  const target = appToLaunchTarget(app)
  if (!target) {
    return { success: 0, failed: 1, errors: [{ path: app.path || appId, error: 'not launchable' }] }
  }
  const result = await executeLaunch([target])
  // 管理页启动指令会 redirect；延迟退出以免打断目标插件，且不阻塞 toast
  if (countSuccessfulZtoolsLaunches(result.outcomes ?? []) > 0) {
    void (async () => {
      await new Promise((r) => setTimeout(r, ZTOOLS_REDIRECT_SETTLE_MS))
      await Promise.resolve(host().outPlugin(true))
    })()
  }
  return result
}

const batchStart = {
  listApps: (): Promise<AppDoc[]> => listAppsSvc(db()),
  listCategories: (): Promise<CategoryDoc[]> => listCategoriesSvc(db()),
  listGroups: (): Promise<GroupDoc[]> => listGroupsSvc(db()),
  getSettings: (): Promise<SettingsDoc> => getSettingsSvc(db()),
  patchUiPrefs: (patch: UiPrefs): Promise<SettingsDoc> => patchUiPrefsSvc(patch, db()),

  createCategory: (name: string): Promise<CategoryDoc> => createCategorySvc(db(), name),
  renameCategory: (id: string, name: string): Promise<CategoryDoc> =>
    renameCategorySvc(db(), id, name),
  deleteCategory: (id: string): Promise<void> => deleteCategorySvc(db(), id),
  assignCategory: (appId: string, categoryId: string | null): Promise<AppDoc> =>
    assignCategorySvc(db(), appId, categoryId),
  removeCategory: (appId: string, categoryId: string): Promise<AppDoc> =>
    removeCategorySvc(db(), appId, categoryId),

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
      categoryIds: [],
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
  launchApp: (appId: string): Promise<LaunchResult> => launchAppById(appId),
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
    // redirect() switches the host "current" plugin to the target; calling
    // outPlugin(true) immediately aborts that assembly (see main.log hide-view-abort-assembly).
    if (countSuccessfulZtoolsLaunches(result.outcomes ?? []) > 0) {
      await new Promise((r) => setTimeout(r, ZTOOLS_REDIRECT_SETTLE_MS))
    }
    await Promise.resolve(host().outPlugin(true))
    return
  }

  // manage: leave UI open until user exits (then onPluginOut kills)
})

export type BatchStartApi = typeof batchStart
