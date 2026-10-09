/**
 * 搜索链路回归测试
 *
 * 运行：node --experimental-strip-types design/check-search.mts
 *
 * 背景：宿主 setSubInput 内部是
 *   if (onChange && typeof onChange === 'function') subInputChangeCallback = onChange
 * 之前误传了 { text: fn } 对象 → 回调从未注册 → 用户在搜索框打字毫无反应。
 * 这类"参数形态不对、宿主静默忽略"的问题截图看不出来，只能靠契约测试锁死。
 */

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望=${String(expected)} 实际=${String(actual)}`}`)
}

/* ---------- 伪造宿主 ---------- */

const calls: Array<{ onChange: unknown; placeholder: string; isFocus: boolean }> = []
let captured: ((details: unknown) => void) | null = null

const ztoolsStub = {
  setSubInput(onChange: unknown, placeholder: string, isFocus = true) {
    calls.push({ onChange, placeholder, isFocus } as any)
    captured = onChange as (details: unknown) => void
    return Promise.resolve()
  },
  clipboard: {
    async getHistory(_page: number, _pageSize: number, _filter?: string) {
      return {
        items: [
          { id: 'r1', type: 'text', content: 'hello vue', timestamp: Date.now() },
          { id: 'r2', type: 'text', content: 'hello react', timestamp: Date.now() }
        ],
        total: 2,
        page: 1,
        pageSize: 50
      }
    },
    async search(keyword: string) {
      // 官方 clipboardManager.search 返回的是裸数组（getHistory(...).items），不是 {items}
      return [{ id: 's1', type: 'text', content: 'remote hit: ' + keyword, timestamp: Date.now() }]
    }
  }
}

;(globalThis as any).window = { ztools: ztoolsStub }

/* ---------- 用例 ---------- */

const { api, isDevMock } = await import('../src/api.ts')

console.log('--- 宿主判定 ---')
check('注入 window.ztools 后应走宿主实现', isDevMock(), false)

console.log('\n--- setSubInput 注册契约（本次修复的核心）---')
let received = ''
const ok = api.setSubInput((t) => { received = t }, '搜索剪贴板历史')
check('注册成功返回 true', ok, true)
check('第一个参数必须是函数', typeof calls[0]?.onChange, 'function')
check('placeholder 正确透传', calls[0]?.placeholder, '搜索剪贴板历史')
check('isFocus 默认 true', calls[0]?.isFocus, true)

captured?.({ text: 'abc' })
check('回调收到 {text} 对象时能取到文本', received, 'abc')
captured?.('xyz')
check('回调收到裸字符串时也能取到文本', received, 'xyz')

console.log('\n--- 搜索/历史归一化 ---')
const remote = await api.search('vue')
check('search 返回裸数组也能归一化', remote.length, 1)
check('搜索结果内容正确', remote[0].content.includes('vue'), true)

const page1 = await api.getHistory(1, 50)
check('getHistory 归一化 items', page1.items.length, 2)
check('getHistory 带出 total', page1.total, 2)
check('total 与 items 一致时 hasMore 为 false', page1.hasMore, false)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exitCode = 1
