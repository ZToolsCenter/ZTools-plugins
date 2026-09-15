import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dir, '../..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')) as {
  tools: Record<string, unknown>
}

const expectedTools = [
  'get_mcp_capabilities',
  'get_bookmark_tree',
  'list_groups',
  'list_bookmarks',
  'search_bookmarks',
  'get_bookmark',
  'open_bookmark',
  'create_group',
  'update_group',
  'remove_group',
  'create_sub_group',
  'update_sub_group',
  'remove_sub_group',
  'create_bookmark',
  'update_bookmark',
  'set_bookmark_locations',
  'remove_bookmark',
  'restore_bookmark'
]

class TestCustomEvent<T = unknown> {
  constructor(readonly type: string, readonly init: { detail?: T } = {}) {}
  get detail() { return this.init.detail }
}

describe('uTools MCP 桥接', () => {
  test('MCP 清单暴露完整且唯一的工具集合', () => {
    expect(Object.keys(manifest.tools).sort()).toEqual([...expectedTools].sort())
    for (const tool of Object.values(manifest.tools) as Array<{ inputSchema?: unknown }>) {
      expect(tool.inputSchema).toBeDefined()
    }
  })

  test('preload 注册每个声明工具，并可完成渲染层往返', async () => {
    const listeners = new Map<string, Array<(event: { detail?: any }) => void>>()
    const handlers = new Map<string, (params: Record<string, unknown>, context?: any) => Promise<unknown>>()
    const window = {
      addEventListener(type: string, listener: (event: { detail?: any }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
      removeEventListener(type: string, listener: (event: { detail?: any }) => void) {
        listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener))
      },
      dispatchEvent(event: { type: string; detail?: any }) {
        for (const listener of listeners.get(event.type) ?? []) listener(event)
        return true
      },
      localStorage: { getItem: () => null },
      screenX: 0,
      screenY: 0
    }
    const utools = {
      db: { get: () => null },
      setExpendHeight: () => {},
      registerTool(name: string, handler: (params: Record<string, unknown>, context?: any) => Promise<unknown>) {
        handlers.set(name, handler)
      }
    }
    window.addEventListener('goose-marks:mcp-tool-request', (event) => {
      window.dispatchEvent(new TestCustomEvent('goose-marks:mcp-tool-response', {
        detail: { requestId: event.detail.requestId, ok: true, result: { delegatedTool: event.detail.tool, params: event.detail.params } }
      }))
    })

    const source = fs.readFileSync(path.join(root, 'preload/preload.cjs'), 'utf8')
    const requireFromPreload = (id: string) => {
      if (id === './web-fetch.cjs') return { fetchPublicText: async () => ({ ok: false }) }
      return require(id)
    }
    vm.runInNewContext(source, { window, utools, require: requireFromPreload, CustomEvent: TestCustomEvent, process, console, setTimeout, clearTimeout })

    expect([...handlers.keys()].sort()).toEqual([...expectedTools].sort())
    window.__gooseMarksMcpReady = true
    const result = await handlers.get('list_bookmarks')!({ limit: 1, __proto__: { polluted: true } }, {
      sendProgress: async () => undefined
    })
    expect(result).toEqual({ delegatedTool: 'list_bookmarks', params: { limit: 1 } })
  })
})
