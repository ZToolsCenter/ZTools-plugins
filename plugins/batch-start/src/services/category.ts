import type { CategoryDoc } from '../types'
import { makeCategoryId, newId, type ZtoolsDb } from './db'
import { listApps, upsertApp } from './appLibrary'

export async function listCategories(db: ZtoolsDb): Promise<CategoryDoc[]> {
  const docs = (await db.allDocs('category:')) as CategoryDoc[]
  return docs.sort((a, b) => a.order - b.order)
}

export async function createCategory(db: ZtoolsDb, name: string): Promise<CategoryDoc> {
  const existing = await listCategories(db)
  const maxOrder = existing.reduce((max, c) => Math.max(max, c.order), -1)
  const doc: CategoryDoc = {
    _id: makeCategoryId(newId()),
    name,
    order: maxOrder + 1,
  }
  await db.put(doc)
  return (await db.get(doc._id)) as CategoryDoc
}

export async function renameCategory(
  db: ZtoolsDb,
  id: string,
  name: string,
): Promise<CategoryDoc> {
  const existing = (await db.get(id)) as CategoryDoc | null
  if (!existing) throw new Error(`Category not found: ${id}`)
  const updated: CategoryDoc = { ...existing, name }
  await db.put(updated)
  return (await db.get(id)) as CategoryDoc
}

export async function deleteCategory(db: ZtoolsDb, id: string): Promise<void> {
  const existing = await db.get(id)
  if (existing) await db.remove(existing)

  const apps = await listApps(db)
  for (const app of apps) {
    if (app.categoryId === id) {
      await upsertApp(db, { ...app, categoryId: null })
    }
  }
}
