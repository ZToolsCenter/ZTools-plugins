import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptItem } from '../types'

const storage = new Map<string, unknown>()
let failPromptWrite = false
let failHistoryWrite = false

function createPrompt(id: string, overrides: Partial<PromptItem> = {}): PromptItem {
  const now = Date.now()
  return {
    id,
    title: `提示词 ${id}`,
    content: '测试正文',
    type: 'prompt',
    tags: [],
    variables: [],
    favorite: false,
    usageCount: 0,
    version: 1,
    snapshots: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  storage.clear()
  storage.set('prompts', [])
  storage.set('history', [])
  failPromptWrite = false
  failHistoryWrite = false
  vi.stubGlobal('window', {
    kvStorage: {
      get: (key: string) => storage.get(key) ?? null,
      set: (key: string, value: unknown) => {
        if (key === 'prompts' && failPromptWrite) throw new Error('write failed')
        if (key === 'history' && failHistoryWrite) throw new Error('history write failed')
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

describe('提示词 Store 持久化', () => {
  it('新增提示词成功后可以从存储读取', async () => {
    const { usePromptStore } = await import('./prompt')
    const store = usePromptStore()
    await store.ensureReady()

    await store.addItem(createPrompt('saved'))

    expect(storage.get('prompts')).toEqual([expect.objectContaining({ id: 'saved' })])
  })

  it('新增提示词写入失败时回滚内存状态', async () => {
    const { usePromptStore } = await import('./prompt')
    const store = usePromptStore()
    await store.ensureReady()
    failPromptWrite = true

    await expect(store.addItem(createPrompt('failed'))).rejects.toThrow('write failed')

    expect(store.rawItems.value).toEqual([])
  })

  it('通过公开状态组合项目、标签和排序筛选', async () => {
    const { usePromptStore } = await import('./prompt')
    const store = usePromptStore()
    await store.ensureReady()
    store.rawItems.value = [
      createPrompt('beta', { title: 'Beta', tags: ['work'], projectId: 'project-1' }),
      createPrompt('alpha', { title: 'Alpha', tags: ['work'], projectId: 'project-1' }),
      createPrompt('asset', { title: 'Asset', tags: ['work'] }),
      createPrompt('deleted', { title: 'Deleted', tags: ['work'], projectId: 'project-1', deleted: true }),
    ]

    store.spaceTab.value = 'project'
    store.filterProjectId.value = 'project-1'
    store.filterTag.value = 'work'
    store.sortBy.value = 'title'
    store.sortDir.value = 'asc'

    expect(store.spaceItems.value.map(item => item.id)).toEqual(['alpha', 'beta'])
  })

  it('历史写入失败时回滚内存状态', async () => {
    const { usePromptStore } = await import('./prompt')
    const store = usePromptStore()
    await store.ensureReady()
    failHistoryWrite = true

    await expect(store.addHistory({
      promptId: 'prompt-1',
      promptTitle: '测试',
      copiedContent: '正文',
    })).rejects.toThrow('history write failed')

    expect(store.historyItems.value).toEqual([])
  })
})
