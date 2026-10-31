/**
 * 插件内确认弹窗 回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-confirm.mts
 *
 * 背景：Electron 里的 window.confirm 弹的是**系统原生窗口** —— 跑到插件窗口
 * 外面、不跟主题、还盖住整个屏幕。在 500px 的面板里冒出系统弹窗很突兀，
 * 所以「清理失效」「清空历史」的确认一律在插件窗口内问。
 *
 * 这套测试守三件事：
 *   1. 确认在窗口内问 —— 源码里不许再出现 window.confirm(...) 调用；
 *   2. 状态机可靠 —— 谁问谁拿到自己的答案；来新的弹窗时旧的必须被取消
 *      （否则它的 Promise 永远悬着，await 那条链路再也不往下走）；
 *   3. 弹窗内容如实 —— 清理失效要能看出"几条全没了、几条只缺一部分"，
 *      并给出"只清理完全失效的"这条退路。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望=${e} 实际=${a}`}`)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string): string => readFileSync(join(root, 'src', p), 'utf8')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* 一、契约：界面层                                                     */
/* ------------------------------------------------------------------ */

console.log('--- 契约：系统弹窗必须绝迹 ---')
const appSrc = src('App.vue')
const sidebarSrc = src('components/Sidebar.vue')
const storeSrc = src('composables/useStore.ts')
const dlgSrc = src('components/ConfirmDialog.vue')

