import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from './mocks/memoryDb'
import { saveGroup } from '../src/services/launchGroup'
import type { ZtoolsDb } from '../src/services/db'

describe('launchGroup', () => {
  let db: ZtoolsDb

  beforeEach(() => {
    db = createMemoryDb()
  })

  it('rejects empty name', async () => {
    await expect(
      saveGroup(db, { name: '  ', cmds: [], appIds: ['app:1'], order: 0 }),
    ).rejects.toThrow(/name/i)
  })

  it('rejects zero apps', async () => {
    await expect(
      saveGroup(db, { name: 'Dev', cmds: ['Dev'], appIds: [], order: 0 }),
    ).rejects.toThrow(/app/i)
  })

  it('rejects duplicate cmd against other groups', async () => {
    await saveGroup(db, { name: 'A', cmds: ['开工'], appIds: ['app:1'], order: 0 })
    await expect(
      saveGroup(db, { name: 'B', cmds: ['开工'], appIds: ['app:2'], order: 1 }),
    ).rejects.toThrow(/conflict|冲突|cmd/i)
  })
})
