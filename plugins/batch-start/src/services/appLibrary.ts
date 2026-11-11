import type { AppDoc, AppSource, Platform } from '../types'
import { makeAppId, newId, type ZtoolsDb } from './db'
import { listGroups } from './launchGroup'
import { isZtoolsCommandPath } from './scanner/ztoolsPlugins'

function normalizePath(path: string): string {
  return path.toLowerCase()
}

function isZtoolsSource(source: AppSource): boolean {
  return source === 'ztools' || source === 'plugin'
}

/** Migrate legacy single `categoryId` → `categoryIds` */
export function normalizeApp(raw: AppDoc & { categoryId?: string | null }): AppDoc {
  const legacyId = raw.categoryId
  const fromArray = Array.isArray(raw.categoryIds) ? raw.categoryIds.filter(Boolean) : []
  const categoryIds =
    fromArray.length > 0
      ? [...new Set(fromArray)]
      : legacyId
        ? [legacyId]
        : []
  const { categoryId: _legacy, ...rest } = raw as AppDoc & { categoryId?: string | null }
  return { ...rest, categoryIds }
}

export async function upsertApp(db: ZtoolsDb, app: AppDoc): Promise<AppDoc> {
  const normalized = normalizeApp(app)
  await db.put(normalized)
  return (await db.get(normalized._id)) as AppDoc
}

export async function listApps(db: ZtoolsDb): Promise<AppDoc[]> {
  const docs = (await db.allDocs('app:')) as Array<AppDoc & { categoryId?: string | null }>
  return docs.map(normalizeApp)
}

/**
 * Add app to a category (multi-membership). Pass `null` to clear all categories.
 */
export async function assignCategory(
  db: ZtoolsDb,
  appId: string,
  categoryId: string | null,
): Promise<AppDoc> {
  const existing = (await db.get(appId)) as (AppDoc & { categoryId?: string | null }) | null
  if (!existing) throw new Error(`App not found: ${appId}`)
  const current = normalizeApp(existing)
  if (categoryId == null) {
    return upsertApp(db, { ...current, categoryIds: [] })
  }
  if (current.categoryIds.includes(categoryId)) return current
  return upsertApp(db, {
    ...current,
    categoryIds: [...current.categoryIds, categoryId],
  })
}

/** Remove one category membership from an app. */
export async function removeCategory(
  db: ZtoolsDb,
  appId: string,
  categoryId: string,
): Promise<AppDoc> {
  const existing = (await db.get(appId)) as (AppDoc & { categoryId?: string | null }) | null
  if (!existing) throw new Error(`App not found: ${appId}`)
  const current = normalizeApp(existing)
  if (!current.categoryIds.includes(categoryId)) return current
  return upsertApp(db, {
    ...current,
    categoryIds: current.categoryIds.filter((id) => id !== categoryId),
  })
}

export async function removeApp(db: ZtoolsDb, appId: string): Promise<void> {
  const existing = await db.get(appId)
  if (existing) await db.remove(existing)
}

export type ScannedApp = {
  name: string
  path: string
  platform: Platform
  icon?: string | null
  source?: AppSource
  pluginName?: string
  pluginTitle?: string
  launchCmd?: string | null
  stableIdHint?: string
}

async function writeDocs(db: ZtoolsDb, docs: AppDoc[]): Promise<void> {
  if (docs.length === 0) return
  if (db.bulkDocs) {
    await db.bulkDocs(docs)
    return
  }
  const CHUNK = 40
  for (let i = 0; i < docs.length; i += CHUNK) {
    const chunk = docs.slice(i, i + CHUNK)
    await Promise.all(chunk.map((doc) => db.put(doc)))
  }
}

export async function mergeScannedApps(
  db: ZtoolsDb,
  scanned: ScannedApp[],
): Promise<AppDoc[]> {
  const existing = await listApps(db)
  const byPath = new Map(existing.map((a) => [normalizePath(a.path), a]))
  const toWrite: AppDoc[] = []

  for (const item of scanned) {
    const key = normalizePath(item.path)
    const match = byPath.get(key)
    const source: AppSource = item.source ?? 'scan'

    if (match) {
      const updated: AppDoc = {
        ...match,
        platform: item.platform,
        ...(item.icon !== undefined ? { icon: item.icon } : {}),
      }
      if ((match.source === 'scan' || isZtoolsSource(match.source)) && item.name) {
        updated.name = item.name
      }
      if (isZtoolsSource(source)) {
        updated.source = 'ztools'
        if (item.pluginName) updated.pluginName = item.pluginName
        if (item.pluginTitle) updated.pluginTitle = item.pluginTitle
        if (item.launchCmd !== undefined) updated.launchCmd = item.launchCmd
      }
      toWrite.push(normalizeApp(updated))
      byPath.set(key, updated)
    } else {
      const id = item.stableIdHint
        ? makeAppId(item.stableIdHint)
        : isZtoolsSource(source) && item.pluginName && item.launchCmd
          ? makeAppId(`cmd:${item.pluginName}:${encodeURIComponent(item.launchCmd)}`)
          : makeAppId(newId())
      const doc: AppDoc = {
        _id: id,
        name: item.name,
        path: item.path,
        icon: item.icon ?? null,
        source: isZtoolsSource(source) ? 'ztools' : source,
        categoryIds: [],
        platform: item.platform,
        ...(isZtoolsSource(source)
          ? {
              pluginName: item.pluginName,
              pluginTitle: item.pluginTitle,
              launchCmd: item.launchCmd ?? null,
            }
          : {}),
      }
      toWrite.push(doc)
      byPath.set(key, doc)
    }
  }

  await writeDocs(db, toWrite)
  return listApps(db)
}

/**
 * Remove ZTools command apps no longer present; strip their ids from groups.
 * Also drops legacy per-plugin (`source:'plugin'` / ztools-plugin://) rows.
 */
export async function reconcileMissingPluginApps(
  db: ZtoolsDb,
  presentCommandPaths: string[],
): Promise<string[]> {
  const present = new Set(presentCommandPaths.map(normalizePath))
  const apps = await listApps(db)
  const orphans = apps.filter((a) => {
    if (!isZtoolsSource(a.source) && !isZtoolsCommandPath(a.path)) return false
    return !present.has(normalizePath(a.path))
  })
  if (orphans.length === 0) return []

  const orphanIds = new Set(orphans.map((o) => o._id))
  for (const orphan of orphans) {
    await removeApp(db, orphan._id)
  }

  const groups = await listGroups(db)
  for (const group of groups) {
    const nextIds = group.appIds.filter((id) => !orphanIds.has(id))
    if (nextIds.length === group.appIds.length) continue
    await db.put({
      ...group,
      appIds: nextIds,
      featureSynced: false,
    })
  }

  return [...orphanIds]
}
