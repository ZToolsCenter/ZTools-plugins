/**
 * 链接「在浏览器中打开」回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-link.mts
 *
 * 覆盖三件事：
 *   1. **网址规范化**（utils/format 的 webUrlOf）：只放行 http/https，
 *      `file://`、`data:`、`javascript:` 一律拒绝 —— 剪贴板内容不可信，
 *      把危险协议递给 shell.openExternal 是要出事的。
 *   2. **界面契约**：按钮只在"内容真的是网址"时出现（按内容判定，不按 kind），
 *      点击一路传到 store。
 *   3. **行为**：打开成功后必须退出插件窗口，否则浏览器开在插件后面，
 *      用户以为点了没反应（和"定位文件"同一个坑）。
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

const { webUrlOf } = await import('../src/utils/format.ts')

/* ------------------------------------------------------------------ */
/* 一、网址规范化                                                        */
/* ------------------------------------------------------------------ */

console.log('--- webUrlOf：正常网址 ---')
check('https 原样返回', webUrlOf('https://example.com/a/b?x=1'), 'https://example.com/a/b?x=1')
check('http 原样返回', webUrlOf('http://example.com'), 'http://example.com/')
check('裸域名补协议', webUrlOf('example.com'), 'https://example.com/')
check('www 开头补协议', webUrlOf('www.baidu.com/s?wd=x'), 'https://www.baidu.com/s?wd=x')
check('带端口的本地地址也算网址', webUrlOf('localhost:5173/x'), 'https://localhost:5173/x')
check('首尾空白先 trim', webUrlOf('  https://example.com  '), 'https://example.com/')

console.log('\n--- webUrlOf：必须拒绝的情况 ---')
check('file:// 拒绝（本地协议不该交给浏览器）', webUrlOf('file:///C:/Users/a.txt'), null)
check('javascript: 拒绝（剪贴板内容不可信）', webUrlOf('javascript:alert(1)'), null)
check('data: 拒绝', webUrlOf('data:text/html,<h1>x</h1>'), null)
check('空串拒绝', webUrlOf(''), null)
check('单个单词不是域名', webUrlOf('abc'), null)
check('含空格的散文不是网址', webUrlOf('看看 https://example.com 这个站'), null)
check('多行文本不是网址', webUrlOf('https://a.com\nhttps://b.com'), null)
check('井号开头的颜色值不是网址', webUrlOf('#ffffff'), null)

/* ------------------------------------------------------------------ */
/* 二、源码契约                                                          */
/* ------------------------------------------------------------------ */

console.log('\n--- 契约：按钮只在该出现时出现 ---')
const item = src('components/ClipboardItem.vue')
const vlist = src('components/VirtualList.vue')
const app = src('App.vue')
const api = src('api.ts')
const store = src('composables/useStore.ts')

check(
  '打开按钮按内容判定（v-if="linkUrl"，不是常驻）',
  /v-if="linkUrl"[\s\S]{0,200}title="在浏览器中打开"/.test(item),
  true
)
check('linkUrl 来自 webUrlOf（协议过滤只有一处）', /webUrlOf\(props\.record\.content\)/.test(item), true)
check('按钮有自己的 emit', /open:\s*\[\]/.test(item), true)
check('点击不冒泡到"整行复制"', /@click\.stop="emit\('open'\)"/.test(item), true)

console.log('\n--- 契约：事件一路传到 store ---')
check('VirtualList 声明 open 事件', /open:\s*\[record:\s*ClipboardRecord\]/.test(vlist), true)
check('VirtualList 转发 open', /@open="emit\('open', row\.rec\)"/.test(vlist), true)
check('App 接到 open 后调 store.openLink', /@open="\(r\) => store\.openLink\(r\)"/.test(app), true)

console.log('\n--- 契约：宿主 API 与退出窗口 ---')
check('走宿主官方 shellOpenExternal', /zt\.shellOpenExternal\(url\)/.test(api), true)
check(
  '宿主 API 缺失时退回 window.open（开发/老宿主不至于点了没反应）',
  /window\.open\(url, '_blank', 'noopener,noreferrer'\)/.test(api),
  true
)
check('store 打开成功后退出插件窗口', /api\.outPlugin\(\)/.test(store), true)
check(
  'store 先过 webUrlOf 再打开（不是网址就不调用）',
  /const url = webUrlOf\(r\.content\)[\s\S]{0,200}api\.openExternal\(url\)/.test(store),
  true
)

/* ------------------------------------------------------------------ */
/* 三、行为：真的会打开、且会退出                                         */
/* ------------------------------------------------------------------ */

const opened: string[] = []
const toasts: string[] = []
let outCount = 0

const mem = new Map<string, string>()
const ztoolsStub = {
  setSubInput: () => true,
  subInputFocus: () => true,
  subInputSelect: () => true,
  onPluginEnter: () => undefined,
  onPluginOut: () => undefined,
  shellOpenExternal: (u: string) => void opened.push(u),
  outPlugin: () => void outCount++,
  showToast: (m: string) => void toasts.push(m),
  clipboard: {
    async getHistory(_page: number, pageSize: number) {
      const items = [
        { id: 'h1', type: 'text', content: 'https://example.com/a', timestamp: Date.now() },
        { id: 'h2', type: 'text', content: 'www.baidu.com', timestamp: Date.now() - 1 },
        { id: 'h3', type: 'text', content: '这是一段普通文本', timestamp: Date.now() - 2 },
        { id: 'h4', type: 'text', content: 'file:///C:/Users/a.txt', timestamp: Date.now() - 3 }
      ].slice(0, Math.min(pageSize, 4))
      return { items, total: 4, page: _page, pageSize }
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

;(globalThis as any).window = { ztools: ztoolsStub }

const { useStore } = await import('../src/composables/useStore.ts')
const s = useStore()
s.init()
await new Promise((r) => setTimeout(r, 30))

const recs = s.records.value
console.log('\n--- 数据就绪 ---')
check('取到 4 条历史', recs.length, 4)
check('第 1 条被识别为链接', recs[0].kind, 'link')
check('第 2 条（www 开头）也被识别为链接', recs[1].kind, 'link')

console.log('\n--- 点开一条链接 ---')
await s.openLink(recs[0])
check('调用了 shellOpenExternal', opened.length, 1)
check('传出去的是原网址', opened[0], 'https://example.com/a')
check('打开后退出插件窗口（否则浏览器开在后面）', outCount, 1)

console.log('\n--- 裸 www 自动补协议 ---')
await s.openLink(recs[1])
check('第二条也打开了', opened.length, 2)
check('补上了 https://', opened[1], 'https://www.baidu.com/')

console.log('\n--- 不是网址：不开、只提示 ---')
await s.openLink(recs[2])
check('普通文本没有调 shell', opened.length, 2)
check('给了提示', toasts.length, 1)
check('没有误退出插件', outCount, 2)

console.log('\n--- 危险协议：拒绝 ---')
await s.openLink(recs[3])
check('file:// 没有交给浏览器', opened.length, 2)
check('也给了提示', toasts.length, 2)
check('仍未退出插件', outCount, 2)

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
