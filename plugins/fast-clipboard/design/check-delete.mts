/**
 * 删除行为 回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-delete.mts
 *
 * 背景（用户反馈："删除失败是什么情况？删除失败直接删除就好了呀"）：
 *   旧实现是"宿主说了算" —— `api.remove()` 返回 false 就弹一个"删除失败"，
 *   然后**界面什么都不动**。最容易踩到的是"收藏"分类：那里的记录是本插件
 *   自己的快照，id 是内容 key，宿主历史库里根本没有这条 id，delete 必然失败，
 *   于是收藏里的删除按钮形同虚设。
 *
 *   改成"以界面为准"（乐观删除）：点了删除就从列表消失，宿主那边失败只在
 *   控制台留痕、不打扰用户、不回滚。
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
/* 一、源码契约：不再拿宿主的返回值卡界面                                */
/* ------------------------------------------------------------------ */

console.log('--- 契约：以界面为准 ---')
const store = src('composables/useStore.ts')

check(
  '不再弹"删除失败"这个提示（宿主失败不该打断用户）',
  /api\.toast\(\s*'删除失败'/.test(store),
  false
)
check(
  '不再拿 api.remove 的返回值拦住后续逻辑',
  /const ok = await api\.remove/.test(store),
  false
)
check(
  '删除宿主记录时不 await 结果（fire and forget + catch）',
  /void api\.remove\(r\.id\)\.catch/.test(store),
  true
)
check(
  '收藏分类走本地移除（收藏快照宿主里没有，删了也是失败）',
  /favorites\.value = favorites\.value\.filter\(\(f\) => f\.id !== r\.id\)/.test(store),
  true
)
check(
  '远端搜索结果里的同一条也一起删（只删一边它会"复活"）',
  /remoteResults\.value = remoteResults\.value\.filter\(\(x\) => x\.id !== r\.id\)/.test(store),
  true
)
check(
  '清空同样以界面为准（宿主返回 0 也要清空）',
  // 条数取 records 与 totalCount 的较大者：列表可能只加载了一部分
  /const n = Math\.max\(records\.value\.length, totalCount\.value\)[\s\S]{0,240}void api\.clear\(\)\.catch/.test(store),
  true
)
check('清空提示用界面上的真实条数', /已清空 \$\{n\} 条记录/.test(store), true)

/* ------------------------------------------------------------------ */
/* 二、行为：宿主删除失败，界面照样删掉                                  */
/* ------------------------------------------------------------------ */

const deletedIds: string[] = []
const toasts: string[] = []
const mem = new Map<string, string>()

/** 宿主删除**永远失败**（返回 {success:false}）—— 复现"删除失败"的那个场景 */
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
      const items = [
        { id: 'h1', type: 'text', content: '第一条', timestamp: Date.now() },
        { id: 'h2', type: 'text', content: '第二条', timestamp: Date.now() - 1 },
        { id: 'h3', type: 'text', content: 'https://example.com', timestamp: Date.now() - 2 }
      ].slice(0, Math.min(pageSize, 3))
      return { items, total: 3, page: _page, pageSize }
    },
    async delete(id: string) {
      deletedIds.push(id)
      return { success: false }
    },
    async clear() {
      return { count: 0 }
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

console.log('\n--- 宿主删除失败时，界面照样删掉 ---')
await s.deleteRecord(recs[1])
await new Promise((r) => setTimeout(r, 10))
check('确实通知了宿主', deletedIds.length, 1)
check('通知的是这条记录的 id', deletedIds[0], 'h2')
check('界面上少了一条', s.records.value.length, 2)
check('删掉的是那一条', s.records.value.some((r) => r.id === 'h2'), false)
check('没有弹"删除失败"', toasts.length, 0)
check('侧栏"全部"计数同步减一', s.counts.all, 2)

console.log('\n--- 收藏分类下的删除（旧实现必失败的那一路）---')
s.toggleStar(s.records.value[0])
s.setCat('star')
await new Promise((r) => setTimeout(r, 30))
check('收藏里有 1 条', s.filtered.value.length, 1)
const favRec = s.filtered.value[0]
check('它的 id 是内容 key（宿主库里没有这个 id）', favRec.id, s.favKey(s.records.value[0]))
const favKeyId = favRec.id
await s.deleteRecord(favRec)
await new Promise((r) => setTimeout(r, 10))
check('收藏列表已清空', s.favorites.value.length, 0)
check('收藏计数归零', s.counts.star, 0)
check('没有去宿主删这个 key（删了也是失败）', deletedIds.includes(favKeyId), false)
check('宿主历史没被误删', s.records.value.length, 2)
check('仍然没有失败提示', toasts.length, 0)

console.log('\n--- 清空：宿主返回 0 也要清空 ---')
s.setCat('all')
await new Promise((r) => setTimeout(r, 30))
await s.clearAll()
await new Promise((r) => setTimeout(r, 10))
check('列表已清空', s.records.value.length, 0)
check('给了清空提示', toasts.length, 1)
check('提示用的是界面条数', toasts[0], '已清空 2 条记录')

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
