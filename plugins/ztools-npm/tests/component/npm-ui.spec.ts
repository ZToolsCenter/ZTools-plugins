import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NpmUi from '../../src/NpmUi/index.vue'

let subInputCb: ((input: any) => void) | null = null
const mockSearch = vi.fn()
const mockMeta = vi.fn()
const mockWrite = vi.fn()

beforeEach(() => {
  subInputCb = null
  ;(window as any).services = {
    npmSearch: mockSearch,
    npmMeta: mockMeta,
    setRegistry: vi.fn(),
    getRegistry: vi.fn(),
  }
  ;(window as any).ztools = {
    setSubInput: (cb: any) => { subInputCb = cb },
    onPluginEnter: vi.fn(),
    onPluginOut: vi.fn(),
    dbStorage: { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() },
    clipboard: { writeContent: mockWrite },
    showNotification: vi.fn(),
    hideMainWindow: vi.fn(),
  }
  mockSearch.mockReset()
  mockMeta.mockReset()
  mockWrite.mockReset()
})

describe('NpmUi', () => {
  it('搜索并渲染结果列表', async () => {
    mockSearch.mockResolvedValue({
      data: [{ id: 'vue', name: 'vue', version: '3.5.41', description: 'progressive', source: 'npm' }],
      sources: { npm: [{ id: 'vue', name: 'vue', version: '3.5.41', description: '', source: 'npm' }], npmmirror: [] },
      errors: {},
    })
    const wrapper = mount(NpmUi, { props: { enterAction: {} } })
    subInputCb?.({ text: 'vue' })
    await new Promise(r => setTimeout(r, 750))
    await flushPromises()
    expect(wrapper.text()).toContain('vue')
    wrapper.unmount()
  })

  it('菜单点击复制对应包管理器（回归 C1）', async () => {
    mockSearch.mockResolvedValue({
      data: [{ id: 'lodash', name: 'lodash', version: '4.17.21', description: '', source: 'npm' }],
      sources: { npm: [], npmmirror: [] },
      errors: {},
    })
    mockMeta.mockResolvedValue({
      name: 'lodash',
      description: '',
      distTags: { latest: '4.17.21' },
      versions: [{ v: '4.17.21', time: Date.now() }],
      readme: '',
    })
    const wrapper = mount(NpmUi, { props: { enterAction: {} } })
    subInputCb?.({ text: 'lodash' })
    await new Promise(r => setTimeout(r, 750))
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))  // 进入版本列表
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))  // 打开菜单
    await flushPromises()
    const pnpmBtn = wrapper.findAll('.menu-box button')[1]
    await pnpmBtn.trigger('click')
    expect(mockWrite).toHaveBeenCalledWith({
      type: 'text',
      content: 'pnpm add lodash@4.17.21',
      shouldPaste: true,
    })
    wrapper.unmount()
  })

  it('菜单按 p 只复制一次（回归双击）', async () => {
    mockSearch.mockResolvedValue({
      data: [{ id: 'lodash', name: 'lodash', version: '4.17.21', description: '', source: 'npm' }],
      sources: { npm: [], npmmirror: [] },
      errors: {},
    })
    mockMeta.mockResolvedValue({
      name: 'lodash',
      description: '',
      distTags: { latest: '4.17.21' },
      versions: [{ v: '4.17.21', time: Date.now() }],
      readme: '',
    })
    const wrapper = mount(NpmUi, { props: { enterAction: {} } })
    subInputCb?.({ text: 'lodash' })
    await new Promise(r => setTimeout(r, 750))
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))  // 进入版本
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))  // 打开菜单
    await flushPromises()
    const overlay = wrapper.find('.menu-overlay')
    await overlay.trigger('keydown', { key: 'p' })
    await flushPromises()
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith({ type: 'text', content: 'pnpm add lodash@4.17.21', shouldPaste: true })
    wrapper.unmount()
  })
})
