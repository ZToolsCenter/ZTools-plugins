import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMemoryDb } from './mocks/memoryDb'
import { saveGroup, getGroup } from '../src/services/launchGroup'
import { syncGroupFeature, reconcileFeatures } from '../src/services/featureSync'
import type { ZtoolsDb } from '../src/services/db'

describe('featureSync', () => {
  let db: ZtoolsDb

  beforeEach(() => {
    db = createMemoryDb()
  })

  it('setFeature on syncGroup and marks featureSynced', async () => {
    const setFeature = vi.fn(() => true)
    const removeFeature = vi.fn(() => true)
    const group = await saveGroup(db, {
      name: '开工',
      cmds: ['开工'],
      appIds: ['app:1'],
      order: 0,
    })
    await syncGroupFeature(group, { setFeature, removeFeature }, db)
    expect(setFeature).toHaveBeenCalledWith(
      expect.objectContaining({ code: group._id, cmds: ['开工'] }),
    )
    expect((await getGroup(db, group._id))!.featureSynced).toBe(true)
  })

  it('reconcile removes orphan features and restores missing', async () => {
    const setFeature = vi.fn(() => true)
    const removeFeature = vi.fn(() => true)
    const keep = await saveGroup(db, {
      name: 'Keep',
      cmds: ['Keep'],
      appIds: ['app:1'],
      order: 0,
    })
    const getFeatures = () => [{ code: 'group:orphan' }, { code: keep._id }]
    await reconcileFeatures(db, { setFeature, removeFeature, getFeatures })
    expect(removeFeature).toHaveBeenCalledWith('group:orphan')
  })
})
