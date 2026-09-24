import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPrompts, replaceStorageSnapshot } from './storage'

const storage = new Map<string, unknown>()
let failNextWriteFor: string | null = null

beforeEach(() => {
  storage.clear()
  failNextWriteFor = null
  vi.stubGlobal('window', {
    kvStorage: {
      get: (key: string) => storage.get(key) ?? null,
      set: (key: string, value: unknown) => {
        if (key === failNextWriteFor) {
          failNextWriteFor = null
          throw new Error('write failed')
        }
        storage.set(key, value)
      },
      remove: (key: string) => storage.delete(key),
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('本地存储', () => {
  it('保留用户主动清空后的空词库', async () => {
    storage.set('prompts', [])

    await expect(loadPrompts()).resolves.toEqual([])
  })

  it('整包替换会一起写入所有数据类别', async () => {
    await replaceStorageSnapshot({
      prompts: [],
      projects: [],
      settings: { theme: 'dark' },
      history: [],
    })

    expect(storage.get('prompts')).toEqual([])
    expect(storage.get('projects')).toEqual([])
    expect(storage.get('settings')).toEqual({ theme: 'dark' })
    expect(storage.get('history')).toEqual([])
  })

  it('整包写入失败时恢复原有数据', async () => {
    storage.set('prompts', [{ id: 'before' }])
    storage.set('projects', [{ id: 'before' }])
    storage.set('settings', { theme: 'light' })
    storage.set('history', [{ id: 'before' }])
    failNextWriteFor = 'settings'

    await expect(replaceStorageSnapshot({
      prompts: [{ id: 'after' }] as never[],
      projects: [{ id: 'after' }] as never[],
      settings: { theme: 'dark' },
      history: [{ id: 'after' }] as never[],
    })).rejects.toThrow('write failed')

    expect(storage.get('prompts')).toEqual([{ id: 'before' }])
    expect(storage.get('projects')).toEqual([{ id: 'before' }])
    expect(storage.get('settings')).toEqual({ theme: 'light' })
    expect(storage.get('history')).toEqual([{ id: 'before' }])
  })
})
