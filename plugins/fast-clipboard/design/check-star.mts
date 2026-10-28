/**
 * 收藏星标点亮 回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-star.mts
 *
 * 背景（用户反馈："收藏时点击五角星，五角星图标没有点亮"）：
 *   收藏是以**内容 key**（`favKey` = djb2(kind+content)）存的，
 *   而列表里每条记录的 `id` 是宿主给的**历史 id**，两者是两套完全不同的值。
 *   旧代码在 App 里造的是"收藏 key 的集合"，到 VirtualList 却拿 `row.rec.id`
 *   去查 —— 永远查不中，于是除了"收藏"分类（那里记录的 id 恰好被赋成了
 *   收藏 key，碰巧对）之外，星点了都不亮。
 *
 *   修法：把"集合"换成"判定函数"，由 App 直接用 `favKey(r)` 查表。
 *   本测试既锁行为（点谁谁亮、同内容都亮），也锁源码契约（不许再用 id 查）。
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
/* 一、源码契约：星标判定必须走内容 key，不能走记录 id                    */
/* ------------------------------------------------------------------ */

const vlist = src('components/VirtualList.vue')
const app = src('App.vue')

console.log('--- 契约：判定方式 ---')
check(
  'VirtualList 收的是判定函数 isStarred（不是 id 集合）',
  /isStarred:\s*\(r:\s*ClipboardRecord\)\s*=>\s*boolean/.test(vlist),
  true
)
check(
  '旧的错误写法（拿记录 id 查收藏集合）已不存在',
  /starredIds\.has\(/.test(vlist),
  false
)
check(
  '四种卡片都用 isStarred(row.rec) 判定',
  (vlist.match(/:starred="isStarred\(row\.rec\)"/g) ?? []).length,
  4
)
check('App 把 isStarred 传给列表', /:is-starred="isStarred"/.test(app), true)
check(
  'App 的判定用 favKey(r) 查表',
  /favKeys\.value\.has\(store\.favKey\(r\)\)/.test(app),
  true
)
check(
  'App 不再用记录 id 判定收藏（这是 bug 本体）',
  /favKeys\.value\.has\(r\.id\)|starredIds\.has\(r\.id\)/.test(app),
  false
)

console.log('\n--- 契约：点亮样式 ---')
const item = src('components/ClipboardItem.vue')
check('星按钮带 starred 类', /:class="\{\s*starred\s*\}"/.test(item), true)
check(
  '点亮时是实心（fill=currentColor），未点亮时才描边',
  /:fill="starred \? 'currentColor' : 'none'"/.test(item),
  true
)
check('点亮用 --star 高亮色', /\.op\.starred\s*\{\s*color:\s*var\(--star\)/.test(item), true)

/* ------------------------------------------------------------------ */
/* 二、行为：真的点得亮                                                  */
/* ------------------------------------------------------------------ */

const mem = new Map<string, string>()

const ztoolsStub = {
  setSubInput: () => true,
  subInputFocus: () => true,
  subInputSelect: () => true,
  onPluginEnter: () => undefined,
  onPluginOut: () => undefined,
  clipboard: {
    async getHistory(_page: number, pageSize: number) {
      const items = [
        { id: 'host-1', type: 'text', content: 'hello world', timestamp: Date.now() },
        { id: 'host-2', type: 'text', content: 'hello world', timestamp: Date.now() - 1 },
        { id: 'host-3', type: 'text', content: 'another one', timestamp: Date.now() - 2 }
      ].slice(0, Math.min(pageSize, 3))
      return { items, total: 3, page: _page, pageSize }
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
check('取到 3 条历史', recs.length, 3)

/** 复刻 App 里的判定：收藏 key 集合 + favKey 查表 */
const favKeys = (): Set<string> => new Set(s.favorites.value.map((f) => f.id))
const isStarred = (r: (typeof recs)[number]): boolean => favKeys().has(s.favKey(r))
/** 旧的错误判定（拿宿主 id 查收藏 key 集合）—— 用来证明 bug 确实存在过 */
const oldIsStarred = (r: (typeof recs)[number]): boolean => favKeys().has(r.id)

console.log('\n--- 收藏第一条 ---')
s.toggleStar(recs[0])
check('收藏数 +1', s.favorites.value.length, 1)
check('侧栏收藏计数同步', s.counts.star, 1)
check('存下来的是内容 key', s.favorites.value[0].id, s.favKey(recs[0]))
check(
  '记录 id 与收藏 key 不是同一个值（这正是旧写法查不中的原因）',
  recs[0].id === s.favKey(recs[0]),
  false
)
check('新判定：第一条点亮', isStarred(recs[0]), true)
check('旧判定：第一条点不亮（bug 复现）', oldIsStarred(recs[0]), false)
check(
  '同内容的另一条记录也点亮（收藏是按内容，不是按历史条目）',
  isStarred(recs[1]),
  true
)
check('不同内容的记录不亮', isStarred(recs[2]), false)

console.log('\n--- 再点一次：取消收藏 ---')
s.toggleStar(recs[0])
check('收藏被移除', s.favorites.value.length, 0)
check('第一条熄灭', isStarred(recs[0]), false)
check('计数归零', s.counts.star, 0)

console.log('\n--- 收藏分类下也能点（id 恰好等于 key 的那一路）---')
s.toggleStar(recs[2])
s.setCat('star')
await new Promise((r) => setTimeout(r, 30))
const starRecs = s.filtered.value
check('收藏分类列出 1 条', starRecs.length, 1)
check('它的 id 就是收藏 key', starRecs[0].id, s.favKey(recs[2]))
check('判定为已收藏', isStarred(starRecs[0]), true)

console.log('\n--- 持久化：重开后仍然亮 ---')
check('收藏已写入 dbStorage', mem.size > 0, true)

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
