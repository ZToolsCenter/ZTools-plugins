// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import App from '../src/App.vue'

describe('App smoke', () => {
  it('mounts without throwing', async () => {
    // setup minimal window.ztools mocks
    ;(window as any).ztools = {
      dbStorage: {
        getItem: () => undefined,
        setItem: () => {},
        removeItem: () => {}
      },
      db: {
        allDocs: () => [],
        put: () => ({ ok: true, id: '' }),
        get: () => null,
        remove: () => ({ ok: true, id: '' })
      },
      showNotification: () => {},
      shellOpenExternal: () => {},
      copyText: () => {},
      getPath: () => '',
      onPluginEnter: () => {},
      getWindowType: () => 'main',
      isDev: () => true
    }
    ;(window as any).services = {
      jenkins: {
        getJobs: async () => ({ data: [], error: null }),
        getBuilds: async () => ({ data: [], error: null }),
        triggerBuild: async () => ({ error: null }),
        getViews: async () => ({ data: [], error: null }),
        getViewJobs: async () => ({ data: [], error: null }),
        testConnection: async () => ({ success: true, error: null }),
        getBuildConsole: async () => ({ data: '', error: null })
      }
    }

    const wrapper = mount(App)
    expect(wrapper.exists()).toBe(true)
    await nextTick()
    // App should render 3 panels
    const html = wrapper.html()
    expect(html.length).toBeGreaterThan(100)
  })
})