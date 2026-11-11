import { describe, it, expect } from 'vitest'
import { createMemoryDb } from './mocks/memoryDb'
import { createCategory, deleteCategory, listCategories } from '../src/services/category'
import {
  upsertApp,
  listApps,
  assignCategory,
  removeCategory,
} from '../src/services/appLibrary'
import { makeAppId } from '../src/services/db'

describe('category', () => {
  it('creates and lists categories', async () => {
    const db = createMemoryDb()
    const c = await createCategory(db, '开发')
    expect(c.name).toBe('开发')
    expect(c._id.startsWith('category:')).toBe(true)
    expect((await listCategories(db)).length).toBe(1)
  })

  it('deleteCategory removes id from app.categoryIds', async () => {
    const db = createMemoryDb()
    const c = await createCategory(db, '办公')
    const keep = await createCategory(db, '开发')
    await upsertApp(db, {
      _id: makeAppId('1'),
      name: 'A',
      path: 'C:/a.exe',
      source: 'manual',
      categoryIds: [c._id, keep._id],
      platform: 'win32',
    })
    await deleteCategory(db, c._id)
    const apps = await listApps(db)
    expect(apps[0].categoryIds).toEqual([keep._id])
  })

  it('assignCategory adds without replacing existing', async () => {
    const db = createMemoryDb()
    const a = await createCategory(db, 'A')
    const b = await createCategory(db, 'B')
    await upsertApp(db, {
      _id: makeAppId('1'),
      name: 'App',
      path: 'C:/a.exe',
      source: 'manual',
      categoryIds: [a._id],
      platform: 'win32',
    })
    await assignCategory(db, makeAppId('1'), b._id)
    const apps = await listApps(db)
    expect(apps[0].categoryIds).toEqual([a._id, b._id])
  })

  it('removeCategory drops one membership', async () => {
    const db = createMemoryDb()
    const a = await createCategory(db, 'A')
    const b = await createCategory(db, 'B')
    const appId = makeAppId('1')
    await upsertApp(db, {
      _id: appId,
      name: 'App',
      path: 'C:/a.exe',
      source: 'manual',
      categoryIds: [a._id, b._id],
      platform: 'win32',
    })
    await removeCategory(db, appId, a._id)
    const apps = await listApps(db)
    expect(apps[0].categoryIds).toEqual([b._id])
  })
})
