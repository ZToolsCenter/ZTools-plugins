import { getDb, type ZtoolsDb } from './db'

export const UI_SEARCH_ID = 'ui:search'
export const UI_REST_ID = 'ui:rest'

export type UiStateDoc<T = unknown> = {
  _id: string
  _rev?: string
  updatedAt: string
  payload: T
}

export async function getUiState<T>(
  id: string,
  db: ZtoolsDb = getDb(),
): Promise<T | null> {
  const doc = (await db.get(id)) as UiStateDoc<T> | null
  if (!doc || doc.payload === undefined) return null
  return doc.payload
}

export async function saveUiState<T>(
  id: string,
  payload: T,
  db: ZtoolsDb = getDb(),
): Promise<void> {
  const existing = (await db.get(id)) as UiStateDoc<T> | null
  const doc: UiStateDoc<T> = {
    ...(existing ?? {}),
    _id: id,
    payload,
    updatedAt: new Date().toISOString(),
  }
  if (existing?._rev) doc._rev = existing._rev
  await db.put(doc)
}
