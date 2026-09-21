/*
 * 写库：必须带 `_rev`。
 *
 * 为什么单开一份测试盯着这件事：宿主底层的 `put` 有 rev 校验，**文档已存在而传来的
 * `doc._rev` 对不上就返回 `{ ok: false, name: 'conflict' }`**（而且是 resolve，不是 reject）。
 * 于是「直接 put 一个不带 `_rev` 的文档去覆盖」这种写法**只有第一次能成功**，
 * 之后每次都被静默拒掉 —— 09-15 老大报的「改了强调色和选中项、插件关掉再开就没了」
 * 就是踩在这个坑上（库里那条 `x_clipboard.settings` 的 `_rev` 永远停在 1）。
 *
 * 这里的假宿主**照宿主真实行为实现**：已存在 + `_rev` 对不上 → conflict。
 * 所以只要有人再把 `upsertDoc` 换成裸 `put`，下面的用例立刻红。
 *
 * 顺带说明：本文件 import 的模块都带 `.ts` 后缀（Node ESM 严格解析），
 * 所以 `favorites.ts` 也被迫改成带后缀的写法。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { upsertDoc } from '../src/lib/clipboard.ts'
import { loadSettings, saveSettings, type Settings } from '../src/lib/settings.ts'
import { addFavorite, loadFavorites } from '../src/lib/favorites.ts'

/* ---------------------------------------------------------------- 假宿主 */

const rows = new Map<string, Record<string, unknown>>()
let seq = 0
/** 成功写进去的次数（每个 test 前清空） */
let okCount = 0
/** 被 rev 校验拒掉的次数 */
let conflictCount = 0

const fakeDb = {
  promises: {
    async get(id: string) {
      const row = rows.get(id)
      return row ? { ...row } : null
    },
    async put(doc: Record<string, unknown>) {
      const id = String(doc._id)
      const existingRev = rows.get(id)?._rev as string | undefined
      // ↓ 这里复刻的是宿主 db.put 的校验规则：已有 rev 且对不上就直接拒绝
      //   （不是抛异常，是 resolve 一个 ok:false —— 所以写失败是静默的，见 lib/clipboard.ts）
      if (existingRev && doc._rev !== existingRev) {
        conflictCount++
        return { ok: false, name: 'conflict', message: 'Document update conflict', id }
      }
      const rev = `1-${++seq}`
      rows.set(id, { ...doc, _rev: rev })
      okCount++
      return { ok: true, id, rev }
    },
    async remove(id: string) {
      rows.delete(id)
      return { ok: true, id }
    }
  }
}

function resetHost(): void {
  rows.clear()
  seq = 0
  okCount = 0
  conflictCount = 0
  ;(globalThis as unknown as { window: unknown }).window = { ztools: { db: fakeDb } }
}

/* ---------------------------------------------------------------- 用例 */

test('假宿主照宿主规矩办事：不带 _rev 覆盖已有文档 → conflict', async () => {
  resetHost()
  await upsertDoc('probe', () => ({ data: 1 }))
  assert.equal(okCount, 1)
  assert.equal(conflictCount, 0)

  // 绕开 upsertDoc，直接照老写法来一次 —— 必须被拒，这条就是「为什么不能偷懒」的碑
  const res = await fakeDb.promises.put({ _id: 'probe', data: 2 })
  assert.equal(res.ok, false)
  assert.equal(res.name, 'conflict')
  assert.equal(conflictCount, 1)
  assert.equal(rows.get('probe')?.data, 1, '被拒之后库里的值不能变')
})

test('upsertDoc 连写两次：第二次也得真的写进去', async () => {
  resetHost()
  assert.equal((await upsertDoc('doc', () => ({ n: 1 }))).ok, true)
  assert.equal((await upsertDoc('doc', () => ({ n: 2 }))).ok, true)
  assert.equal(conflictCount, 0, '不该出现任何 conflict')
  assert.equal(rows.get('doc')?.n, 2)
})

test('设置存两次：第二次要成功，且读回来是后一次的值（★ 老大报的那个 bug）', async () => {
  resetHost()

  const first: Settings = {
    peek: false,
    accent: 'teal',
    mark: 'border',
    bg: 'white',
    foot: 'full',
    confirmDelete: true,
    tailType: true,
    tailIndex: false,
    tailSource: false,
    tailActs: true
  }
  const second: Settings = {
    peek: true,
    accent: 'purple',
    mark: 'solid',
    bg: 'warm',
    foot: 'none',
    confirmDelete: false,
    tailType: false,
    // 两次给**不一样**的值，才验得出"读回来的是后一次那份"
    tailIndex: true,
    tailSource: true,
    tailActs: false
  }

  assert.equal(await saveSettings(first), true)
  assert.equal(await saveSettings(second), true)

  assert.equal(conflictCount, 0)
  const back = await loadSettings()
  // 每个字段都要真的绕一圈回来 —— 少断言一个，将来加字段时这条测试就悄悄失去意义了
  assert.deepEqual(back, second)
})

test('连点两次（不 await 第一次）也不能互相撞掉 —— 同一个 id 的写入是串行的', async () => {
  resetHost()

  const first = saveSettings({ peek: false, accent: 'teal', mark: 'border', bg: 'auto', foot: 'full' })
  const second = saveSettings({
    peek: false,
    accent: 'amber',
    mark: 'tint',
    bg: 'auto',
    foot: 'fade'
  })
  const [a, b] = await Promise.all([first, second])

  assert.equal(a, true)
  assert.equal(b, true)
  assert.equal(conflictCount, 0)
  assert.equal((await loadSettings()).accent, 'amber')
})

test('收藏连加两条都存得下（同一个坑的另一个受害者）', async () => {
  resetHost()

  const one = await addFavorite({ type: 'text', content: '第一条', hash: 'h1' }, [])
  const two = await addFavorite({ type: 'text', content: '第二条', hash: 'h2' }, one)

  assert.equal(two.length, 2)
  assert.equal(conflictCount, 0)
  const back = await loadFavorites()
  assert.equal(back.length, 2, '两条都得在库里')
  // 新的在前面
  assert.equal(back[0].content, '第二条')
})

test('第二次写是「更新」而不是「新建」—— rev 要换一版', async () => {
  resetHost()
  await upsertDoc('doc', () => ({ n: 1 }))
  const storedRev = rows.get('doc')?._rev
  assert.ok(typeof storedRev === 'string' && storedRev.startsWith('1-'))

  await upsertDoc('doc', () => ({ n: 2 }))
  assert.notEqual(rows.get('doc')?._rev, storedRev)
  assert.equal(rows.get('doc')?.n, 2)
  assert.equal(rows.size, 1, '不能变成两条记录')
})
