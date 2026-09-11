import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationScrollController } from '../../src/services/conversation-scroll.js'

if (typeof globalThis.HTMLElement === 'undefined') globalThis.HTMLElement = class HTMLElement {}

/**
 * 创建可模拟浏览器滚动钳制和消息行重排的几何环境。
 * @param {{scrollHeight?: number, clientHeight?: number, scrollTop?: number}} options 初始滚动尺寸。
 * @returns {{scroller: HTMLElement, content: HTMLElement, addRow: (key: string, top: number, height?: number) => Record<string, unknown>, setRowTop: (key: string, top: number) => void}} 测试几何对象。
 */
function createGeometry(options = {}) {
  const state = {
    scrollHeight: options.scrollHeight || 1000,
    clientHeight: options.clientHeight || 300,
    scrollTop: options.scrollTop || 0,
  }
  const rows = []
  const rowTops = new Map()
  const scroller = new HTMLElement()
  Object.defineProperties(scroller, {
    scrollHeight: { get: () => state.scrollHeight, set: (value) => { state.scrollHeight = value } },
    clientHeight: { get: () => state.clientHeight, set: (value) => { state.clientHeight = value } },
    scrollTop: {
      get: () => state.scrollTop,
      set: (value) => { state.scrollTop = Math.max(0, Math.min(Number(value) || 0, state.scrollHeight - state.clientHeight)) },
    },
  })
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: state.clientHeight, left: 0, right: 600, width: 600, height: state.clientHeight })

  const content = new HTMLElement()
  content.querySelectorAll = () => rows
  content.contains = (row) => rows.includes(row)
  content.getBoundingClientRect = () => ({ top: -state.scrollTop, bottom: state.scrollHeight - state.scrollTop, left: 0, right: 600, width: 600, height: state.scrollHeight })

  return {
    scroller,
    content,
    addRow(key, top, height = 80) {
      rowTops.set(key, top)
      const row = new HTMLElement()
      row.dataset = { chatAnchorKey: key }
      row.getBoundingClientRect = () => {
        const currentTop = rowTops.get(key) - state.scrollTop
        return { top: currentTop, bottom: currentTop + height, left: 0, right: 600, width: 600, height }
      }
      rows.push(row)
      return row
    },
    setRowTop(key, top) {
      rowTops.set(key, top)
    },
  }
}

/**
 * 创建按会话记录贴底状态的滚动控制器测试夹具。
 * @returns {{controller: Record<string, Function>, pinned: Map<string, boolean>, setActive: (id: string) => void}} 控制器测试夹具。
 */
function createHarness() {
  let active = 'a'
  const pinned = new Map([['a', true], ['b', true]])
  const controller = createConversationScrollController({
    getActiveSessionId: () => active,
    isPinned: (id) => pinned.get(id) !== false,
    setPinned: (id, value) => pinned.set(id, value),
    threshold: 24,
  })
  return { controller, pinned, setActive: (id) => { active = id } }
}

test('首次恢复会话时原子贴底并清除阅读位置', () => {
  const h = createHarness()
  const geometry = createGeometry({ scrollHeight: 1200, clientHeight: 300 })
  geometry.addRow('tail', 1100)

  assert.equal(h.controller.restore('a', geometry.scroller, geometry.content), true)
  assert.equal(geometry.scroller.scrollTop, 900)
  assert.equal(h.pinned.get('a'), true)
  assert.equal(h.controller.readPosition('a'), null)
})

test('贴底状态下的非阅读者滚动会在内容增长后重新校准到底部', () => {
  const h = createHarness()
  const geometry = createGeometry({ scrollHeight: 800, clientHeight: 300 })
  geometry.addRow('tail', 700)
  h.controller.restore('a', geometry.scroller, geometry.content)

  geometry.scroller.scrollHeight = 1200
  h.controller.handleScroll(geometry.scroller, geometry.content)
  assert.equal(geometry.scroller.scrollTop, 900)
  assert.equal(h.pinned.get('a'), true)
})

test('用户向上阅读后按稳定消息行恢复会话位置', () => {
  const h = createHarness()
  const geometry = createGeometry({ scrollHeight: 1400, clientHeight: 300 })
  geometry.addRow('message-1', 520)
  geometry.addRow('message-2', 760)
  h.controller.restore('a', geometry.scroller, geometry.content)

  geometry.scroller.scrollTop = 450
  h.controller.handleScroll(geometry.scroller, geometry.content)
  assert.equal(h.pinned.get('a'), false)
  const saved = h.controller.readPosition('a')
  assert.equal(saved.anchorKey, 'message-1')

  geometry.setRowTop('message-1', 620)
  geometry.scroller.scrollTop = 0
  h.controller.restore('a', geometry.scroller, geometry.content)
  assert.equal(geometry.scroller.scrollTop, 550)
  assert.equal(h.pinned.get('a'), false)
})

test('旧历史插入后保持原可见业务行的视口坐标', () => {
  const h = createHarness()
  const geometry = createGeometry({ scrollHeight: 1200, clientHeight: 300, scrollTop: 300 })
  geometry.addRow('message-1', 340)
  geometry.addRow('message-2', 560)

  assert.equal(h.controller.beginPrepend('a', geometry.scroller, geometry.content), true)
  geometry.scroller.scrollHeight = 1600
  geometry.setRowTop('message-1', 740)
  geometry.setRowTop('message-2', 960)
  assert.equal(h.controller.finishPrepend('a', geometry.scroller, geometry.content), true)
  assert.equal(geometry.scroller.scrollTop, 700)
  assert.equal(h.pinned.get('a'), false)
})

test('尺寸变化只在会话仍持有贴底所有权时跟随', () => {
  const h = createHarness()
  const geometry = createGeometry({ scrollHeight: 900, clientHeight: 300 })
  geometry.addRow('tail', 800)
  h.controller.restore('a', geometry.scroller, geometry.content)
  geometry.scroller.scrollHeight = 1100
  h.controller.handleResize(geometry.scroller)
  assert.equal(geometry.scroller.scrollTop, 800)

  geometry.scroller.scrollTop = 500
  h.controller.handleScroll(geometry.scroller, geometry.content)
  assert.equal(h.pinned.get('a'), false)
  geometry.scroller.scrollHeight = 1300
  h.controller.handleResize(geometry.scroller)
  assert.equal(geometry.scroller.scrollTop, 500)
})
