/**
 * "复制 A、粘贴出来却是 B" 回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-copy.mts
 *
 * 背景（用户反馈："插件运行久了，我复制的是 A 记录，粘贴出来的是 B"）：
 *   扒宿主源码（前 16 字节取 header 长度解 app.asar）看到两条关键实现：
 *
 *   1. `clipboard:write` 的处理是
 *        const result = await clipboardManager.writeToClipboard(id)
 *        if (shouldPaste) WindowManager.simulatePaste()      ← **不看 result**
 *      也就是说：**写失败照样粘贴**，粘出来的是剪贴板上一条旧内容。
 *
 *   2. `writeToClipboard(id)` 找不到记录时 return false，剪贴板保持原样；
 *      而且它写回时会先 `remove(docId)` **把原纪录删掉**。
 *      ⇒ 同一条记录写回过一次，它的 id 就作废了。第二次仍能选到它
 *        （列表一直在内存里，不会重新拉），写必然失败 → 粘出旧内容。
 *      过期清理 / 图片空间回收删掉旧记录，效果一样。
 *
 *   修法：
 *     ① 复制优先**按内容**写 —— 宿主 `write-content` 只在写成功时才粘贴，
 *        不存在"失败还给你粘一坨旧内容"的坑；拿不到内容才退回按 id 写，
 *        并且记住已经写回过的 id，不再去撞一次必粘的错误粘贴。
 *     ② 两条路都失败要如实 toast 且**不退出**（退出后顺手 Ctrl+V 更糟）。
 *     ③ 选中项按记录身份锚定，列表变动不再让回车复制到别条。
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

console.log('--- 契约：写回的成败必须被接收 ---')
const store = src('composables/useStore.ts')
const api = src('api.ts')

check('宿主 write 返回布尔（读写回的成败，不再当作 void）', /async write\(id: string, paste = true\): Promise<boolean>/.test(api), true)
check(
  '宿主 writeContent 也返回布尔',
  /async writeContent\([\s\S]{0,200}Promise<boolean>/.test(api),
  true
)
check(
  '老写法（忽略 write 的返回值就当成功）已经不存在',
  /await \(window\.ztools as any\)\.clipboard\.write\(id, paste\)\s*\n?\s*\}/.test(api),
  false
)
check(
  '复制优先按内容写（contentPayload 先于按 id 写）',
  store.indexOf('await api.writeContent(payload.type') < store.indexOf('await api.write(r.id)'),
  true
)
check(
  '写失败不再假装成功退出（outPlugin 只在成功之后）',
  /if \(!ok\) \{[\s\S]{0,240}return\s*\n?\s*\}[\s\S]{0,120}if \(exit\) api\.outPlugin\(\)/.test(store),
  true
)
check('记住已经写回过的 id（第二次不再撞墙）', /spentIds\.add\(r\.id\)/.test(store), true)
check(
  '列表变动后按记录身份重新落位（不是给下标加数）',
  /function restoreSelection\(id: string \| null\)/.test(store) &&
    /restoreSelection\(anchorId\)/.test(store),
  true
)
check('老的下标补偿写法已经移除', /selectedIndex\.value \+= fresh\.length/.test(store), false)

/* ------------------------------------------------------------------ */
/* 二、行为                                                              */
/* ------------------------------------------------------------------ */

/** 假宿主：库和真实的一样 —— write(id) 会删掉那条记录 */
const items: Array<Record<string, unknown>> = [
  { id: 'h1', type: 'text', content: '第一条文本', timestamp: 3_000 },
  { id: 'h2', type: 'text', content: '第二条文本', timestamp: 2_000 },
  { id: 'h3', type: 'file', files: [{ path: 'C:/a.txt', name: 'a.txt' }], timestamp: 1_000 }
]

let writeCalls: string[] = []
let writeContentCalls: Array<{ type: string; content: unknown }> = []
let contentSucceeds = true
let outPluginCalls = 0
let toasts: string[] = []
const mem = new Map<string, string>()

