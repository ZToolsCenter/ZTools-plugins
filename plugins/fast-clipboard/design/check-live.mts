/**
 * 实时性（新复制的内容要及时出现在列表里）回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-live.mts
 *
 * 背景一（用户反馈："插件在运行时，我复制的东西，插件不实时显示；
 *                   把插件结束运行再打开，就好了"）：
 *   新记录其实已经进了宿主库（重开就能看到），只是**界面没感知到**。
 *   原来的实时性完全指望宿主推送 `clipboard.onChange` —— 而它走的是
 *   主进程 `sendPluginMessage('clipboard-change')`，只发给 `pluginView`
 *   这一个视图，并不是可靠的广播。
 *   修法见 v1.0.21：进入即同步 + 运行期轮询 + 推送当加速器。
 *
 * 背景二（v1.0.26，用户反馈："复制完再按快捷键打开插件，剪贴板没刷新，
 *                        必须结束运行再打开"）：
 *   宿主 `createPluginView()` 里有个 `shouldSkipReEnter()`：插件已经是当前视图、
 *   又用同一条文本指令打开时，直接 `abortCurrentSession('singleton-skip-reenter')`
 *   **不发 `PluginEnter`**。只挂 `onPluginEnter` 的插件就完全不知道窗口又开了：
 *   不一上来同步、轮询还停在退出后的慢速档 → 看着像冻住。
 *   修法：改由**渲染进程自己**能感知的信号唤醒（visibilitychange / focus），
 *   并把"退出"从"停死轮询"改成"降到慢速档"。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望=${String(expected)} 实际=${String(actual)}`}`)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string): string => readFileSync(join(root, 'src', p), 'utf8')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* 一、源码契约                                                          */
/* ------------------------------------------------------------------ */

console.log('--- 契约：不再只指望宿主推送 / 不再只指望 PluginEnter ---')
const store = src('composables/useStore.ts')
const api = src('api.ts')

