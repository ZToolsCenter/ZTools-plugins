/**
 * 实时性（新复制的内容要及时出现在列表里）回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-live.mts
 *
 * 三次踩坑累积下来的规则：
 *
 * ① v1.0.21（用户："插件在运行时复制的东西不实时显示，结束运行再打开就好"）
 *    宿主推送 `clipboard.onChange` → 主进程 `sendPluginMessage('clipboard-change')`，
 *    只发给 `pluginView` 这一个视图，不是广播，收不到就是收不到。
 *    → 加运行期轮询兜底。
 *
 * ② v1.0.26（用户："复制完按快捷键再打开，剪贴板没刷新"）
 *    宿主 `createPluginView()` 的 `shouldSkipReEnter()`：插件已是当前视图 + 同一条
 *    文本指令 → 直接 `abortCurrentSession('singleton-skip-reenter')`，**不派发
 *    `PluginEnter`**。只监听该事件的插件根本不知道窗口又开了。
 *    → 改由 `visibilitychange` / `focus` / 定时器跳拍多路唤醒。
 *
 * ③④ 之间还叠了一层：v1.0.29 加了"构建戳自检 + 版本徽标"，才发现前三轮修复
 *    用户根本没跑到（dev 视图持久化，跑的一直是旧 JS）—— 先让它能测，再谈对错。

 * ③ v1.0.27（用户："点其他地方让主窗口关闭，再按快捷键打开，数据不是最新的"）
 *    **状态机把自己锁死**：`hasNewRecords()` 探到宿主计数变了就先把 `totalCount`
 *    改掉，再去异步同步；只要那一次同步没成功并进记录（宿主正在写库 / 返回的 id
 *    全都已存在 / 这一拍抛错被吞），`totalCount` 就已经等于宿主计数 →
 *    下一拍判定"没变化" → **永远不同步**，只能整页重载。
 *    → 计数拆成 `syncedCount`（确认追平才推进）；轮询不再分台前台后；
 *      用"定时器跳拍"识别刚从隐藏/挂起恢复。

 * ④ v1.0.30（真机诊断日志实锤）：**宿主历史有上限（满 1000 条）** —— 每复制一条
 *    都是"加一条、挤掉一条"，`getStatus().itemCount` 恒等于 1000。而 1.0.21 以来
 *    所有实时路径（轮询探路 / 打开对账 / onChange 推送）全都"数量变了才拉"，
 *    满库时这道闸门永远判定"没变化"，什么都不拉。浏览器 mock 计数无上限，测不出。
 *    → **彻底废弃计数闸门**：每拍直接 getHistory 比对真实 id；无新增但头部与
 *      宿主不一致（满库挤掉 / 顺序变化）→ 整页重拉。
 */

import { readFileSync, existsSync } from 'node:fs'
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

console.log('--- 契约：不拿 itemCount 当同步闸门（宿主历史满 1000 后计数恒定）---')
const store = src('composables/useStore.ts')
const api = src('api.ts')

