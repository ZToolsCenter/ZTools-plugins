import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../../src/App.vue'

let enterCb: ((a: any) => void) | null = null

beforeEach(() => {
  enterCb = null
  ;(window as any).ztools = {
    onPluginEnter: (cb: any) => { enterCb = cb },
    onPluginOut: vi.fn(),
    setSubInput: vi.fn(),
    dbStorage: { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() },
    clipboard: { writeContent: vi.fn() },
    showNotification: vi.fn(),
    hideMainWindow: vi.fn(),
    isDarkColors: vi.fn(() => false),
  }
  ;(window as any).services = {
    npmSearch: vi.fn().mockResolvedValue({ data: [], sources: { npm: [], npmmirror: [] }, errors: {} }),
    npmMeta: vi.fn().mockResolvedValue({ name: '', description: '', distTags: {}, versions: [], readme: '' }),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    setProxy: vi.fn(),
    getProxy: vi.fn(),
  }
})

describe('App routing', () => {
  it('无 route 时默认渲染 NpmUi', () => {
    const wrapper = mount(App)
    expect(wrapper.find('.npm-panel').exists()).toBe(true)
    wrapper.unmount()
  })

  it('各 feature code 路由到对应组件；未知 code 回退 NpmUi', async () => {
    const wrapper = mount(App)
    const cases: [string, string][] = [
      ['npm-search', '.npm-quick'],
      ['no-such-code', '.npm-panel'],
    ]
    for (const [code, selector] of cases) {
      enterCb?.({ code, type: 'over', payload: 'vue' })
      await nextTick()
      expect(wrapper.find(selector).exists(), `code ${code} → ${selector}`).toBe(true)
    }
    wrapper.unmount()
  })

  it('无 window.ztools 时安全渲染（浏览器预览）', () => {
    ;(window as any).ztools = undefined
    const wrapper = mount(App)
    expect(wrapper.find('.npm-panel').exists()).toBe(true)
    wrapper.unmount()
  })
})