check(
  '进入插件走统一入口 onShown（不是只 focusSearch + startWatching 各干各的）',
  /api\.onPluginEnter\(\(\) => \{[\s\S]{0,60}onShown\(\)/.test(store),
  true
)
check(
  '退出插件不再把轮询停死，而是降速（idleWatching）',
  /api\.onPluginOut\(\(\) => \{[\s\S]{0,120}idleWatching\(\)/.test(store),
  true
)
check(
  '渲染进程自己监听窗口重新出现（visibilitychange）',
  /addEventListener\('visibilitychange'/.test(store),
  true
)
check('同时监听 window focus 兜底', /addEventListener\('focus'/.test(store), true)
check(
  '同一"次"打开的多个信号要合并，别重复拉历史',
  /SHOW_DEDUPE_MS/.test(store) && /now - lastShownAt < SHOW_DEDUPE_MS/.test(store),
  true
)
check(
  '重新打开时一次补一批（关着的时候可能复制了一串，只补 5 条会留断层）',
  /WAKE_SYNC_SIZE = 50/.test(store) && /syncLatest\(bulk \? WAKE_SYNC_SIZE : HEAD_SIZE\)/.test(store),
  true
)
check(
  '运行期轮询用 setInterval（不只有回调一条路）',
  /function poll\(every: number\)[\s\S]{0,200}setInterval\(/.test(store),
  true
)
check(
  '轮询先用轻量的 getStatus 探路，变了才拉历史',
  /async function hasNewRecords\(\)[\s\S]{0,300}totalCount\.value = n/.test(store),
  true
)
check('新记录是 prepend（最新的一定在最前面）', /records\.value = fresh\.concat\(records\.value\)/.test(store), true)
check(
  '同步时把总数一起跟上（列表变长、侧栏不动也算没实时）',
  /if \(res\.total\) totalCount\.value = res\.total/.test(store),
  true
)
check('api 提供了总数查询（会走宿主 clipboard.getStatus）', /zt\.clipboard\.getStatus/.test(api), true)
check(
  '宿主没有 getStatus 时依然可用（null 视为"可能有新的"）',
  /if \(n === null\) return true/.test(store),
  true
)

/* ------------------------------------------------------------------ */
/* 二、行为：真的能实时看到新内容                                        */
/* ------------------------------------------------------------------ */

/** 假宿主：库本身随时间"变多"，模拟用户在别的窗口复制 */
const items = [
  { id: 'h1', type: 'text', content: '第一条', timestamp: 3_000 },
  { id: 'h2', type: 'text', content: '第二条', timestamp: 2_000 },
  { id: 'h3', type: 'text', content: '第三条', timestamp: 1_000 }
]
let historyCalls = 0
let statusCalls = 0
let enterCb: (() => void) | null = null
let outCb: ((killed: boolean) => void) | null = null
let changeCb: (() => void) | null = null
const mem = new Map<string, string>()

/** 渲染进程侧的监听（store 会自己注册，这里抓下来手动触发） */
let visCb: (() => void) | null = null
let focusCb: (() => void) | null = null
const docStub = {
  hidden: false,
  addEventListener: (type: string, cb: () => void) => {
    if (type === 'visibilitychange') visCb = cb
  }
}

function pushNew(content: string): void {
  items.unshift({
    id: 'new-' + items.length,
    type: 'text',
    content,
    timestamp: 9_000 + items.length
  })
}

const ztoolsStub = {
  setSubInput: () => true,
  subInputFocus: () => true,
  subInputSelect: () => true,
  onPluginEnter: (cb: () => void) => {
    enterCb = cb
    return true
  },
  onPluginOut: (cb: (k: boolean) => void) => {
    outCb = cb
  },
  outPlugin: () => undefined,
  clipboard: {
    async getHistory(_page: number, pageSize: number) {
      historyCalls++
      return { items: items.slice(0, pageSize), total: items.length, page: 1, pageSize }
    },
    async getStatus() {
      statusCalls++
      return { isRunning: true, itemCount: items.length, imageCount: 0, imageStorageSize: 0 }
    },
    onChange: (cb: () => void) => {
      changeCb = cb
    },
    onChangeAlt: null,
    delete: async () => ({ success: true }),
    clear: async () => ({ count: 0 })
  },
  dbStorage: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k)
  },
  isDarkColors: () => false,
  getThemeInfo: () => ({ primaryColor: '#5B8DEF' })
}

;(globalThis as any).window = {
  ztools: ztoolsStub,
  addEventListener: (type: string, cb: () => void) => {
    if (type === 'focus') focusCb = cb
  },
  removeEventListener: () => undefined
}
const { useStore, POLL_INTERVAL_MS, IDLE_POLL_INTERVAL_MS } = await import('../src/composables/useStore.ts')
// document 桩要在 import 之后再挂：Vue 的 runtime-dom 在模块加载时就会
// 访问 document.createElement，提前塞桩会把它的初始化路径带偏。
;(globalThis as any).document = docStub
const s = useStore()
s.init()
await sleep(40)

console.log('\n--- 数据就绪 ---')
check('首屏拉到 3 条', s.records.value.length, 3)
check('最新的一条在最前面', s.records.value[0].id, 'h1')
check('注册了宿主推送', typeof changeCb, 'function')
check('注册了进入/退出事件', enterCb !== null && outCb !== null, true)
check('自己也在监听窗口可见性', typeof visCb, 'function')
check('还在监听窗口焦点', typeof focusCb, 'function')

console.log('\n--- 进来之前复制的内容：一进来就该看到 ---')
pushNew('打开插件前复制的')
enterCb?.()
await sleep(80)
check('列表头部出现新内容', s.records.value[0].content, '打开插件前复制的')
check('列表条数同步', s.records.value.length, 4)
check('侧栏计数同步', s.counts.all, 4)
check('没有把老记录挤掉', s.records.value.some((r) => r.id === 'h1'), true)

console.log('\n--- 运行中新复制：轮询兜底（没有推送也要更新）---')
const before = s.records.value.length
pushNew('运行中复制的第一条')
await sleep(POLL_INTERVAL_MS + 400)
check('没有宿主推送也更新了', s.records.value.length, before + 1)
check('新内容在最前面', s.records.value[0].content, '运行中复制的第一条')
check('确实先查了总数（便宜的那次）', statusCalls > 0, true)

console.log('\n--- 没有新内容时不要徒增 IPC ---')
const callsBefore = historyCalls
await sleep(POLL_INTERVAL_MS + 300)
check('总数没变就不拉历史', historyCalls, callsBefore)

console.log('\n--- 宿主推送时也立刻同步 ---')
pushNew('推送来的那条')
changeCb?.()
await sleep(80)
check('推送后拿到新内容', s.records.value[0].content, '推送来的那条')

console.log('\n--- 插入头部要保住"正看着的那一条" ---')
const target = s.records.value[2]
s.selectedIndex.value = 2
pushNew('插入时的第三条')
await s.syncLatest()
check('选中下标跟着下移', s.selectedIndex.value, 3)
check('选中的还是原来那条记录', s.filtered.value[s.selectedIndex.value].id, target.id)
pushNew('再来一条')
await s.syncLatest()
check('连续插入也跟得上', s.filtered.value[s.selectedIndex.value].id, target.id)
s.selectedIndex.value = 0

console.log('\n--- 重复同步不该产生重复记录 ---')
const n0 = s.records.value.length
await s.syncLatest()
await s.syncLatest()
check('重复同步条数不变', s.records.value.length, n0)
check('没有重复 id', new Set(s.records.value.map((r) => r.id)).size, n0)

/* --- 本次修复的核心回归：宿主跳过 PluginEnter，只靠页面可见性唤醒 --- */
console.log('\n--- 关键回归：宿主跳过 PluginEnter（同指令重入）时，窗口重新可见就要刷新 ---')
outCb?.(false) // 用户按快捷键关掉插件 → 宿主 hidePluginView()
await sleep(20)
pushNew('关着的时候复制的')
docStub.hidden = false
visCb?.() // 宿主没发 PluginEnter，只会有"窗口重新可见"
await sleep(120)
check('只靠 visibilitychange 也刷新了', s.records.value[0].content, '关着的时候复制的')
check('计数跟上', s.counts.all, items.length)

console.log('\n--- 关着的时候复制了一串：重新打开要一次补齐（不止 5 条）---')
outCb?.(false)
for (let i = 0; i < 8; i++) pushNew('批量 ' + i)
const lenBeforeBulk = s.records.value.length
await sleep(350) // 跨过"同一次打开"的去重窗口
focusCb?.() // 这一路用窗口焦点唤醒
await sleep(150)
check('8 条全部补上（HEAD_SIZE=5 会漏 3 条）', s.records.value.length, lenBeforeBulk + 8)
check('最新的一条在最前面', s.records.value[0].content, '批量 7')

console.log('\n--- 退出后降为慢速档：不再每秒探一次，但仍能感知变化 ---')
outCb?.(false)
const statusBefore = statusCalls
await sleep(POLL_INTERVAL_MS + 400)
check('退出后 1.6 秒内不再高频探测', statusCalls, statusBefore)

pushNew('退出后复制的')
await sleep(IDLE_POLL_INTERVAL_MS + 500)
check('慢速档仍然会兜底同步', s.records.value[0].content, '退出后复制的')
check('确实查过宿主', statusCalls > statusBefore, true)

console.log('\n--- 再次进入：不重复、不多余 ---')
const lenBeforeEnter = s.records.value.length
await sleep(350)
enterCb?.()
await sleep(150)
check('再次进入不产生重复记录', s.records.value.length, lenBeforeEnter)
check('id 也没有重复', new Set(s.records.value.map((r) => r.id)).size, lenBeforeEnter)

s.stopWatching()

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
