import type { SettingsDoc } from '../types'

export function makeAppId(uuid: string): string {
  return `app:${uuid}`
}
export function makeCategoryId(uuid: string): string {
  return `category:${uuid}`
}
export function makeGroupId(uuid: string): string {
  return `group:${uuid}`
}

export function newId(): string {
  return crypto.randomUUID()
}

export type ZtoolsDb = {
  put: (doc: object) => Promise<object>
  get: (id: string) => Promise<object | null>
  remove: (docOrId: object | string) => Promise<object>
  allDocs: (key?: string) => Promise<object[]>
  bulkDocs?: (docs: object[]) => Promise<object[]>
}

export function getDb(): ZtoolsDb {
  // @ts-expect-error host injects ztools in plugin runtime
  const z = globalThis.ztools ?? (window as any).ztools
  return z.db.promises
}

const DEFAULT_UI = {
  categoryCollapsed: true,
  groupCollapsed: false,
} as const

export async function getSettings(db: ZtoolsDb = getDb()): Promise<SettingsDoc> {
  const existing = (await db.get('settings')) as SettingsDoc | null
  if (existing) {
    return {
      ...existing,
      ui: {
        categoryCollapsed: existing.ui?.categoryCollapsed ?? DEFAULT_UI.categoryCollapsed,
        groupCollapsed: existing.ui?.groupCollapsed ?? DEFAULT_UI.groupCollapsed,
      },
    }
  }
  const doc: SettingsDoc = {
    _id: 'settings',
    customScanDirs: [],
    lastScanAt: null,
    ui: { ...DEFAULT_UI },
  }
  await db.put(doc)
  return (await db.get('settings')) as SettingsDoc
}

export async function patchUiPrefs(
  patch: NonNullable<SettingsDoc['ui']>,
  db: ZtoolsDb = getDb(),
): Promise<SettingsDoc> {
  const settings = await getSettings(db)
  const next: SettingsDoc = {
    ...settings,
    ui: {
      categoryCollapsed: settings.ui?.categoryCollapsed ?? DEFAULT_UI.categoryCollapsed,
      groupCollapsed: settings.ui?.groupCollapsed ?? DEFAULT_UI.groupCollapsed,
      ...patch,
    },
  }
  await db.put(next)
  return getSettings(db)
}
