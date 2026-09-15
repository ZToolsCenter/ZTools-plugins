import { describe, it, expect } from 'vitest'
import { createMemoryDb } from './mocks/memoryDb'
import { createCategory, deleteCategory, listCategories } from '../src/services/category'
import { upsertApp, listApps } from '../src/services/appLibrary'
import { makeAppId } from '../src/services/db'

describe('category', () => {
  it('creates and lists categories', async () => {
    const db = createMemoryDb()
    const c = await createCategory(db, '开发')
    expect(c.name).toBe('开发')
    expect(c._id.startsWith('category:')).toBe(true)
    expect((await listCategories(db)).length).toBe(1)
  })

  it('deleteCategory clears app.categoryId', async () => {
    const db = createMemoryDb()
    const c = await createCategory(db, '办公')
    await upsertApp(db, {
      _id: makeAppId('1'),
      name: 'A',
      path: 'C:/a.exe',
      source: 'manual',
      categoryId: c._id,
      platform: 'win32',
    })
    await deleteCategory(db, c._id)
    const apps = await listApps(db)
    expect(apps[0].categoryId).toBeNull()
  })
})
