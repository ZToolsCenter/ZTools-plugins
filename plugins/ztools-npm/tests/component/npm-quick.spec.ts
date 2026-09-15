import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NpmQuick from '../../src/NpmQuick/index.vue'

const mockSearch = vi.fn()
const mockWrite = vi.fn()

beforeEach(() => {
  ;(window as any).services = {
    npmSearch: mockSearch,
    npmMeta: vi.fn(),
    setRegistry: vi.fn(),
    getRegistry: vi.fn(),
  }
  ;(window as any).ztools = {
    setSubInput: vi.fn(),
    onPluginEnter: vi.fn(),
    onPluginOut: vi.fn(),
    clipboard: { writeContent: mockWrite },
    showNotification: vi.fn(),
    hideMainWindow: vi.fn(),
  }
  mockSearch.mockReset()
  mockWrite.mockReset()
})

describe('NpmQuick', () => {
  it('进入时按 payload 自动搜索并渲染列表', async () => {
    mockSearch.mockResolvedValue({
      data: [{ id: 'vue', name: 'vue', version: '3.5.41', description: 'progressive', source: 'npm' }],
      sources: { npm: [], npmmirror: [] },
    })
    const wrapper = mount(NpmQuick, {
      props: { enterAction: { code: 'npm-search', type: 'over', payload: 'vue' } },
    })
    await flushPromises()
    expect(mockSearch).toHaveBeenCalledWith({ kind: 'freeText', text: 'vue' })
    expect(wrapper.text()).toContain('vue')
    expect(wrapper.text()).toContain('3.5.41')
    wrapper.unmount()
  })

  it('Enter 复制 npm install 并隐藏窗口', async () => {
    mockSearch.mockResolvedValue({
      data: [{ id: 'vue', name: 'vue', version: '3.5.41', description: '', source: 'npm' }],
      sources: { npm: [], npmmirror: [] },
    })
    const wrapper = mount(NpmQuick, {
      props: { enterAction: { code: 'npm-search', type: 'over', payload: 'vue' } },
    })
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(mockWrite).toHaveBeenCalledWith({
      type: 'text',
      content: 'npm install vue@3.5.41',
      shouldPaste: true,
    })
    expect((window as any).ztools.hideMainWindow).toHaveBeenCalled()
    wrapper.unmount()
  })
})
