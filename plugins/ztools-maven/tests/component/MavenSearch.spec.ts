import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { installZtoolsStub, uninstallZtoolsStub } from '../helpers/ztools-stub'
import MavenSearch from '../../src/MavenSearch/index.vue'

describe('MavenSearchPanel', () => {
  beforeEach(() => {
    uninstallZtoolsStub()
    installZtoolsStub()
  })

  it('shows empty state with fallback link when payload is empty', () => {
    const w = mount(MavenSearch, { props: { enterAction: { payload: '' } } })
    expect(w.text()).toContain('请先输入要搜索的关键字')
    expect(w.text()).toContain('切换到主面板')
  })

  it('triggers search on mount when payload present', async () => {
    const stubs = installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }],
          source: 'solr',
        }),
      } as any,
    })
    mount(MavenSearch, { props: { enterAction: { payload: 'spring-core' } } })
    await new Promise(r => setTimeout(r, 50))
    expect(stubs.services.mavenSearch).toHaveBeenCalled()
  })

  it('Enter/c trigger default copy in Mode B', async () => {
    const stubs = installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }],
          source: 'solr',
        }),
        mavenVersions: vi.fn().mockResolvedValue({
          data: [{ v: '1.0.0', timestamp: 1000 }],
          source: 'solr',
        }),
      } as any,
    })
    const w = mount(MavenSearch, { props: { enterAction: { payload: 'g' } } })
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    await w.find('ul li').trigger('click')
    await w.vm.$nextTick()
    // Now in version list. Press 'c'.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }))
    await w.vm.$nextTick()
    const calls = stubs.ztools.clipboard.writeContent.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0][0].content).toContain('<dependency>')
    expect(stubs.ztools.hideMainWindow).toHaveBeenCalled()
  })

  it('Cmd/Ctrl+K toggles help overlay', async () => {
    const w = mount(MavenSearch, { props: { enterAction: { payload: 'x' } } })
    expect(w.find('.help-overlay').exists()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await w.vm.$nextTick()
    expect(w.find('.help-overlay').exists()).toBe(true)
  })
})