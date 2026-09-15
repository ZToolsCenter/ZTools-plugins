/**
 * ============================================================================
 * 统计与导航（roadmap 任务 ENG-009）
 * ============================================================================
 *
 * ENG-009 的三个只读查询出口，供 UI-010 的 `+N −M` 统计徽标与「上一个 /
 * 下一个差异」跳转消费：
 *
 * - `computeStats(rows, hunkCount)`：把完整展开的 `DiffRow[]` 汇总为
 *   `DiffStats`（compareFull 在内部调用，hunkCount 由调用方传 buildHunks
 *   结果长度）；
 * - `nextHunkIndex(hunks, current, direction)`：hunk 有序列表上的循环跳转
 *   （current 为当前 hunk 下标，-1 表示未定位；回绕到首/尾）；
 * - `hunkAnchorRows(hunk, rows)`：hunk 在全量 rows 中的 0-based 起止下标
 *   （供滚动定位与当前 hunk 高亮）；
 * - `sideChangedChars(rows, side)`：单侧被删除（'left'）或新增（'right'）的
 *   行文本字符数总量（UI-017「全部复制」悬浮统计的字符变化量口径，与
 *   `computeStats` 的 removedLines / addedLines 同族）。
 *
 * 放独立文件而非追加到 `./hunks.ts` 的理由：ENG-008（hunks.ts）的职责是
 * 「把 rows 投影为 hunks / collapses」的生成层，本模块是对 rows / hunks 的
 * 只读查询层，二者可独立测试与演进；且本模块只 import `./types.ts`
 * （导航辅助只消费 Hunk / DiffRow 数据形状，不需要 buildHunks），依赖方向
 * 为 `diff.ts → stats.ts → types.ts`，无循环依赖风险。
 *
 * 统计口径（对齐 `./types.ts` 的 `DiffStats` 契约）：
 * - `addedLines` = `type === 'add'` 行数；`removedLines` = `'del'` 行数；
 * - `modifiedPairs` = `'modify'` 行数：一个修改对计 1，且其 left / right
 *   两侧【不计入】added / removed（避免重复计数）；
 * - `hunkCount` 由调用方传入（compareFull 传 `hunks.length`，恒等于
 *   `hunks.length`）；`totalRows` 恒等于 `rows.length`。
 *
 * 硬性约束（对齐其他引擎模块）：零 UI 依赖、零 DOM、零 store 依赖；不可变
 * 风格：所有函数只读入参，返回新对象，从不修改入参的任何数组或行对象。
 * ============================================================================
 */

import type { DiffRow, DiffRowSide, DiffStats, Hunk } from './types'

/* -------------------------------------------------------------------------- */
/* computeStats：DiffStats 汇总                                                */
/* -------------------------------------------------------------------------- */

/**
 * 把完整展开的差异行序列汇总为统计对象（ENG-009 主出口之一）。
 *
 * 实现方式：单趟线性扫描按 `type` 计数 —— `'add'` 计入 addedLines、
 * `'del'` 计入 removedLines、`'modify'` 计入 modifiedPairs（一个修改对计 1，
 * 其左右两侧不计入 added / removed，避免重复计数，见 `DiffStats` 契约）、
 * `'equal'` 不计入任何变更计数；`totalRows` 恒等于 `rows.length`（含
 * equal 行）。`hunkCount` 不从 rows 推导（rows 中无 hunk 信息），由调用方
 * 传入：`compareFull` 传 `buildHunks(rows).hunks.length`，其余调用方可传 0。
 *
 * 关于 modifiedPairs 的当前取值：行级骨架的产出方（`diffLinesCore` /
 * `compareWithOptions`）均不产 `'modify'` 行，因此经 `compareFull` 统计时
 * 该值恒为 0 —— 函数语义已按契约实现，UI-006 接线 `rowsWithPairing`
 * （ENG-005）产 modify 行后该值即为非零。
 *
 * @param rows 完整展开的差异行序列（含 `'equal'` 行；只读，不修改）
 * @param hunkCount hunk 数量（调用方传入；缺省 0）
 * @returns 五字段齐备的 `DiffStats`
 */
export function computeStats(rows: DiffRow[], hunkCount = 0): DiffStats {
  let addedLines = 0
  let removedLines = 0
  let modifiedPairs = 0
  for (const row of rows) {
    if (row.type === 'add') addedLines += 1
    else if (row.type === 'del') removedLines += 1
    else if (row.type === 'modify') modifiedPairs += 1
  }

  return {
    addedLines,
    removedLines,
    modifiedPairs,
    hunkCount,
    totalRows: rows.length,
  }
}

/* -------------------------------------------------------------------------- */
/* sideChangedChars：单侧变更字符数（UI-017）                                 */
/* -------------------------------------------------------------------------- */

