import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPrompts, replaceStorageSnapshot, savePrompts } from './storage'

const storage = new Map<string, unknown>()
let failNextWriteFor: string | null = null
let failNextReadFor: string | null = null

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  storage.clear()
  failNextWriteFor = null
  failNextReadFor = null
  vi.stubGlobal('window', {
    kvStorage: {
      get: (key: string) => {
        if (key === failNextReadFor) {
          failNextReadFor = null
          throw new Error('read failed')
        }
        return storage.get(key) ?? null
      },
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('本地存储', () => {
  it('保留用户主动清空后的空词库', async () => {
    storage.set('prompts', [])

    await expect(loadPrompts()).resolves.toEqual([])
  })

  it('老用户升级时补齐新增的内置提示词', async () => {
    storage.set('prompts', [{ id: 'welcome' }])

    const items = await loadPrompts()

    expect(items.map(item => item.id)).toContain('template-optimizer')
    expect(items.filter(item => item.id === 'welcome')).toHaveLength(1)
    expect(storage.get('seedVersion')).toBe(2)
  })

  it('种子版本已是最新时不再注入', async () => {
    storage.set('prompts', [{ id: 'welcome' }])
    storage.set('seedVersion', 2)

    const items = await loadPrompts()

    expect(items).toEqual([{ id: 'welcome' }])
  })

  it('用户删除过的内置提示词不会重复注入', async () => {
    storage.set('prompts', [{ id: 'welcome' }, { id: 'template-optimizer', deleted: true }])

    const items = await loadPrompts()

    expect(items.filter(item => item.id === 'template-optimizer')).toHaveLength(1)
  })

  it('读取失败时向调用方报告错误而不是回退到种子数据', async () => {
    failNextReadFor = 'prompts'

    await expect(loadPrompts()).rejects.toThrow('read failed')
  })

  it('写入失败时向调用方报告错误', async () => {
    failNextWriteFor = 'prompts'

    await expect(savePrompts([])).rejects.toThrow('write failed')
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
