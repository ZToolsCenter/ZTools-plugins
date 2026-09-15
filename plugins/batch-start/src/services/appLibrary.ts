import type { AppDoc, Platform } from '../types'
import { makeAppId, newId, type ZtoolsDb } from './db'

function normalizePath(path: string): string {
  return path.toLowerCase()
}

export async function upsertApp(db: ZtoolsDb, app: AppDoc): Promise<AppDoc> {
  await db.put(app)
  return (await db.get(app._id)) as AppDoc
}

export async function listApps(db: ZtoolsDb): Promise<AppDoc[]> {
  return (await db.allDocs('app:')) as AppDoc[]
}

export async function assignCategory(
  db: ZtoolsDb,
  appId: string,
  categoryId: string | null,
): Promise<AppDoc> {
  const existing = (await db.get(appId)) as AppDoc | null
  if (!existing) throw new Error(`App not found: ${appId}`)
  return upsertApp(db, { ...existing, categoryId })
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
    if (match) {
      const updated: AppDoc = {
        ...match,
        platform: item.platform,
        ...(item.icon !== undefined ? { icon: item.icon } : {}),
      }
      // Refresh names for scan-sourced apps (fixes prior encoding issues on re-scan)
      if (match.source === 'scan' && item.name) {
        updated.name = item.name
      }
      toWrite.push(updated)
      byPath.set(key, updated)
    } else {
      const doc: AppDoc = {
        _id: makeAppId(newId()),
        name: item.name,
        path: item.path,
        icon: item.icon ?? null,
        source: 'scan',
        categoryId: null,
        platform: item.platform,
      }
      toWrite.push(doc)
      byPath.set(key, doc)
    }
  }

  if (toWrite.length > 0) {
    if (db.bulkDocs) {
      await db.bulkDocs(toWrite)
    } else {
      // Fallback: parallel puts in chunks
      const CHUNK = 40
      for (let i = 0; i < toWrite.length; i += CHUNK) {
        const chunk = toWrite.slice(i, i + CHUNK)
        await Promise.all(chunk.map((doc) => db.put(doc)))
      }
    }
  }

  return listApps(db)
}