/**
 * 单侧「变更字符数」（UI-017：「全部复制」悬浮统计的字符变化量口径）。
 *
 * 口径与 `computeStats` 的 `addedLines` / `removedLines` 完全同族：
 * 左侧（'left'）只统计 `'del'` 行的 `left.text` 长度，右侧（'right'）只统计
 * `'add'` 行的 `right.text` 长度 —— `'modify'` 行的两侧不计入（与行级
 * 统计一致，避免重复计数，见 `DiffStats` 契约注释）；`'equal'` 行不计入。
 *
 * 该口径是「本次对比中该侧被删除 / 新增的字符总量」，与行数维度
 * （removedLines / addedLines）一一对应，供 UI 的悬浮统计按「行 /
 * 字符」两节展示同源数据。
 *
 * @param rows 完整展开的差异行序列（引擎骨架或配对序列均可：pairing 只
 *              增 modify 行、把 del+add 换皮，不改变 del / add 行的数量与文本）
 * @param side 目标侧：'left' 统计删除字符（`'del'` 行）、'right' 统计新增
 *              字符（`'add'` 行）
 * @returns 该侧被删除 / 新增的行文本字符数之和（无对应行时为 0）
 */
export function sideChangedChars(rows: DiffRow[], side: 'left' | 'right'): number {
  let total = 0
  for (const row of rows) {
    if (row.type === (side === 'left' ? 'del' : 'add')) {
      const sideData = side === 'left' ? row.left : row.right
      if (sideData !== undefined) total += sideData.text.length
    }
  }
  return total
}

/* -------------------------------------------------------------------------- */
/* nextHunkIndex：hunk 有序列表上的循环跳转                                     */
/* -------------------------------------------------------------------------- */

/**
 * 在 hunk 有序列表上计算「上一个 / 下一个」跳转的目标下标（ENG-009 出口，
 * 供 UI-010 导航按钮消费）。
 *
 * 行为约定：
 * - `hunks` 为空（无任何差异）→ 返回 -1（无目标可跳）；
 * - `current` 为当前定位的 hunk 下标（0-based），`-1` 表示尚未定位到任何
 *   hunk；`current` 越界（< 0、≥ hunks.length 或非整数）一律按未定位（-1）
 *   处理：`direction === 1` → 0（第一个），`direction === -1` →
 *   `hunks.length - 1`（最后一个）；
 * - `current` 合法时循环回绕：末尾向后跳回首 hunk、开头向前跳回末 hunk
 *   （`(current + direction + n) % n`），因此任意起点连续调用可在环形序列
 *   上遍历全部 hunk。
 *
 * @param hunks hunk 有序列表（`buildHunks` 产物，按出现顺序排列；只读）
 * @param current 当前 hunk 下标（-1 或越界均表示未定位）
 * @param direction 跳转方向：1 = 下一个，-1 = 上一个
 * @returns 目标 hunk 下标（0-based）；hunks 为空时为 -1
 */
export function nextHunkIndex(hunks: Hunk[], current: number, direction: 1 | -1): number {
  const n = hunks.length
  if (n === 0) return -1
  // 未定位 / 越界 / 非整数下标一律按 -1 语义处理：正向去第一个、反向去最后一个。
  if (!Number.isInteger(current) || current < 0 || current >= n) {
    return direction === -1 ? n - 1 : 0
  }
  // 循环回绕：+n 保证负向越过 0 时仍为非负，再对 n 取模落回 [0, n)。
  return (current + direction + n) % n
}

/* -------------------------------------------------------------------------- */
/* hunkAnchorRows：hunk 在全量 rows 中的起止下标（尽力定位）                     */
/* -------------------------------------------------------------------------- */

/**
 * 「内容 + 行号」精确匹配：type 与双侧的 lineNo、text 逐项相同。
 * 任一侧一边缺省一边存在即不等（双侧都缺省不违反 DiffRow 契约，保守判等）。
 */
function rowsMatchExact(a: DiffRow, b: DiffRow): boolean {
  const sideEq = (x: DiffRowSide | undefined, y: DiffRowSide | undefined) =>
    x === undefined || y === undefined ? x === y : x.lineNo === y.lineNo && x.text === y.text
  return a.type === b.type && sideEq(a.left, b.left) && sideEq(a.right, b.right)
}

/**
 * 「仅文本」宽松匹配（尽力回退用）：忽略 type 与行号，某侧仅在【两侧都存在】
 * 时比较 text，任一侧缺省视为该侧不参与比较。用于 hunk 与 rows 行号体系
 * 不一致（上下文裁剪 / 行被重排 / del+add 被重投影为 modify 等）的场景。
 */
function rowsMatchLoose(a: DiffRow, b: DiffRow): boolean {
  const sideTextEq = (x: DiffRowSide | undefined, y: DiffRowSide | undefined) =>
    x === undefined || y === undefined || x.text === y.text
  return sideTextEq(a.left, b.left) && sideTextEq(a.right, b.right)
}

