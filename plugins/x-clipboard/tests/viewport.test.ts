/*
 * 一屏的坐标换算。
 *
 * 盯两件事：① 屏首怎么找（尤其"半露在顶部那一行"）；② 序号和 ⌘N 别走散。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TAIL_NUMS, firstRowAt, screenNumbers, slotRowIndex } from '../src/lib/viewport.ts'

/*
 * 行高混着 36 / 42 两档（`--row-h` / `--row-h-tall`），跟真机一样。
 * 所以只能拿 `offsetTop` 比 —— 除法算不出屏首，这也是 `firstRowAt` 用二分的原因。
 */
const ROWS = [20, 36, 42, 36, 36, 42, 36, 36, 36, 42, 36, 36, 36, 36, 42]
/** 每行的**底边**（累积高度）：判定就是"底边 > 视口上沿" */
const BOTTOMS = ROWS.map((_, i) => ROWS.slice(0, i + 1).reduce((a, b) => a + b, 0))

/** 视口上沿在内容坐标 y 处时，第 i 行盖住它了吗 */
const covers = (y: number) => (i: number) => BOTTOMS[i] > y

test('屏首：没滚时就是第一行', () => {
  assert.equal(firstRowAt(BOTTOMS.length, covers(0)), 0)
})

test('屏首：滚过半行 → 算被切掉的那一行（半露的行就是「1」）', () => {
  // 上沿 90px：第 2 行（下标 2）跨 56–98，被切掉一截 ⇒ 它是屏首
  assert.equal(firstRowAt(BOTTOMS.length, covers(90)), 2)
})

test('屏首：正好卡在某行顶边 → 算这一行，不是上一行', () => {
  // 上沿 98px = 下标 3 那行的顶边
  assert.equal(firstRowAt(BOTTOMS.length, covers(98)), 3)
})

test('屏首：滚到底、只剩最后一行 → 就是它', () => {
  assert.equal(firstRowAt(BOTTOMS.length, covers(520)), BOTTOMS.length - 1)
})

test('屏首：一行都没有 → 0（不是 -1）', () => {
  assert.equal(
    firstRowAt(0, () => true),
    0
  )
})

test('⌘N 粘的是屏首往下第 N 行', () => {
  assert.equal(slotRowIndex(12, 0, 100), 12)
  assert.equal(slotRowIndex(12, 8, 100), 20)
})

test('⌘N 越界就什么都不做 —— 不夹到最后一个', () => {
  // 列表只剩 96 条，屏首 95：⌘2 起就该没反应
  assert.equal(slotRowIndex(95, 1, 96), null)
  // 夹的话 ⌘2…⌘9 会连着粘同一条，比"没反应"更难解释
  assert.equal(slotRowIndex(95, 0, 96), 95)
})

test('★ 序号和 ⌘N 是同一套口径（两处别走散）', () => {
  for (const screenTop of [0, 1, 7, 12, 95, 200]) {
    const nums = screenNumbers(screenTop, 1000)
    const bySlot = new Set<number>()
    for (let slot = 0; slot < TAIL_NUMS; slot++) {
      const i = slotRowIndex(screenTop, slot, 1000)
      if (i !== null) bySlot.add(i)
    }
    assert.deepEqual(new Set(nums.keys()), bySlot, `screenTop=${screenTop}：有号的行与 ⌘N 能到的行不一致`)
    // 顺序也要对得上：写着 n 的那行，正好是 ⌘n 粘的那行
    for (const [i, n] of nums) assert.equal(slotRowIndex(screenTop, n - 1, 1000), i)
  }
})

test('列表末尾不满一屏 → 后面几个号不显示', () => {
  const nums = screenNumbers(94, 96)
  assert.deepEqual([...nums.keys()], [94, 95])
  assert.deepEqual([...nums.values()], [1, 2])
})

test('列表为空 → 一个号都没有', () => {
  assert.equal(screenNumbers(0, 0).size, 0)
})
