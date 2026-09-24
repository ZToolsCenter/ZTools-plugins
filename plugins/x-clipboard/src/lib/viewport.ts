/*
 * 一屏的坐标换算。
 *
 * 09-23 起 `⌘1`–`⌘9` 和行尾那枚序号都**按屏**算：
 * `⌘N` = 你现在看得见的这一屏里，从上往下第 N 行。
 *
 * 为什么不再按「列表第 N 条」（绝对序号）：那种口径一翻页就作废 —— 屏幕上的行
 * 既没有编号、也没有能粘它的键（第 13 条往后 `⌘1` 永远指向屏外），
 * 键和眼睛看到的东西彻底脱钩。
 *
 * 这里只放**纯换算**，量 DOM 的那一下留在 App.vue 的 `measureFirstRow()` ——
 * 切开之后「屏首怎么找」「第 N 个键粘谁」「这行该显示几」三件事都能单测。
 */

/** 本屏给号的行数。屏幕上第 10 行往后没有键，也就不给号（一屏约 13 行） */
export const TAIL_NUMS = 9

/**
 * 二分找屏首：**第一个**"底边越过视口上沿"的行。
 *
 * 行是连续的（渲染窗口永远是 `rows` 的前缀）、上下不重叠 ⇒ "越过上沿"这件事
 * 从 false 单调变 true，可以二分。**别改成从头遍历**：滚到第 500 条之后，
 * 那就是每个滚动事件读 500 次布局；这里最多读 log2(n) 次。
 *
 * ⚠️ **半露在视口顶部的那一行算「1」**（判定就是"底边越过上沿"）——
 * 跟翻页 `pageMove()` 量屏首用的是同一条，**别改成"要求完整可见"**：
 * 那样两处的起点会差一行，翻完页按 ⌘1 粘到的就不是屏幕上第一行。
 *
 * @param count 已渲染的行数
 * @param coversTop 第 i 行的底边是否越过视口上沿（必须是单调的 false…false true…true）
 * @returns 屏首下标；一行都没有时回 0
 */
export function firstRowAt(count: number, coversTop: (i: number) => boolean): number {
  if (count <= 0) return 0
  let lo = 0
  let hi = count // hi 是"一定成立"的哨兵：所有行都没盖住上沿时它会停在 count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (coversTop(mid)) hi = mid
    else lo = mid + 1
  }
  // 兜底：理论上落在 count 只可能是"整段都滚过头了"，那一行在最后
  return Math.min(lo, count - 1)
}

/**
 * `⌘N` 该粘哪一行（`rows` / `visibleRows` 里的下标）；越界回 `null`。
 *
 * ⚠️ 只有**上边界**（`screenTop + slot` 超出列表）：翻到最后一屏时这一屏装不满，
 * 屏幕下方就是没有"第 8 行"。**不做"夹到最后一个"** —— 夹了会让 ⌘7 / ⌘8 / ⌘9
 * 连着粘同一条，比"没反应"更难解释。
 *
 * @param screenTop 屏首下标（`measureFirstRow()` 量的）
 * @param slot 0 基的槽位（`⌘1` → 0）
 * @param total 列表总条数
 */
export function slotRowIndex(screenTop: number, slot: number, total: number): number | null {
  const i = screenTop + slot
  return i >= 0 && i < total ? i : null
}

/**
 * 本屏该显示哪几个序号：`行下标 → 序号（1–9）`。**就 9 条**，所以滚动时重算它不心疼。
 *
 * ⚠️ 它跟 `slotRowIndex` **必须**是同一套口径 —— 屏上写着 3，`⌘3` 就得粘到那一条。
 * 两处各算一份的话，迟早出现"按 ⌘3 粘到的是别的行"，而且极难复现。
 * 测试里有一条断言就是专门盯着这两个函数别走散（`tests/viewport.test.ts`）。
 */
export function screenNumbers(screenTop: number, total: number): Map<number, number> {
  const nums = new Map<number, number>()
  for (let n = 0; n < TAIL_NUMS; n++) {
    const i = screenTop + n
    if (i < total) nums.set(i, n + 1)
  }
  return nums
}
