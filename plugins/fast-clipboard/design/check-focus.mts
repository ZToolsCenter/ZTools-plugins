/**
 * 打开插件自动聚焦搜索框 回归测试
 *   node --experimental-strip-types design/check-focus.mts
 *
 * 背景（读本机 ZTools 安装目录里的宿主源码确认）：
 *   process 模式进入插件的顺序是
 *     setExpendHeight → pluginView.webContents.focus() → 派发 PluginEnter
 *   宿主**先**把焦点给插件页面，**后**才通知"插件已进入"。所以页面挂载时那次
 *   setSubInput(isFocus=true) 必然被随后的 view.focus() 抢走 —— 聚焦必须放在
 *   onPluginEnter 里，而且要有重试（窗口显示/渲染 ack 还会再抢一次）。
 *
 * 另外确认过：子输入框获得焦点后，宿主会把 ↑ ↓ ← → Enter Tab 通过 sendInputEvent
 * 转发给插件页面，所以聚焦搜索框不会破坏键盘流。
 */

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望=${String(expected)} 实际=${String(actual)}`}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* 伪造宿主：能录事件顺序、能模拟"先抢焦点再派发 enter"                */
/* ------------------------------------------------------------------ */

const log: string[] = []
let focusCalls = 0
let selectCalls = 0
let enterCb: ((p: unknown) => void) | null = null
let outCb: ((processExit: boolean) => void) | null = null
/** 让 focusSubInput 返回失败，用来验证兜底路径 */
let focusShouldFail = false

const store = new Map<string, string>()

const ztoolsStub = {
  setSubInput(onChange: unknown, placeholder: string, isFocus = true) {
    log.push(`setSubInput(isFocus=${isFocus})`)
    return typeof onChange === 'function'
  },
  subInputFocus() {
    focusCalls++
    log.push('focus')
    return !focusShouldFail
  },
  subInputSelect() {
    selectCalls++
    log.push('select')
    return !focusShouldFail
  },
  onPluginEnter(cb: (p: unknown) => void) {
    enterCb = cb
  },
  onPluginOut(cb: (p: boolean) => void) {
    outCb = cb
  },
  clipboard: {
    async getHistory(_page: number, pageSize: number) {
      const n = Math.min(pageSize, 3)
      const items = Array.from({ length: n }, (_, i) => ({
        id: 'r' + i, type: 'text', content: 'item ' + i, timestamp: Date.now()
      }))
      return { items, total: 3, page: _page, pageSize }
    },
    onChange(_cb: () => void) {
      /* 开发期不触发 */
    }
  },
  dbStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  },
  isDarkColors: () => false,
  getThemeInfo: () => ({ primaryColor: '#5B8DEF' })
}

;(globalThis as any).window = { ztools: ztoolsStub }

const { useStore } = await import('../src/composables/useStore.ts')
const s = useStore()

console.log('--- 初始化：注册进入事件 ---')
s.init()
check('进入事件已注册', typeof enterCb, 'function')
check('退出事件已注册', typeof outCb, 'function')
check('子输入框注册成功', s.subInputReady.value, true)

/** 模拟宿主：先把焦点给插件页面，再派发 PluginEnter */
async function hostEnter(): Promise<void> {
  log.push('view.focus')
  enterCb?.({ code: 'clipboard', type: 'text', payload: '' })
  await sleep(450) // 等重试（0 / 120 / 320ms）跑完
}

console.log('\n--- 打开插件：焦点必须抢在宿主之后 ---')
await hostEnter()
check('聚焦请求已发出', focusCalls > 0, true)
check('焦点是在宿主抢焦点之后才要回来的', log.indexOf('focus') > log.indexOf('view.focus'), true)
check('空关键词用聚焦而非全选', selectCalls, 0)
check('多次重试（覆盖更晚的焦点抢占）', focusCalls >= 3, true)

console.log('\n--- 已有关键词：改为"聚焦并全选" ---')
focusCalls = 0
selectCalls = 0
log.length = 0
s.setQuery('vue')
await hostEnter()
check('走的是全选（避免新词被拼到旧词后面）', selectCalls > 0, true)
check('不再走纯聚焦', focusCalls, 0)

console.log('\n--- 清空关键词后回到纯聚焦 ---')
focusCalls = 0
selectCalls = 0
s.setQuery('')
await hostEnter()
check('无关键词时聚焦', focusCalls > 0, true)
check('无关键词时不全选', selectCalls, 0)

console.log('\n--- 宿主不给焦点：退回页面内搜索框 ---')
focusShouldFail = true
focusCalls = 0
const tickBefore = s.searchFocusTick.value
await hostEnter()
check('宿主仍被请求聚焦', focusCalls > 0, true)
check('已切到页面内搜索框', s.subInputReady.value, false)
check('页面搜索框收到聚焦请求', s.searchFocusTick.value > tickBefore, true)
focusShouldFail = false

console.log('\n--- 退出插件：取消尚未执行的重试 ---')
focusCalls = 0
s.focusSearch()
outCb?.(true)
await sleep(400)
check('退出后不再抢焦点', focusCalls, 0)

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
