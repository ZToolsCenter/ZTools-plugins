import type { SettingsDoc } from '../types'

export function makeConnectionId(uuid: string): string {
  return `conn:${uuid}`
}

export function newId(): string {
  return crypto.randomUUID()
}

export type ZtoolsDb = {
  put: (doc: object) => Promise<object>
  get: (id: string) => Promise<object | null>
  remove: (docOrId: object | string) => Promise<object>
  allDocs: (key?: string) => Promise<object[]>
}

type MemoryDoc = Record<string, unknown> & { _id: string }

/** In-memory fallback when ztools.db is unavailable (dev / tests). */
export class MemoryDb implements ZtoolsDb {
  private store = new Map<string, MemoryDoc>()

  async put(doc: object): Promise<object> {
    const d = { ...(doc as MemoryDoc) }
    if (!d._id) throw new Error('doc._id required')
    this.store.set(d._id, d)
    return { ...d }
  }

  async get(id: string): Promise<object | null> {
    const d = this.store.get(id)
    return d ? { ...d } : null
  }

  async remove(docOrId: object | string): Promise<object> {
    const id = typeof docOrId === 'string' ? docOrId : (docOrId as MemoryDoc)._id
    const prev = this.store.get(id)
    this.store.delete(id)
    return prev ?? { _id: id }
  }

  async allDocs(key?: string): Promise<object[]> {
    const all = [...this.store.values()].map((d) => ({ ...d }))
    if (!key) return all
    return all.filter((d) => String(d._id).startsWith(key))
  }
}

const memoryFallback = new MemoryDb()

export function getDb(): ZtoolsDb {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const z = (globalThis as any).ztools ?? (typeof window !== 'undefined' ? (window as any).ztools : undefined)
    if (z?.db?.promises) return z.db.promises as ZtoolsDb
  } catch {
    // fall through
  }
  return memoryFallback
}

export async function getSettings(db: ZtoolsDb = getDb()): Promise<SettingsDoc> {
  const existing = (await db.get('settings')) as SettingsDoc | null
  if (existing) return existing
  const doc: SettingsDoc = {
    _id: 'settings',
    activeConnectionId: null,
  }
  await db.put(doc)
  return (await db.get('settings')) as SettingsDoc
}

export async function saveSettings(
  patch: Partial<Omit<SettingsDoc, '_id'>>,
  db: ZtoolsDb = getDb(),
): Promise<SettingsDoc> {
  const current = await getSettings(db)
  const next: SettingsDoc = { ...current, ...patch, _id: 'settings' }
  await db.put(next)
  return (await db.get('settings')) as SettingsDoc
}