/**
 * 定位 hunk 在全量 rows 中的 0-based 起止下标（ENG-009 出口，供 UI-010
 * 滚动定位与当前 hunk 高亮消费）。
 *
 * 这是【尽力定位】：UI 高亮 / 滚动场景允许近似，不作为数据一致性依据。
 * 定位策略按可靠性分层，命中即返回（`end = start + hunk.rows.length - 1`，
 * 恒有 `end < rows.length`，即只返回能完整容纳 hunk 的窗口）：
 *
 * 1. 引用匹配（主路径，精确）：ENG-008 `buildHunks` 保证 `hunk.rows` 是
 *    rows 的连续切片（共享行对象引用），逐项 `===` 找首个全窗口引用一致
 *    的位置 —— 引用在引擎内唯一，命中即精确；
 * 2. 内容 + 行号匹配（精确）：rows 被「重建但行号与内容不变」的场景
 *    （如 UI 侧深拷贝 / 反序列化后引用全变）退化为逐行比较 type 与双侧
 *    lineNo、text；
 * 3. 首尾文本匹配（尽力）：hunk 与 rows 行号体系不一致时（上下文裁剪、
 *    行号重排、del+add 重投影为 modify 等），只按 hunk 首行 / 末行的
 *    存在侧文本寻找首个首尾同时命中的窗口；
 * 4. 首行行号匹配（尽力）：以上全不命中时，按 hunk 首行自身存在侧的
 *    行号（`left.lineNo`，无 left 则 `right.lineNo`；由 `buildHunk` 的
 *    header 规则，这正是 header 的 oldStart / newStart）在 rows 中找首个
 *    行号相同、且能容纳整个 hunk 窗口的行 —— 内容可能已不同，仅作滚动
 *    锚点；
 * 5. 全部未命中（含 hunk.rows 为空、rows 为空、hunk 比 rows 还长）→
 *    返回 `{ start: -1, end: -1 }`，UI 据此跳过高亮。
 *
 * 注意策略 3/4 允许近似：返回的窗口内容可能与 hunk 不完全一致，仅用于
 * 视觉定位；需要精确对齐时请依赖策略 1/2 的返回（或调用方自行校验
 * `rows.slice(start, end + 1)` 与 `hunk.rows` 深度相等）。
 *
 * @param hunk 目标 hunk（通常来自 `buildHunks` / `compareFull` 的 hunks）
 * @param rows 完整展开的差异行序列（通常为产生该 hunk 的同一 rows；只读）
 * @returns 0-based 起止下标 `{ start, end }`（闭区间）；无法定位时为
 *          `{ start: -1, end: -1 }`
 */
export function hunkAnchorRows(hunk: Hunk, rows: DiffRow[]): { start: number; end: number } {
  const hunkRows = hunk.rows
  const len = hunkRows.length
  const notFound = { start: -1, end: -1 }
  // 空 hunk / 空 rows / hunk 比 rows 还长：不存在能容纳 hunk 的窗口。
  if (len === 0 || rows.length < len) return notFound

  // 1. 引用匹配（主路径）：逐项 === 验证整个窗口（引用在引擎内唯一）。
  const first = hunkRows[0]
  for (let i = 0; i + len <= rows.length; i += 1) {
    if (rows[i] !== first) continue
    let matched = true
    for (let k = 1; k < len; k += 1) {
      if (rows[i + k] !== hunkRows[k]) {
        matched = false
        break
      }
    }
    if (matched) return { start: i, end: i + len - 1 }
  }

  // 2. 内容 + 行号匹配：rows 被重建（引用全变）但 type / lineNo / text 不变。
  for (let i = 0; i + len <= rows.length; i += 1) {
    let matched = true
    for (let k = 0; k < len; k += 1) {
      if (!rowsMatchExact(rows[i + k], hunkRows[k])) {
        matched = false
        break
      }
    }
    if (matched) return { start: i, end: i + len - 1 }
  }

  // 3. 首尾文本匹配（尽力）：只要求窗口首行 / 末行的存在侧文本命中。
  const last = hunkRows[len - 1]
  for (let i = 0; i + len <= rows.length; i += 1) {
    if (rowsMatchLoose(rows[i], first) && rowsMatchLoose(rows[i + len - 1], last)) {
      return { start: i, end: i + len - 1 }
    }
  }

  // 4. 首行行号匹配（尽力）：按首行【存在侧】的行号（即 header 的
  //    oldStart / newStart，见 buildHunk 的 header 规则）在【同一侧】找首个
  //    可容纳窗口的行 —— 内容可能已不同，仅作滚动锚点；同侧匹配避免跨侧
  //    行号巧合（如纯 add 开头的 hunk 误中另一行的 left.lineNo）。
  if (first.left !== undefined) {
    const anchorLineNo = first.left.lineNo
    for (let i = 0; i + len <= rows.length; i += 1) {
      if (rows[i].left?.lineNo === anchorLineNo) return { start: i, end: i + len - 1 }
    }
  } else if (first.right !== undefined) {
    const anchorLineNo = first.right.lineNo
    for (let i = 0; i + len <= rows.length; i += 1) {
      if (rows[i].right?.lineNo === anchorLineNo) return { start: i, end: i + len - 1 }
    }
  }

  return notFound
}
