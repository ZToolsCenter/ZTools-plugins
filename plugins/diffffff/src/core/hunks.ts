/**
 * ============================================================================
 * unified patch / hunk 模型（roadmap 任务 ENG-008）
 * ============================================================================
 *
 * 把 `DiffResult.rows`（完整展开的行序列，含 `'equal'` 行）投影为 unified
 * 视图（UI-007）需要的两类视图数据：
 *
 * - `Hunk[]`：@@ 分块。每个 hunk 是 rows 的一段连续切片（含上下文行），
 *   携带 `@@ -oldStart,oldLines +newStart,newLines @@` 头（UI-007 可选显示）；
 * - `CollapseRange[]`：hunk 之间超出上下文的未更改区段 → 折叠条数据
 *   （UI-008 在下标 `beforeRow` 前渲染「⋯ 展开未更改的 N 行」）。
 *
 * 核心语义（与 `./types.ts` 的契约对齐）：
 * - rows 永远是完整展开序列：被折叠的行仍留在 rows 中，hunks / collapses
 *   只是投影视图（下标均基于完整 rows，0-based）；
 * - 「变更行」= `type !== 'equal'` 的行（`'del'` / `'add'` / `'modify'` 都算，
 *   modify 行左右两侧都存在，header 计数时两侧各计 1）；
 * - 相邻变更行（或变更簇）之间隔着的 equal 行数 ≤ 2 * contextLines 时合并为
 *   同一簇（两侧各扩 contextLines 的上下文会相遇/交叠，切开没有意义）；
 *   每簇再向两侧各扩 contextLines 个 equal 行（不足则到边界）形成 hunk；
 * - 只折叠「两个 hunk 之间」超出上下文的部分：两簇间隔 gap > 2 * contextLines
 *   时才拆开，此时 hunk 之间未被覆盖的 equal 行数恒为 gap - 2*contextLines ≥ 1，
 *   对应一个 `CollapseRange { beforeRow: 下一 hunk 首行下标, count }`（按
 *   types.ts 约定覆盖 `rows[beforeRow - count, beforeRow)`）；首 hunk 之前与
 *   末 hunk 之外侧的多余 equal 行不折叠（文件头尾天然可见）；
 * - 全部行 equal（无变更）→ 不产出任何 hunk、也不折叠全文件，双空数组。
 *
 * 硬性约束（对齐其他引擎模块）：
 * - 零 UI 依赖、零 DOM、零 store 依赖：只 import `./types.ts`；
 * - 不可变风格：返回新数组，`hunk.rows` 为入参 rows 的切片（共享行对象引用，
 *   从不修改入参的任何对象）。
 * ============================================================================
 */

import type { CollapseRange, DiffRow, Hunk } from './types'

/**
 * 把差异行序列切分为 hunks 与默认折叠区段（ENG-008 主入口）。
 *
 * 算法（三步）：
 * 1. 定位变更行：收集 `type !== 'equal'` 的行下标（升序；空数组 = 全 equal，
 *    直接返回双空数组，不折叠全文件）；
 * 2. 簇合并：相邻变更下标之间隔着的 equal 行数（`next - prev - 1`）
 *    ≤ 2 * contextLines 时归入同一簇 —— 两侧各扩 contextLines 的上下文
 *    将相遇或交叠，拆开会产生相邻贴边的两个 hunk，合并才符合 unified patch
 *    惯例（也是 git 的合并阈值）；
 * 3. 扩展与组装：每簇 [first, last] 向两侧各扩 contextLines 个 equal 行
 *    （`start = max(0, first - context)`、`end = min(rows.length - 1, last + context)`；
 *    `contextLines = 0` 时 hunk 紧贴变更行），得到互不重叠的 hunk 区间；
 *    相邻两 hunk 之间未被覆盖的 equal 区段生成 CollapseRange —— 由于簇拆分
 *    条件是间隔 > 2 * contextLines，该区段行数（间隔 − 2*contextLines）恒 ≥ 1，
 *    不会出现空折叠。
 *
 * header 规则（`@@ -oldStart,oldLines +newStart,newLines @@`）：
 * - oldStart：hunk 首行若含左侧（`left` 存在）取 `left.lineNo`，否则（纯新增
 *   开头的 hunk）取 `right.lineNo`；newStart 对称地取 `right.lineNo`（缺右侧
 *   时取 `left.lineNo`）。行号均为 1-based（对齐 `DiffRowSide.lineNo`）；
 * - oldLines / newLines：hunk 内 `left` / `right` 存在的行数 —— `'modify'`
 *   行两侧都在，同时计入两个计数；`'del'` 只计 oldLines，`'add'` 只计
 *   newLines；
 * - 计数为 1 时仍保留 `,1`（如 `@@ -2,1 +2,1 @@`）：git 惯例中单行计数可
 *   省略 `,1`（`@@ -2 +2 @@`），本实现统一保留以简化 UI 侧的解析与测试
 *   断言，属与 git 的已知格式差异；
 * - 纯新增开头的 hunk oldStart 取 right.lineNo、纯删除开头 newStart 取
 *   left.lineNo，与 git 对空侧「回退一行」的特殊约定不同（git 在该场景下
 *   会指向插入点前一行 / 0），此处按 types.ts 的简化契约处理。
 *
 * 边界行为：
 * - rows 为空 → `{ hunks: [], collapses: [] }`；
 * - 全部行 equal → 同上（无变更即无 hunk，也不折叠全文件）；
 * - 全部行变更 → 单 hunk 覆盖全部行、无 collapses；
 * - contextLines ≤ 0 → 按 0 处理（hunk 紧贴变更行，hunk 之间的 equal 行
 *   全部折叠）。
 *
 * @param rows 完整展开的差异行序列（通常来自 `diffLinesCore` /
 *             `compareWithOptions` / `rowsWithPairing`，含 `'equal'` 行）
 * @param contextLines 每个 hunk 向变更簇两侧扩展的上下文行数（默认 3，可调）
 * @returns `hunks`（按出现顺序排列）与 `collapses`（按 beforeRow 升序、
 *          互不重叠）；hunk 覆盖区 ∪ 折叠区 ∪ 头尾未折叠的 equal 行
 *          恰好不重不漏地覆盖全部 rows 下标
 */