const ztoolsStub = {
  setSubInput: () => true,
  subInputFocus: () => true,
  subInputSelect: () => true,
  onPluginEnter: () => true,
  onPluginOut: () => undefined,
  outPlugin: () => {
    outPluginCalls++
  },
  showToast: (m: string) => {
    toasts.push(m)
  },
  clipboard: {
    async getHistory(_page: number, pageSize: number) {
      return { items: items.slice(0, pageSize), total: items.length, page: 1, pageSize }
    },
    async getStatus() {
      return { isRunning: true, itemCount: items.length }
    },
    onChange: () => undefined,
    delete: async () => ({ success: true }),
    clear: async () => ({ count: 0 }),
    /** 忠实模仿宿主：找不到就 false；找到了写完就删掉原纪录 */
    async write(id: string) {
      writeCalls.push(id)
      const i = items.findIndex((it) => it.id === id)
      if (i < 0) return { success: false }
      items.splice(i, 1)
      return { success: true }
    },
    async writeContent(data: { type: string; content: unknown }) {
      writeContentCalls.push(data)
      return { success: contentSucceeds }
    }
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
await new Promise((r) => setTimeout(r, 60))

const reset = (): void => {
  writeCalls = []
  writeContentCalls = []
  toasts = []
  outPluginCalls = 0
  contentSucceeds = true
}

const text = s.records.value.find((r) => r.kind === 'text')!
const file = s.records.value.find((r) => r.kind === 'file')!

console.log('\n--- 正常复制：按内容写，不依赖宿主那条记录还在 ---')
reset()
await s.copyRecord(text)
check('走了内容写', writeContentCalls.length, 1)
check('写的是文本内容', writeContentCalls[0].type, 'text')
check('内容原样', writeContentCalls[0].content, text.content)
check('成功才退出插件', outPluginCalls, 1)
check('没有多余提示', toasts.length, 0)

console.log('\n--- 文件记录：写的是路径列表 ---')
reset()
await s.copyRecord(file)
check('文件也是按内容写', writeContentCalls[0].type, 'file')
check('传的是完整路径列表', JSON.stringify(writeContentCalls[0].content), JSON.stringify(file.files))

console.log('\n--- 关键：宿主里那条记录已经没了（写过一次 / 被清理）照样能复制 ---')
// 模拟宿主侧的"记录没了"：写回会删原纪录，过期清理也会删旧记录
const deadText = items.findIndex((it) => it.id === text.id)
if (deadText >= 0) items.splice(deadText, 1)
reset()
await s.copyRecord(text)
check('内容写仍然成功', writeContentCalls.length, 1)
check('宿主里这条确实已经不在了', items.some((it) => it.id === text.id), false)
check('没有去按 id 撞墙（撞墙就是一次必粘的错误粘贴）', writeCalls.length, 0)
check('正常退出', outPluginCalls, 1)

console.log('\n--- 只有内容不可用时才退回按 id 写 ---')
const placeholder = {
  id: 'img-big',
  kind: 'image' as const,
  rawType: 'image',
  content: '[图片] 过大未保存',
  createdAt: Date.now(),
  raw: {}
}
items.unshift({ id: 'img-big', type: 'image', content: '', timestamp: 9_000 })
reset()
await s.copyRecord(placeholder)
check('占位图片不能按内容写', writeContentCalls.length, 0)
check('退回按 id 写', writeCalls.join(','), 'img-big')
check('写成功退出', outPluginCalls, 1)

console.log('\n--- 同一条再复制一次：不再撞必败的 id（宿主写回会删原纪录）---')
reset()
await s.copyRecord(placeholder)
check('没有第二次调用 id 写', writeCalls.length, 0)
check('也没拿占位文案当内容写', writeContentCalls.length, 0)
check('如实告知写不了', toasts.length, 1)
check('没有静默退出（退出后顺手粘贴会更糟）', outPluginCalls, 0)

console.log('\n--- 内容写失败时退回按 id 写 ---')
const file2 = { ...file, id: 'still-there' }
items.unshift({ id: 'still-there', type: 'file', files: [{ path: 'C:/b.txt' }], timestamp: 9_500 })
contentSucceeds = false
reset()
contentSucceeds = false
await s.copyRecord(file2)
check('内容写失败后退回 id 写', writeCalls.join(','), 'still-there')
check('退回成功就正常退出', outPluginCalls, 1)
contentSucceeds = true

console.log('\n--- 两条路都失败：如实提示且不退出 ---')
const dead = { ...file, id: 'ghost', files: undefined }
reset()
contentSucceeds = false
await s.copyRecord(dead)
check('提示了失败', toasts.length, 1)
check('没有退出插件', outPluginCalls, 0)
contentSucceeds = true

/* ------------------------------------------------------------------ */
/* 三、选中项要跟着"记录"走，不能跟着"下标"走                             */
/* ------------------------------------------------------------------ */

console.log('\n--- 列表变化后，选中的还是原来那条记录 ---')
await s.setCat('all')
s.selectedIndex.value = 2
const anchor = s.filtered.value[2]

items.unshift({ id: 'fresh-1', type: 'text', content: '刚复制的', timestamp: 8_000 })
items.unshift({ id: 'fresh-2', type: 'text', content: '又一条', timestamp: 8_100 })
await s.syncLatest()
check('选中下标跟着下移', s.selectedIndex.value, 4)
check('选中的还是原来那条记录', s.filtered.value[s.selectedIndex.value].id, anchor.id)

console.log('\n--- 新记录不属于当前分类时，下标不该乱挪（老写法会这里出错）---')
await s.setCat('text')
s.selectedIndex.value = 1
const anchor2 = s.filtered.value[1]
items.unshift({ id: 'fresh-file', type: 'file', files: [{ path: 'C:/c.txt' }], timestamp: 8_200 })
await s.syncLatest()
check('分类视图下选中不动', s.selectedIndex.value, 1)
check('选中的还是那条文本', s.filtered.value[s.selectedIndex.value].id, anchor2.id)

s.stopWatching()

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
