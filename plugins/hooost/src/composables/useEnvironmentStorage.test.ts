import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeStore, useEnvironmentStorage } from '@/composables/useEnvironmentStorage'

const getItem = vi.fn()
const setItem = vi.fn()
const removeItem = vi.fn()

beforeEach(() => {
  getItem.mockReset()
  setItem.mockReset()
  removeItem.mockReset()

  window.ztools = {
    internal: {},
    dbStorage: {
      getItem,
      setItem,
      removeItem,
    },
    shellOpenExternal: vi.fn(),
    onPluginEnter: vi.fn(),
    onPluginOut: vi.fn(),
  } as unknown as typeof window.ztools
})

describe('normalizeStore', () => {
  it('seeds public and preset environments for empty data', () => {
    const normalized = normalizeStore({})

    expect(normalized.activeEnvironmentIds).toEqual(['env-public'])
    expect(normalized.environments.map((environment) => environment.name)).toEqual([
      'hosts 文件',
      '开发配置',
      '测试配置',
      '生产配置',
    ])
  })

  it('filters invalid active ids and keeps public enabled', () => {
    const normalized = normalizeStore({
      initialized: true,
      activeEnvironmentIds: ['env-public', 'missing', 'env-custom-1'],
      environments: [
        {
          id: 'env-public',
          name: 'ignored',
          type: 'public',
          enabled: false,
          editMode: 'source',
          header: 'ignored',
          endMarker: 'ignored',
          lines: [],
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
        {
          id: 'env-custom-1',
          name: '自定义',
          type: 'custom',
          enabled: false,
          editMode: 'source',
          header: '#-------- 自定义 --------',
          endMarker: '#-------- 自定义 结束 --------',
          lines: [],
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
      ],
    })

    expect(normalized.activeEnvironmentIds).toEqual(['env-public', 'env-custom-1'])
    expect(normalized.environments[0]).toMatchObject({ id: 'env-public', name: 'hosts 文件', enabled: true })
    expect(normalized.environments[1]).toMatchObject({ id: 'env-custom-1', enabled: true })
  })
})

describe('useEnvironmentStorage', () => {
  it('normalizes persisted data on load and writes back repaired content', () => {
    getItem.mockReturnValue({
      initialized: false,
      activeEnvironmentIds: ['env-custom-1'],
      environments: [
        {
          id: 'env-custom-1',
          name: '我的配置',
          type: 'custom',
          lines: [],
        },
      ],
    })

    const { loadStore } = useEnvironmentStorage()
    const store = loadStore()

    expect(store.environments.map((environment) => environment.name)).toContain('开发配置')
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem.mock.calls[0][0]).toBe('hooost:environment:store')
  })

  it('normalizes before saving', () => {
    const { saveStore } = useEnvironmentStorage()

    saveStore({
      initialized: true,
      activeEnvironmentIds: ['env-custom-1'],
      environments: [
        {
          id: 'env-custom-1',
          name: '我的配置',
          type: 'custom',
          enabled: false,
          editMode: 'source',
          header: '#-------- 我的配置 --------',
          endMarker: '#-------- 我的配置 结束 --------',
          lines: [],
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
      ],
    })

    const [, savedValue] = setItem.mock.calls[0]
    expect(savedValue.activeEnvironmentIds).toEqual(['env-public', 'env-custom-1'])
    expect(savedValue.environments[0]).toMatchObject({ id: 'env-public', enabled: true })
  })
})
