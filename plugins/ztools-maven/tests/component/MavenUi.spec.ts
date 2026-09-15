import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { installZtoolsStub, uninstallZtoolsStub } from '../helpers/ztools-stub'
import MavenUi from '../../src/MavenUi/index.vue'

const here = dirname(fileURLToPath(import.meta.url))
const vueSrc = readFileSync(resolve(here, '../../src/MavenUi/index.vue'), 'utf8')
const mainCss = readFileSync(resolve(here, '../../src/main.css'), 'utf8')

describe('MavenUiPanel', () => {
  beforeEach(() => {
    uninstallZtoolsStub()
    installZtoolsStub()
  })

  it('renders empty state initially', () => {
    const w = mount(MavenUi, { props: { enterAction: {} } })
    // Sub-input placeholder is the panel's empty-state label.
    expect((window as any).ztools.setSubInput).toHaveBeenCalledWith(
      expect.any(Function),
      expect.stringContaining('搜索 Maven 包'),
      true,
    )
  })

  it('shows error box with structured details when search fails', async () => {
    const err = Object.assign(new Error('HTTP 500'), { url: 'https://x', status: 500, durationMs: 100, body: 'oops' })
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockRejectedValue(err),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('spring-core')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    expect(w.text()).toContain('搜索失败')
    expect(w.text()).toContain('HTTP 500')
  })

  it('opens action menu on Enter/c/p in version list (Mode A)', async () => {
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
    const w = mount(MavenUi, { props: { enterAction: {} } })
    // Trigger search via the setSubInput callback (debounced 300ms).
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('g')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    // Copy keys are handled globally (onGlobalKey) — dispatch on window.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await w.vm.$nextTick()
    expect(w.text()).toContain('POM')
    expect(w.text()).toContain('XML')
    expect(w.text()).toContain('Android')
    expect(w.text()).toContain('Gradle')
  })

  it('Tab cycles menu focus (Mode A)', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({ data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }], source: 'solr' }),
        mavenVersions: vi.fn().mockResolvedValue({ data: [{ v: '1.0.0', timestamp: 1000 }], source: 'solr' }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('g')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await w.vm.$nextTick()
    await w.find('.menu-overlay').trigger('keydown', { key: 'Tab' })
    await w.find('.menu-overlay').trigger('keydown', { key: 'Enter' })
    expect((window as any).ztools.clipboard.writeContent).toHaveBeenCalled()
  })

  it('g shortcut copies Gradle directly (Mode A)', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({ data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000, source: 'aliyun' }], source: 'aggregated' }),
        mavenVersions: vi.fn().mockResolvedValue({ data: [{ v: '1.0.0', timestamp: 1000 }], source: 'solr' }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('g')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }))
    const calls = (window as any).ztools.clipboard.writeContent.mock.calls
    expect(calls[0][0].content).toBe("implementation 'g:a:1.0.0'")
  })

  it('Cmd/Ctrl+K toggles help overlay', async () => {
    const w = mount(MavenUi, { props: { enterAction: {} } })
    expect(w.find('.help-overlay').exists()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await w.vm.$nextTick()
    expect(w.find('.help-overlay').exists()).toBe(true)
  })

  it('ArrowLeft/Right switches source tab even when results are empty', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [], source: 'aggregated',
          sources: { solr: [], aliyun: [], coderead: [] },
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('nothing')
    await new Promise(r => setTimeout(r, 800))
    await w.vm.$nextTick()
    expect(w.text()).toContain('没找到相关包')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await w.vm.$nextTick()
    const central = w.findAll('.tab').find(b => b.text().includes('Central'))
    expect(central?.classes()).toContain('active')
  })

  it('Android category filters results', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13.0', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12.0', timestamp: 1, source: 'solr' },
          ],
          source: 'aggregated',
          sources: { solr: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13.0', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12.0', timestamp: 1, source: 'solr' },
          ], aliyun: [], coderead: [] },
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('core')
    await new Promise(r => setTimeout(r, 800))
    await w.vm.$nextTick()
    // Both rows visible initially.
    expect(w.text()).toContain('androidx.core:core')
    expect(w.text()).toContain('com.squareup:okhttp')
    // Click Android category.
    const androidCat = w.findAll('.cat').find(b => b.text().includes('Android'))
    await androidCat?.trigger('click')
    await w.vm.$nextTick()
    expect(w.text()).toContain('androidx.core:core')
    expect(w.text()).not.toContain('com.squareup:okhttp')
  })

  it('非安卓 (java) category filters out Android artifacts', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13.0', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12.0', timestamp: 1, source: 'solr' },
          ],
          source: 'aggregated',
          sources: { solr: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13.0', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12.0', timestamp: 1, source: 'solr' },
          ], aliyun: [], coderead: [] },
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('core')
    await new Promise(r => setTimeout(r, 800))
    await w.vm.$nextTick()
    const javaCat = w.findAll('.cat').find(b => b.text().includes('非安卓'))
    await javaCat?.trigger('click')
    await w.vm.$nextTick()
    expect(w.text()).not.toContain('androidx.core:core')
    expect(w.text()).toContain('com.squareup:okhttp')
  })

  it('version panel Android category filters versions', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '2.0.0', timestamp: 1, source: 'solr' }],
          source: 'aggregated',
          sources: { solr: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '2.0.0', timestamp: 1, source: 'solr' }], aliyun: [], coderead: [] },
        }),
        mavenVersions: vi.fn().mockResolvedValue({
          data: [
            { v: '2.0.0', timestamp: 1000 },
            { v: '2.0.60.android8', timestamp: 900 },
          ],
          source: 'solr',
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('g')
    await new Promise(r => setTimeout(r, 800))
    await w.vm.$nextTick()
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    // Both versions listed before filtering.
    expect(w.text()).toContain('2.0.60.android8')
    expect(w.text()).toContain('2.0.0')
    const androidCat = w.findAll('.cat').find(b => b.text().includes('Android'))
    await androidCat?.trigger('click')
    await w.vm.$nextTick()
    expect(w.text()).toContain('2.0.60.android8')
    expect(w.text()).not.toContain('2.0.0')
  })

  it('arrow-down on results list scrolls the active row into view', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [
            { id: 'a:one', g: 'a', a: 'one', latestVersion: '1.0', timestamp: 1000, source: 'solr' },
            { id: 'a:two', g: 'a', a: 'two', latestVersion: '1.0', timestamp: 1000, source: 'solr' },
            { id: 'a:three', g: 'a', a: 'three', latestVersion: '1.0', timestamp: 1000, source: 'solr' },
          ],
          source: 'aggregated',
          sources: { solr: [
            { id: 'a:one', g: 'a', a: 'one', latestVersion: '1.0', timestamp: 1000, source: 'solr' },
            { id: 'a:two', g: 'a', a: 'two', latestVersion: '1.0', timestamp: 1000, source: 'solr' },
            { id: 'a:three', g: 'a', a: 'three', latestVersion: '1.0', timestamp: 1000, source: 'solr' },
          ], aliyun: [], coderead: [] },
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('a')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    const lis = w.findAll('.results li')
    expect(lis.length).toBeGreaterThanOrEqual(2)
    const spy = vi.fn()
    lis[1].element.scrollIntoView = spy
    await w.find('.results ul').trigger('keydown', { key: 'ArrowDown' })
    await w.vm.$nextTick()
    await new Promise(r => setTimeout(r, 10))
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('arrow-down on version list scrolls the active row into view', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000, source: 'solr' }],
          source: 'aggregated',
          sources: { solr: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000, source: 'solr' }], aliyun: [], coderead: [] },
        }),
        mavenVersions: vi.fn().mockResolvedValue({
          data: [
            { v: '1.0.0', timestamp: 1000 },
            { v: '2.0.0', timestamp: 2000 },
            { v: '3.0.0', timestamp: 3000 },
          ],
          source: 'solr',
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('g')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    const lis = w.findAll('.versions li')
    expect(lis.length).toBeGreaterThanOrEqual(2)
    const spy = vi.fn()
    lis[1].element.scrollIntoView = spy
    await w.find('.versions ul').trigger('keydown', { key: 'ArrowDown' })
    await w.vm.$nextTick()
    await new Promise(r => setTimeout(r, 10))
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('list <ul> is the scroll container, not the page (overflow-y: auto)', async () => {
    // jsdom doesn't parse <style scoped>, so verify the rule lives in the
    // component source. The runtime behavior (scrollIntoView on arrow keys)
    // is covered by the two scroll tests below.
    expect(vueSrc).toMatch(/\.results\s*>\s*ul[\s\S]*?overflow-y:\s*auto/)
    expect(vueSrc).toMatch(/\.versions\s*>\s*ul[\s\S]*?overflow-y:\s*auto/)
    // Body and panel are bounded so the page itself can never scroll.
    expect(mainCss).toMatch(/#app[\s\S]*?overflow:\s*hidden/)
    expect(vueSrc).toMatch(/\.maven-panel\s*{[^}]*height:\s*100%/)
  })

  it('shift+arrow keys cycle the category filter (全部 → Android → 非安卓) in both panels', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12', timestamp: 1, source: 'solr' },
          ],
          source: 'aggregated',
          sources: { solr: [
            { id: 'androidx.core:core', g: 'androidx.core', a: 'core', latestVersion: '1.13', timestamp: 1, source: 'solr' },
            { id: 'com.squareup:okhttp', g: 'com.squareup', a: 'okhttp', latestVersion: '4.12', timestamp: 1, source: 'solr' },
          ], aliyun: [], coderead: [] },
        }),
        mavenVersions: vi.fn().mockResolvedValue({
          data: [
            { v: '2.0.60.android8', timestamp: 1000 },
            { v: '2.0.0', timestamp: 900 },
          ],
          source: 'solr',
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('core')
    await new Promise(r => setTimeout(r, 1600))
    await w.vm.$nextTick()

    // Helper: read the currently-active .cat button's label.
    const activeLabel = () =>
      w.findAll('.cat').find(b => b.classes().includes('active'))?.text() ?? ''

    // Results panel: starts at 全部, Shift+→ cycles forward.
    expect(activeLabel()).toMatch(/全部/)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }))
    await w.vm.$nextTick()
    expect(activeLabel()).toMatch(/Android/)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }))
    await w.vm.$nextTick()
    expect(activeLabel()).toMatch(/非安卓/)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }))
    await w.vm.$nextTick()
    expect(activeLabel()).toMatch(/全部/) // wrap

    // Shift+← cycles backward.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }))
    await w.vm.$nextTick()
    expect(activeLabel()).toMatch(/非安卓/)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }))
    await w.vm.$nextTick()
    expect(activeLabel()).toMatch(/Android/)

    // Now move into the version panel and verify it works there too.
    await w.find('.results li').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    expect(activeLabel()).toMatch(/全部/)
    // Regression: Shift+←/→ must NOT trigger the local back action.
    // The local onVersionKey used to swallow ArrowLeft regardless of shift,
    // so Shift+← would return to results and the global handler then cycled
    // the wrong panel's filter.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }))
    await w.vm.$nextTick()
    expect(w.find('.versions').exists()).toBe(true)   // still in versions
    expect(activeLabel()).toMatch(/非安卓/)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }))
    await w.vm.$nextTick()
    expect(w.find('.versions').exists()).toBe(true)
    expect(activeLabel()).toMatch(/全部/)
  })

  it('renders an open-source link to the plugin repo in the footer', () => {
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const link = w.find('.panel-footer .footer-link')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('https://github.com/kshq1996/ztools-maven')
    expect(link.attributes('target')).toBe('_blank')
    // The version is read from package.json — the label should include "v".
    expect(link.text()).toMatch(/^开源 v/)
  })
})