check('计数探路函数已删除（满库时它永远判定"没变化"）', /hasNewRecords/.test(store), false)
check('"已追平计数"状态已删除（同一个原因）', /syncedCount/.test(store), false)
check('api 不再暴露 clipboardCount', /clipboardCount/.test(api), false)
check('轮询每拍直接拉最新一批比对真实 id', /await syncLatest\(HEAD_SIZE\)/.test(store), true)
check(
  '无新增但头部与宿主不一致 → 整页重拉（满库挤掉 / 顺序变化只能靠 id 发现）',
  /头部与宿主不一致[\s\S]{0,120}await loadFirst\(\)/.test(store),
  true
)
check('宿主推送（onChange）直达 syncLatest，不再过计数闸门', /onChange（宿主推送）→ sync'[\s\S]{0,120}void syncLatest\(\)/.test(store), true)
check('同步失败下一拍重试（catch 不吞成永久静默）', /catch \(e\) \{[\s\S]{0,80}syncLatest[\s\S]{0,200}return 0/.test(store), true)

console.log('\n--- 契约：轮询不再分台前台后 ---')
check(
  '只有一个轮询计时器（重复调用不重建）',
  /function poll\(\): void \{[\s\S]{0,160}if \(pollTimer\) return/.test(store),
  true
)
check('退出插件后轮询继续（不再降档/停死）', /function idleWatching\(\): void \{[\s\S]{0,80}poll\(\)/.test(store), true)

console.log('\n--- 契约：dev 视图持久化 → 新构建要能自动生效 ---')
check(
  '构建戳自检只在 file:// 下生效（dev server 有 HMR；市场版走宿主更新流）',
  /location\.protocol !== 'file:'\) return/.test(store),
  true
)
check('磁盘戳与页面戳不一致就整页重载', /stamp !== __BUILD_STAMP__[\s\S]{0,140}location\.reload\(\)/.test(store), true)
check('onShown 第一件事就是查构建戳（真要重载的话后面都是白做）', /function onShown\(source[^)]*\): void \{[\s\S]{0,160}checkNewBuild\(\)/.test(store), true)
check('preload 提供 readBuildStamp（读 dist/BUILD_ID）', /readBuildStamp\(\) \{[\s\S]{0,300}BUILD_ID/.test(readFileSync(join(root, 'src-ztools/preload/services.js'), 'utf8')), true)
check('vite 构建时写 BUILD_ID 并注入页面戳', /__BUILD_STAMP__[\s\S]{0,80}closeBundle/.test(readFileSync(join(root, 'vite.config.js'), 'utf8')) || /closeBundle[\s\S]{0,400}BUILD_ID/.test(readFileSync(join(root, 'vite.config.js'), 'utf8')), true)
check('dist/BUILD_ID 已随最近一次构建生成', existsSync(join(root, 'src-ztools/dist/BUILD_ID')), true)
check('侧栏常亮版本徽标（对账"跑的是哪版"）', /foot-ver[\s\S]{0,120}appVersion/.test(readFileSync(join(root, 'src/components/Sidebar.vue'), 'utf8')), true)
check('间隔是 1.2 秒', /export const POLL_INTERVAL_MS = 1200/.test(store), true)
check(
  '定时器跳拍 = 刚从隐藏/挂起恢复（不依赖宿主事件）',
  /function tick\(\)[\s\S]{0,400}POLL_INTERVAL_MS \* 2\.5/.test(store),
  true
)
check(
  '跳拍/重新出现后的对账 = 拉最新 50 条（走统一 syncLatest，含头部核对）',
  /async function refreshOnShow\(\)[\s\S]{0,300}syncLatest\(WAKE_SYNC_SIZE\)/.test(store),
  true
)

console.log('\n--- 契约：多路唤醒（宿主可能什么都不发）---')
check('进入插件走统一入口 onShown', /api\.onPluginEnter\(\(\) => \{[\s\S]{0,160}onShown\('enter'\)/.test(store), true)
check('监听 visibilitychange', /addEventListener\('visibilitychange'/.test(store), true)
check('监听 window focus', /addEventListener\('focus'/.test(store), true)
check('同一次打开的多个信号会去重', /SHOW_DEDUPE_MS/.test(store), true)
check('用户一动（键盘）也顺手对账一次', /addEventListener\('keydown', onInteract, true\)/.test(store), true)
check('用户一动（鼠标）也顺手对账一次', /addEventListener\('mousemove', onInteract/.test(store), true)
check('用动画帧停摆来识别"窗口刚出现"（一帧内就能察觉）', /function watchFrames\(\)[\s\S]{0,400}requestAnimationFrame\(loop\)/.test(store), true)
check('对账委托给统一的 syncLatest（含头部核对）', /async function refreshOnShow\(\)[\s\S]{0,300}await syncLatest\(WAKE_SYNC_SIZE\)/.test(store), true)
check('对账有 120ms 去重（多路唤醒同帧触发不重复拉）', /REFRESH_DEDUPE_MS = 120/.test(store), true)

console.log('\n--- 契约：其余基础能力 ---')
check('新记录 prepend', /records\.value = fresh\.concat\(records\.value\)/.test(store), true)
check('显示计数跟宿主总数对齐', /totalCount\.value = total/.test(store), true)
check('api 已不依赖 getStatus（那是个会骗人的信号）', /getStatus/.test(api), false)
check('dev 诊断日志接好（真机排查全靠它）', /function dbg\(line: string\)/.test(store), true)

/* ------------------------------------------------------------------ */
/* 二、行为                                                            */
/* ------------------------------------------------------------------ */

const items = [
  { id: 'h1', type: 'text', content: '第一条', timestamp: 3_000 },
  { id: 'h2', type: 'text', content: '第二条', timestamp: 2_000 },
  { id: 'h3', type: 'text', content: '第三条', timestamp: 1_000 }
]
let historyCalls = 0
let statusCalls = 0
let lastPageSize = 0
const pageSizes: number[] = []
/** 大于 0 时，接下来的 getHistory 抛错（模拟宿主写库期间的竞态） */
let historyFailures = 0
let enterCb: (() => void) | null = null
let outCb: ((killed: boolean) => void) | null = null
let changeCb: (() => void) | null = null
const mem = new Map<string, string>()

/** 手动驱动的动画帧桩：store 的"恢复检测"就挂在这上面 */
const rafQueue: Array<() => void> = []
;(globalThis as any).requestAnimationFrame = (cb: () => void): number => {
  rafQueue.push(cb)
  return rafQueue.length
}
function nextFrame(): void {
  const pending = rafQueue.splice(0)
  pending.forEach((cb) => cb())
}

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
    id: 'new-' + items.length + '-' + content,
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
      lastPageSize = pageSize
      pageSizes.push(pageSize)
      if (historyFailures > 0) {
        historyFailures--
        throw new Error('宿主正忙（模拟写库竞态）')
      }
      return { items: items.slice(0, pageSize), total: items.length, page: 1, pageSize }
    },
    async getStatus() {
      // 复刻真机形态：宿主历史上限 1000，满库后每复制一条 = 加一条挤一条，
      // itemCount 恒定不变 —— 计数闸门在这份数据上永远判定"没变化"。
      statusCalls++
      return { isRunning: true, itemCount: 1000, imageCount: 0, imageStorageSize: 0 }
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

const { useStore, POLL_INTERVAL_MS } = await import('../src/composables/useStore.ts')
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
check('自己监听窗口可见性', typeof visCb, 'function')
check('也监听窗口焦点', typeof focusCb, 'function')

console.log('\n--- 进来之前复制的内容：一进来就该看到 ---')
pushNew('打开插件前复制的')
enterCb?.()
await sleep(120)
check('列表头部出现新内容', s.records.value[0].content, '打开插件前复制的')
check('列表条数同步', s.records.value.length, 4)
check('侧栏计数同步', s.counts.all, 4)

console.log('\n--- 运行中新复制：轮询兜底（没有推送也要更新）---')
const before = s.records.value.length
pushNew('运行中复制的第一条')
await sleep(POLL_INTERVAL_MS + 400)
check('没有宿主推送也更新了', s.records.value.length, before + 1)
check('新内容在最前面', s.records.value[0].content, '运行中复制的第一条')

console.log('\n--- 每拍都比对真实 id（满库时计数不涨，没有别的信号可用）---')
const callsBefore = historyCalls
const lenBefore = s.records.value.length
await sleep(POLL_INTERVAL_MS + 300)
check('轮询确实在拉（不做计数预判）', historyCalls > callsBefore, true)
check('没有新内容时列表不动', s.records.value.length, lenBefore)

console.log('\n--- 宿主推送时也立刻同步 ---')
pushNew('推送来的那条')
changeCb?.()
await sleep(120)
check('推送后拿到新内容', s.records.value[0].content, '推送来的那条')

console.log('\n--- 插入头部要保住"正看着的那一条" ---')
const target = s.records.value[2]
s.selectedIndex.value = 2
pushNew('插入时的第三条')
await s.syncLatest()
check('选中下标跟着下移', s.selectedIndex.value, 3)
check('选中的还是原来那条记录', s.filtered.value[s.selectedIndex.value].id, target.id)
s.selectedIndex.value = 0

console.log('\n--- ★ 关键回归：计数先涨 + 同步失败，不能锁死 ---')
pushNew('同步失败那一次')
historyFailures = 5 // 接下来几拍 getHistory 都抛错（宿主写库竞态的真实形态）
await sleep(POLL_INTERVAL_MS + 400)
check('失败期间确实没同步进来', s.records.value.some((r) => r.content === '同步失败那一次'), false)
historyFailures = 0 // 宿主缓过来了
await sleep(POLL_INTERVAL_MS + 500)
check('恢复后仍能补上（旧写法会永远卡住）', s.records.value[0].content, '同步失败那一次')

console.log('\n--- ★ 关键回归：历史已满（itemCount 恒 1000）也要实时更新 ---')
check('同步决策完全不依赖 getStatus（满库时它是恒值）', statusCalls, 0)
pushNew('满库时复制的一条')
await sleep(POLL_INTERVAL_MS + 400)
check('计数恒定也照样更新', s.records.value[0].content, '满库时复制的一条')

console.log('\n--- ★ 关键回归：定时器被挂起后恢复（跳拍）也要刷新 ---')
outCb?.(false) // 点别处 → 主窗口关闭，页面的定时器被冻结
pushNew('挂起期间复制的')
const realNow = Date.now
Date.now = () => realNow() + 10_000 // 模拟"恢复时已经过去很久"
await sleep(POLL_INTERVAL_MS + 500)
Date.now = realNow
check('跳拍后被识别为"重新打开"并追平', s.records.value[0].content, '挂起期间复制的')
check('对账是一次拉一批（不止 5 条）', pageSizes.includes(50), true)

console.log('\n--- ★ 关键回归：窗口重新出现的第一帧就追平（不靠定时器）---')
s.stopWatching() // 先把轮询兜底停掉，证明这一路是"帧"触发的（不要调用 outCb，它会重启轮询）
pushNew('第一帧就该看到')
await sleep(200) // 跨过对账去重窗口
nextFrame() // 建立帧基线
nextFrame()
const realNow2 = Date.now
Date.now = () => realNow2() + 1_000 // 模拟窗口隐藏了一段时间后重新出现
nextFrame() // 恢复后的第一帧
Date.now = realNow2
await sleep(150)
check('一帧之内就补齐了', s.records.value[0].content, '第一帧就该看到')
enterCb?.() // 重新打开，把轮询兜底恢复起来，供后面的用例使用

console.log('\n--- 关着的时候复制了一串：重新打开要一次补齐 ---')
outCb?.(false)
for (let i = 0; i < 8; i++) pushNew('批量 ' + i)
await sleep(400) // 跨过"同一次打开"的去重窗口
focusCb?.()
await sleep(350)
check('8 条全部补上', s.records.value.filter((r) => r.content.startsWith('批量')).length, 8)
check('最新的一条在最前面', s.records.value[0].content, '批量 7')

console.log('\n--- 退出插件后轮询仍在跑（否则"马上再打开"就是旧的）---')
outCb?.(false)
const historyAfterOut = historyCalls
pushNew('退出后复制的')
await sleep(POLL_INTERVAL_MS + 400)
check('台后照样探测', historyCalls > historyAfterOut, true)
check('台后也能同步进来', s.records.value[0].content, '退出后复制的')

console.log('\n--- 再次进入：不重复、不多余 ---')
const lenBeforeEnter = s.records.value.length
await sleep(400)
enterCb?.()
await sleep(250)
check('不产生重复记录', s.records.value.length, lenBeforeEnter)
check('id 也没有重复', new Set(s.records.value.map((r) => r.id)).size, lenBeforeEnter)

s.stopWatching()

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
