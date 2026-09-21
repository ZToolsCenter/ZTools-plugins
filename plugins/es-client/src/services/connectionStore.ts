import type { ConnectionInput, ConnectionProfile } from '../types'
import { getDb, getSettings, makeConnectionId, newId, saveSettings, type ZtoolsDb } from './db'

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function sanitizeForLog(profile: Partial<ConnectionProfile>): Record<string, unknown> {
  return {
    id: profile._id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    authType: profile.authType,
    rejectUnauthorized: profile.rejectUnauthorized,
    hasPassword: Boolean(profile.password),
    hasApiKey: Boolean(profile.apiKey),
  }
}

export async function listConnections(db: ZtoolsDb = getDb()): Promise<ConnectionProfile[]> {
  const docs = (await db.allDocs('conn:')) as ConnectionProfile[]
  return docs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export async function getConnection(
  id: string,
  db: ZtoolsDb = getDb(),
): Promise<ConnectionProfile | null> {
  return (await db.get(id)) as ConnectionProfile | null
}

export async function saveConnection(
  input: ConnectionInput,
  id?: string,
  db: ZtoolsDb = getDb(),
): Promise<ConnectionProfile> {
  // Always re-read before write so Couch-style _rev stays current on edit.
  const existing = id ? await getConnection(id, db) : null
  if (id && !existing) throw new Error('连接不存在，无法更新')
  const ts = nowIso()
  const doc: ConnectionProfile = {
    ...(existing ?? {}),
    _id: existing?._id ?? makeConnectionId(newId()),
    name: input.name.trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    authType: input.authType,
    username: input.authType === 'basic' ? input.username?.trim() || '' : undefined,
    password: input.authType === 'basic' ? input.password ?? '' : undefined,
    apiKey: input.authType === 'apiKey' ? input.apiKey ?? '' : undefined,
    rejectUnauthorized: input.rejectUnauthorized ?? existing?.rejectUnauthorized ?? true,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  }
  if (existing?._rev) doc._rev = existing._rev
  if (!doc.name) throw new Error('连接名称不能为空')
  if (!doc.baseUrl) throw new Error('Base URL 不能为空')
  try {
    // eslint-disable-next-line no-new
    new URL(doc.baseUrl)
  } catch {
    throw new Error('Base URL 无效')
  }
  await db.put(doc)
  const settings = await getSettings(db)
  if (!settings.activeConnectionId) {
    await saveSettings({ activeConnectionId: doc._id }, db)
  }
  return (await db.get(doc._id)) as ConnectionProfile
}

export async function deleteConnection(id: string, db: ZtoolsDb = getDb()): Promise<void> {
  const doc = await getConnection(id, db)
  if (doc) await db.remove(doc)
  const settings = await getSettings(db)
  if (settings.activeConnectionId === id) {
    const rest = await listConnections(db)
    await saveSettings({ activeConnectionId: rest[0]?._id ?? null }, db)
  }
}

export async function getActiveConnection(
  db: ZtoolsDb = getDb(),
): Promise<ConnectionProfile | null> {
  const settings = await getSettings(db)
  if (!settings.activeConnectionId) return null
  return getConnection(settings.activeConnectionId, db)
}

export async function setActiveConnection(
  id: string | null,
  db: ZtoolsDb = getDb(),
): Promise<ConnectionProfile | null> {
  if (id) {
    const doc = await getConnection(id, db)
    if (!doc) throw new Error('连接不存在')
  }
  await saveSettings({ activeConnectionId: id }, db)
  return id ? getConnection(id, db) : null
}