export function buildHunks(
  rows: DiffRow[],
  contextLines = 3,
): { hunks: Hunk[]; collapses: CollapseRange[] } {
  if (rows.length === 0) return { hunks: [], collapses: [] }
  // 防御：负数上下文按 0 处理（非整数向下取整），保证切片下标恒为合法整数。
  const context = Math.max(0, Math.floor(contextLines))

  // 1. 变更行下标（'del' / 'add' / 'modify' 都算，仅 'equal' 不算）。
  const changeIndexes: number[] = []
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].type !== 'equal') changeIndexes.push(i)
  }
  // 全 equal：无变更即无 hunk，也不折叠全文件（文件头尾外侧不折叠的推论）。
  if (changeIndexes.length === 0) return { hunks: [], collapses: [] }

  // 2. 簇合并：相邻变更下标间隔（中间 equal 行数）≤ 2 * context 合并同簇。
  const clusters: Array<{ first: number; last: number }> = []
  let current = { first: changeIndexes[0], last: changeIndexes[0] }
  for (let k = 1; k < changeIndexes.length; k += 1) {
    const index = changeIndexes[k]
    if (index - current.last - 1 <= 2 * context) {
      current.last = index
    } else {
      clusters.push(current)
      current = { first: index, last: index }
    }
  }
  clusters.push(current)

  // 3a. 簇向两侧扩 context 得到 hunk 的 0-based 闭区间 [start, end]
  //     （不足则夹到数组边界；不同簇的区间互不重叠，可能相邻也可能留缝）。
  const ranges = clusters.map((cluster) => ({
    start: Math.max(0, cluster.first - context),
    end: Math.min(rows.length - 1, cluster.last + context),
  }))

  const hunks = ranges.map((range) => buildHunk(rows, range.start, range.end))

  // 3b. 相邻 hunk 之间的缝隙（未入 hunk 的 equal 行）→ CollapseRange：
  //     折叠区段为 rows[range[k].end + 1, range[k+1].start)，按 types.ts
  //     约定 beforeRow = 区段之后第一行的下标 = 下一 hunk 的 start。
  //     簇拆分条件保证缝隙行数（间隔 − 2*context）恒 ≥ 1，count > 0 守卫
  //     仅作结构自检。
  const collapses: CollapseRange[] = []
  for (let k = 0; k < ranges.length - 1; k += 1) {
    const count = ranges[k + 1].start - ranges[k].end - 1
    if (count > 0) collapses.push({ beforeRow: ranges[k + 1].start, count })
  }

  return { hunks, collapses }
}

/**
 * 把 rows 的一个 0-based 闭区间 [start, end] 组装为单个 Hunk（模块内私有）。
 *
 * - `rows` 为入参的连续切片（`Array.prototype.slice`，行对象引用共享 ——
 *   切片行与全量 rows 中的同一行是同一对象，UI-007/008 据此对齐下标）；
 * - oldStart / newStart 取首行的行号：left 存在取 `left.lineNo`，否则取
 *   `right.lineNo`（newStart 对称），见 `buildHunks` JSDoc 的 header 规则；
 * - oldLines / newLines 按 `left` / `right` 存在性计数（modify 行两侧都计）；
 * - 计数为 1 时仍保留 `,N`（与 git 可省略 `,1` 的差异见 `buildHunks` JSDoc）。
 *
 * @param rows 完整差异行序列（只读，本函数不修改）
 * @param start hunk 首行的 0-based 下标（含）
 * @param end hunk 末行的 0-based 下标（含，恒 ≥ start）
 * @returns 覆盖该区间的 Hunk（rows 切片 + @@ 头 + 四个 patch 计数）
 */
function buildHunk(rows: DiffRow[], start: number, end: number): Hunk {
  const hunkRows = rows.slice(start, end + 1)
  const first = hunkRows[0]

  let oldLines = 0
  let newLines = 0
  for (const row of hunkRows) {
    if (row.left !== undefined) oldLines += 1
    if (row.right !== undefined) newLines += 1
  }

  // 首行至少一侧存在（DiffRow 契约），oldStart / newStart 各取存在侧的行号。
  const oldStart = first.left !== undefined ? first.left.lineNo : first.right!.lineNo
  const newStart = first.right !== undefined ? first.right.lineNo : first.left!.lineNo

  return {
    header: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
    rows: hunkRows,
    oldStart,
    oldLines,
    newStart,
    newLines,
  }
}
