/**
 * 实时性（新复制的内容要及时出现在列表里）回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-live.mts
 *
 * 背景（用户反馈："插件在运行时，我复制的东西，插件不实时显示；
 *                 把插件结束运行再打开，就好了"）：
 *   新记录其实已经进了宿主库（重开就能看到），只是**界面没感知到**。
 *   原来的实时性完全指望宿主推送 `clipboard.onChange` —— 而它走的是
 *   主进程 `sendPluginMessage('clipboard-change')`，只发给 `pluginView`
 *   这一个视图，并不是可靠的广播。
 *
 *   修法：三重保障
 *     1. 进来就看一眼（打开插件前复制的内容）
 *     2. 运行期轮询兜底（用轻量的 getStatus().itemCount 探路，变了才拉历史）
 *     3. 宿主推送只当加速器（收到就立刻同步一次）
 *   并且**插件退出就停止轮询**，不白占 IPC。
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

/* ------------------------------------------------------------------ */
/* 一、源码契约                                                          */
/* ------------------------------------------------------------------ */

console.log('--- 契约：不再只指望宿主推送 ---')
const store = src('composables/useStore.ts')
const api = src('api.ts')

check(
  '进入插件时开始盯，退出时停止盯（不在后台白跑 IPC）',
  /api\.onPluginEnter\(\(\) => \{[\s\S]{0,200}startWatching\(\)/.test(store) &&
    /api\.onPluginOut\(\(\) => \{[\s\S]{0,200}stopWatching\(\)/.test(store),
  true
)
check('运行期轮询用 setInterval（不只有回调一条路）', /pollTimer = setInterval\(/.test(store), true)
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

;(globalThis as any).window = { ztools: ztoolsStub }

const { useStore, POLL_INTERVAL_MS } = await import('../src/composables/useStore.ts')
const s = useStore()
s.init()
await new Promise((r) => setTimeout(r, 40))

console.log('\n--- 数据就绪 ---')
check('首屏拉到 3 条', s.records.value.length, 3)
check('最新的一条在最前面', s.records.value[0].id, 'h1')
check('注册了宿主推送', typeof changeCb, 'function')
check('注册了进入/退出事件', enterCb !== null && outCb !== null, true)

console.log('\n--- 进来之前复制的内容：一进来就该看到 ---')
pushNew('打开插件前复制的')
enterCb?.()
await new Promise((r) => setTimeout(r, 80))
check('列表头部出现新内容', s.records.value[0].content, '打开插件前复制的')
check('列表条数同步', s.records.value.length, 4)
check('侧栏计数同步', s.counts.all, 4)
check('没有把老记录挤掉', s.records.value.some((r) => r.id === 'h1'), true)

console.log('\n--- 运行中新复制：轮询兜底（没有推送也要更新）---')
const before = s.records.value.length
pushNew('运行中复制的第一条')
await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS + 400))
check('没有宿主推送也更新了', s.records.value.length, before + 1)
check('新内容在最前面', s.records.value[0].content, '运行中复制的第一条')
check('确实先查了总数（便宜的那次）', statusCalls > 0, true)

console.log('\n--- 没有新内容时不要徒增 IPC ---')
const callsBefore = historyCalls
await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS + 300))
check('总数没变就不拉历史', historyCalls, callsBefore)

console.log('\n--- 宿主推送时也立刻同步 ---')
pushNew('推送来的那条')
changeCb?.()
await new Promise((r) => setTimeout(r, 80))
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

console.log('\n--- 退出插件后停止轮询（不在后台白跑）---')
outCb?.(false)
const statusBefore = statusCalls
const lenBefore = s.records.value.length
pushNew('退出后复制的')
await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS + 400))
check('退出后不再查宿主', statusCalls, statusBefore)
check('列表不再变化', s.records.value.length, lenBefore)

console.log('\n--- 再次进入：一次补上 ---')
enterCb?.()
await new Promise((r) => setTimeout(r, 100))
check('重新进入后补上了', s.records.value[0].content, '退出后复制的')
check('计数正确', s.counts.all, lenBefore + 1)

s.stopWatching()

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