for (const [label, s] of [
  ['App.vue', appSrc],
  ['Sidebar.vue', sidebarSrc],
  ['useStore.ts', storeSrc],
  ['ConfirmDialog.vue', dlgSrc]
] as const) {
  // 注释里提这个名字是说明"为什么不用"，不算调用
  check(`${label} 里没有 window.confirm(...) 调用`, /window\.confirm\s*\(/.test(s), false)
  check(`${label} 里也没有 alert(...) 调用`, /(?<!\.)\balert\s*\(/.test(s), false)
}

console.log('\n--- 契约：弹窗接在界面上 ---')
check('App 渲染了确认弹窗', /<ConfirmDialog/.test(appSrc), true)
check('弹窗按状态显隐', /v-if="store\.confirmRequest\.value"/.test(appSrc), true)
check('选择结果回到 store', /@pick="\(c\) => store\.settleConfirm\(c\)"/.test(appSrc), true)
check(
  '弹窗的键盘优先级高于预览层（模态：不能穿透到列表）',
  appSrc.indexOf('if (store.confirmRequest.value)') < appSrc.indexOf('if (previewOpen.value)'),
  true
)
check('Esc 取消', /e\.key === 'Escape' \|\| e\.key === 'Enter'/.test(appSrc), true)
check('Enter = 主操作', /e\.key === 'Enter' \? 'ok' : 'cancel'/.test(appSrc), true)
check('其余按键也吃掉（不然 ↓ 会去动列表）', /else \{\s*e\.preventDefault\(\)\s*\}/.test(appSrc), true)

console.log('\n--- 契约：弹窗本身 ---')
check('遮罩铺满整个窗口（fixed + inset，不依赖父级定位）', /position: fixed;[\s\S]{0,60}inset: 0;/.test(dlgSrc), true)
check('有标题', /class="dlg-title"/.test(dlgSrc), true)
check('说明是逐行展示（不是拼成一段长句）', /v-for="\(line, i\) in req\.lines"/.test(dlgSrc), true)
check('主按钮在最右侧、且是终点色', /class="btn primary"/.test(dlgSrc), true)
check('破坏性操作用红色', /\.btn\.primary\.danger \{ background: var\(--danger\)/.test(dlgSrc), true)
check('次按钮按需出现（没有这一档就不显示）', /v-if="req\.altText"/.test(dlgSrc), true)
check('遮罩层点击 = 取消', /@click\.self="emit\('pick', 'cancel'\)"/.test(dlgSrc), true)
// 焦点一直是宿主子输入框：弹窗一抢焦点，宿主转发的 ↑↓/Enter 就断了
check('弹窗不抢焦点（焦点留给宿主子输入框）', /autofocus|\.focus\(\)/.test(dlgSrc), false)

console.log('\n--- 契约：store 状态机 ---')
check('状态机对外暴露当前弹窗', /confirmRequest/.test(storeSrc), true)
check('取消旧的、只保留一个弹窗', /prev\('cancel'\)/.test(storeSrc), true)
check('结果由 settleConfirm 回收', /function settleConfirm/.test(storeSrc), true)
check('清空历史走 requestClearAll（先问再清）', /async function requestClearAll/.test(storeSrc), true)
check('侧栏清空按钮调的是 requestClearAll', /void store\.requestClearAll\(\)/.test(sidebarSrc), true)
check('清理失效默认问的是插件内弹窗', /cleanStale\(ask: ConfirmAsk = askConfirm\)/.test(storeSrc), true)

/* ------------------------------------------------------------------ */
/* 二、行为：状态机                                                     */
/* ------------------------------------------------------------------ */

console.log('\n--- 行为：状态机 ---')

const now = Date.now()
const items: any[] = [
  { id: 't1', type: 'text', content: '还在的文本', timestamp: now },
  { id: 'f1', type: 'file', timestamp: now - 1, files: [{ path: 'D:\\docs\\存在.txt', name: '存在.txt' }] },
  { id: 'f2', type: 'file', timestamp: now - 2, files: [{ path: 'D:\\docs\\已删除.zip', name: '已删除.zip' }] },
  { id: 'f3', type: 'file', timestamp: now - 3, files: [{ path: 'D:\\docs\\存在.txt', name: '存在.txt' }, { path: 'D:\\docs\\已删除.zip', name: '已删除.zip' }] },
  { id: 'i1', type: 'image', timestamp: now - 4, imagePath: 'E:\\shots\\已删除.png' },
  { id: 'i2', type: 'image', timestamp: now - 5, imagePath: 'E:\\shots\\还在.png' },
  { id: 'f4', type: 'file', timestamp: now - 6, files: [{ path: '\\\\nas\\share\\归档.zip', name: '归档.zip' }] }
]

const removedIds: string[] = []
const toasts: string[] = []
const mem = new Map<string, string>()

const ztoolsStub = {
  setSubInput: () => true,
  subInputFocus: () => true,
  subInputSelect: () => true,
  onPluginEnter: () => undefined,
  onPluginOut: () => undefined,
  outPlugin: () => undefined,
  showToast: (m: string) => void toasts.push(m),
  clipboard: {
    async getHistory(_page: number, pageSize: number) {
      const slice = items.slice(0, Math.min(pageSize, items.length))
      return { items: slice, total: items.length, page: _page, pageSize }
    },
    async delete(id: string) {
      removedIds.push(id)
      const i = items.findIndex((r) => r.id === id)
      if (i >= 0) items.splice(i, 1)
      return { success: true }
    },
    async clear() {
      const n = items.length
      items.length = 0
      return n
    },
    onChange: () => undefined
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
  services: {
    fileExists: (p: string) => {
      if (/^\\\\/.test(String(p))) return null
      return !/已删除/.test(String(p))
    }
  }
}

const { useStore } = await import('../src/composables/useStore.ts')
const s = useStore()

const req = (title: string) => ({ title, lines: [], okText: '好' })

const p1 = s.askConfirm(req('第一个'))
check('弹窗已登记到界面', s.confirmRequest.value?.title, '第一个')
s.settleConfirm('ok')
check('问的人拿到自己的答案', await p1, 'ok')
check('关掉后状态清空', s.confirmRequest.value, null)

// 连续问两次：旧的必须被取消，否则它那条 await 永远不返回
const p2 = s.askConfirm(req('先问的'))
const p3 = s.askConfirm(req('后问的'))
check('先问的那个被挤掉（按取消处理）', await p2, 'cancel')
check('界面上显示的是后问的', s.confirmRequest.value?.title, '后问的')
s.settleConfirm('cancel')
check('后问的拿到取消', await p3, 'cancel')
check('连 settle 两次也不炸', (() => { s.settleConfirm('ok'); return 'ok' })(), 'ok')

s.init()
await sleep(40)
s.stopWatching()
await s.loadFirst()
await sleep(40)

console.log('\n--- 行为：清理失效的弹窗内容 ---')
const seen: any[] = []
await s.cleanStale((r) => {
  seen.push(r)
  return 'cancel'
})
await sleep(20)
check('弹了窗', seen.length, 1)
const req1 = seen[0]
check('标题报总数（全没了 2 + 缺一部分 1）', req1.title, '发现 3 条失效记录')
check('说明第一条是全没了', req1.lines[0], '2 条的原文件已经全部不在了')
check('说明第二条是缺一部分', req1.lines[1], '1 条只有部分文件还在（卡片上标着"已不存在"）')
check('说明里交代了读不到的那些', req1.lines[2], '另有 1 条读不到原位置，已保留')
check('说明里交代了后果', req1.lines[3], '清理后无法恢复；收藏的内容不受影响')
check('主按钮清理全部', req1.okText, '清理 3 条')
check('次按钮是退路：只清完全失效的', req1.altText, '只清理 2 条')
check('是破坏性操作（红色）', req1.danger, true)
check('取消后一条没删', s.records.value.length, 7)

console.log('\n--- 只有一档时不给次按钮 ---')
// 去掉"缺一部分"的那条：只剩 f2 / i1 两条全没了 + 网络路径那条
items.length = 0
items.push(
  { id: 'f2', type: 'file', timestamp: now - 2, files: [{ path: 'D:\\docs\\已删除.zip', name: '已删除.zip' }] },
  { id: 'f4', type: 'file', timestamp: now - 6, files: [{ path: '\\\\nas\\share\\归档.zip', name: '归档.zip' }] }
)
await s.loadFirst()
await sleep(40)
seen.length = 0
await s.cleanStale((r) => {
  seen.push(r)
  return 'ok'
})
await sleep(30)
const req2 = seen[0]
check('只有全没了的这一档', req2.title, '发现 1 条失效记录')
check('没有次按钮（不需要退路）', req2.altText, undefined)
check('主按钮直接清这一条', req2.okText, '清理 1 条')
check('确认后真的删了', removedIds, ['f2'])

console.log('\n--- 行为：清空历史的弹窗内容 ---')
items.length = 0
items.push(
  { id: 't1', type: 'text', content: 'a', timestamp: now },
  { id: 't2', type: 'text', content: 'b', timestamp: now - 1 }
)
await s.loadFirst()
await sleep(40)
seen.length = 0
toasts.length = 0
await s.requestClearAll((r) => {
  seen.push(r)
  return 'cancel'
})
await sleep(20)
check('弹了窗', seen.length, 1)
check('标题报条数', seen[0].title, '清空全部 2 条历史？')
check('说明收藏会保留', seen[0].lines[0], '收藏的内容会保留')
check('说明不可恢复', seen[0].lines[1], '清空后无法恢复')
check('主按钮是"清空"', seen[0].okText, '清空')
check('是破坏性操作', seen[0].danger, true)
check('取消就不清', s.records.value.length, 2)

seen.length = 0
await s.requestClearAll((r) => {
  seen.push(r)
  return 'ok'
})
await sleep(30)
check('确认后清空', s.records.value.length, 0)
check('给了清空提示', toasts[0], '已清空 2 条记录')

console.log('\n--- 没内容时不弹空窗 ---')
toasts.length = 0
seen.length = 0
await s.requestClearAll((r) => {
  seen.push(r)
  return 'ok'
})
await sleep(20)
check('一个弹窗都没弹', seen.length, 0)
check('直接提示已经空了', toasts[0], '已经没有历史了')

s.stopWatching()
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
