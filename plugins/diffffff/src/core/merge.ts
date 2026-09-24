/**
 * ============================================================================
 * 合并更改（roadmap 任务 UI-012）：把单个 hunk 的一侧内容应用到另一侧
 * ============================================================================
 *
 * 提供 hunk 级「合并箭头」的引擎纯函数，供 UI-012 的「⇤ 应用到左侧 /
 * 应用到右侧 ⇥」控制条消费：
 *
 * - `applyHunk(texts, rows, hunk, direction)`：按方向把 hunk 中一侧的行文本
 *   序列写入另一侧的对应区间，返回新的双侧文本（不可变，从不修改入参）；
 * - `applyHunkById(texts, rows, hunks, hunkIndex, direction)`：按 hunk 下标
 *   的便捷封装（越界返回 null，选择理由见函数 JSDoc）。
 *
 * 方向语义（与 UI-012 两个按钮一一对应，即主流合并工具的 conflict 取侧语义）：
 * - `'left-to-right'`（「应用到右侧 ⇥」）：让右侧的这一段长得像左侧 ——
 *   右侧对应区间 [newStart-1, newStart-1+newLines)（1-based → 0-based）被
 *   整体替换为「hunk.rows 中存在 left 的行文本序列（按 rows 顺序）」，
 *   左侧原文不变。推论（l2r 视角的行类型处理）：
 *   · 只有 right 的行（'add'）在应用后从右侧消失 —— 等价于撤销该新增；
 *   · 只有 left 的行（'del'）把左侧文本带入右侧 —— 等价于在右侧恢复被删行；
 *   · 'equal' 行按其 left.text 写入（严格对比下两侧文本相同 = 原样保留；
 *     忽略选项下两侧原文可能不同，按「取左侧原文」的合并语义处理）；
 *   · 'modify' 行（若调用方传入配对后的 rows）两侧都在，按其 left.text 处理。
 * - `'right-to-left'`（「⇤ 应用到左侧」）：镜像 —— 左侧区间
 *   [oldStart-1, oldStart-1+oldLines) 被替换为「存在 right 的行文本序列」，
 *   右侧原文不变。
 *
 * 输入规范化选择（与 compareFull 管线一致，ENG-010）：两侧先 `normalizeText`
 * 剥除开头单个 U+FEFF 再 `splitLines` 切分。理由：hunk 的 oldStart / newStart
 * 行号基于「剥 BOM 后」的文本（引擎入口先剥再切），若此处不剥 BOM，带 BOM
 * 一侧的切分下标会整体偏移一行，区间就错了；先 normalize 与 compareFull
 * 完全同口径，行号恒对齐。行尾符（CRLF / LF / CR）由 splitLines 统一按行
 * 切分、不进入行内容，混用行尾符不影响区间对齐。
 *
 * 输出重组（行尾风格 / 尾部换行 / BOM 的保真策略，见 assembleText）：
 * - 行尾风格：按目标侧原文检测 —— 含 `\r\n` 时以 `\r\n` 连接，否则以 `\n`
 *   （混用行尾符的文件统一为检测到的风格；行尾符在引擎比较语义中是噪声，
 *   ENG-010 策略第 2 条，重 diff 不产生幻影差异）；
 * - 尾部换行：目标侧原文以换行结尾时结果保留结尾换行，否则不添加
 *   （'a\n' ≡ 'a' 的等价性保证重 diff 不受影响，保留只为编辑器内容保真；
 *   结果为 0 行时不补结尾换行，避免产出孤立的空行）；
 * - BOM：目标侧原文以 U+FEFF 开头时在结果头部保留（BOM 是文件元数据，
 *   剥除只发生在比较与切分视图，不应因一次合并而丢失）。
 *
 * 调用方契约与防御路径（重要）：`hunk` / `rows` 必须来自「当前 texts 经同一
 * 引擎管线产出的那次对比结果」（即 diffStore.result 的产物）。本函数会做
 * 防御性同步核对（尽力而为，不改变执行路径）：① 两侧区间切片内容与
 * hunk.rows 的行文本逐字一致；② hunk.rows 是 rows 的连续切片（引用级）。
 * 不一致 = 输入与产生 hunks 的那次对比已不同步（例如用户在保留编辑态改了
 * 文本尚未重跑）—— 此时【仍按区间执行】：区间下标来自 hunk 的
 * oldStart/oldLines/newStart/newLines，替换内容来自 hunk.rows 的行文本，
 * 结果仍是良定义的（只是可能不符合用户对「这段内容」的预期），不抛错、
 * 不回退，仅 console.debug 记录，调用方无需预校验。
 *
 * 硬性约束（对齐其他引擎模块）：零 UI 依赖、零 DOM、零 store 依赖（仅
 * import `./diff.ts` 的 splitLines、`./normalize.ts` 的 normalizeText 与
 * `./types.ts` 的类型）；纯函数、不可变：不修改入参的任何对象 / 数组 /
 * 字符串，恒返回新对象。
 * ============================================================================
 */

import { splitLines } from './diff'
import { normalizeText } from './normalize'
import type { DiffRow, Hunk } from './types'

/**
 * 合并方向：`'left-to-right'` = 把该 hunk 的左侧行内容应用到右侧
 * （「应用到右侧 ⇥」按钮）；`'right-to-left'` = 镜像（「⇤ 应用到左侧」按钮）。
 */
export type MergeDirection = 'left-to-right' | 'right-to-left'

/** 双侧文本（applyHunk / applyHunkById 的输入与输出形状）。 */
export interface MergeTexts {
  /** 左侧（原始文本）原文。 */
  left: string
  /** 右侧（更改后文本）原文。 */
  right: string
}

/**
 * 把 1-based 区间（起点 start1b、行数 count）换算为 0-based 闭开区间
 * [start, end)，并钳制到 [0, lineCount] 内 —— 防御 hunk 计数与文本不同步时
 * 的越界下标（slice 的负数 / 越界语义会把区间解释到另一端，必须先钳制）。
 *
 * @param lineCount 目标侧总行数（钳制上界）
 * @param start1b 区间起点（1-based 行号）
 * @param count 区间行数（负数按 0 处理）
 * @returns 0-based 闭开区间 `{ start, end }`，恒满足 0 ≤ start ≤ end ≤ lineCount
 */
function clampInterval(
  lineCount: number,
  start1b: number,
  count: number,
): { start: number; end: number } {
  const start = Math.min(Math.max(0, Math.floor(start1b) - 1), lineCount)
  const end = Math.min(Math.max(start, start + Math.max(0, Math.floor(count))), lineCount)
  return { start, end }
}

/** 两个行文本序列逐元素相等（防御性同步核对的小工具）。 */
function sameSequence(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * 判断 hunk.rows 是否为 rows 的连续切片（引用级）。
 *
 * ENG-008 buildHunks 保证 hunk.rows 与全量 rows 共享行对象引用，引用级核对
 * 是最廉价且最严格的同步证据；rows 被调用方重建（引用全变）时核对失败，
 * 与「区间内容不一致」一样只触发 console.debug，不改变执行路径。
 */
function isContiguousSlice(hunkRows: DiffRow[], rows: DiffRow[]): boolean {
  if (hunkRows.length === 0) return true
  const start = rows.indexOf(hunkRows[0])
  if (start < 0 || start + hunkRows.length > rows.length) return false
  for (let k = 1; k < hunkRows.length; k += 1) {
    if (rows[start + k] !== hunkRows[k]) return false
  }
  return true
}

/**
 * 把行文本数组按目标侧原文的保真策略重组为文本（策略见文件头「输出重组」）。
 *
 * @param lines 结果行内容序列（不含行尾符）
 * @param original 目标侧重组前的原文（行尾风格 / 尾部换行 / BOM 的检测来源）
 * @returns 重组后的文本（0 行时仅为 BOM 或空串）
 */
function assembleText(lines: string[], original: string): string {
  const bom = original.charCodeAt(0) === 0xfeff ? '\uFEFF' : ''
  if (lines.length === 0) return bom
  const joiner = original.includes('\r\n') ? '\r\n' : '\n'
  const trailing = /(?:\r\n|\n|\r)$/.test(original) ? joiner : ''
  return `${bom}${lines.join(joiner)}${trailing}`
}

/**
 * 把单个 hunk 按指定方向应用到双侧文本上（UI-012 主入口）。
 *
 * 实现步骤：
 * 1. 两侧先 `normalizeText` 剥 BOM 再 `splitLines` 切分（与 compareFull 同
 *    口径，hunk 行号恒对齐，见文件头「输入规范化选择」）；
 * 2. 替换内容以 hunk.rows 为准：按 rows 顺序收集「存在 left 的行文本」与
 *    「存在 right 的行文本」（'modify' 行两侧都存在，两个序列各收一次，
 *    l2r 消费前者、r2l 消费后者，自然满足「按其 left.text / right.text
 *    处理」的约定）；
 * 3. 防御性同步核对（结果只用于 console.debug，不改变执行路径，契约见
 *    文件头「调用方契约与防御路径」）；
 * 4. 按方向拼接：目标侧 = 区间前缀 + 对侧行文本序列 + 区间后缀，另一侧
 *    原样保留；最后按目标侧原文的行尾风格 / 尾部换行 / BOM 重组文本。
 *
 * @param texts 应用前的双侧原始文本（未做任何规范化，BOM / CRLF / 尾部换行
 *              原样保留；与产生 hunk 的那次对比输入一致时语义最准确）
 * @param rows  产生 hunk 的那次对比的完整行序列（result.rows；只读，用于
 *              防御性切片核对）
 * @param hunk  待应用的 hunk（result.hunks 的元素）
 * @param direction 应用方向，语义见 `MergeDirection` 与文件头
 * @returns 新的双侧文本对象（不可变：text 为目标侧重组结果 / 另一侧原串，
 *          恒返回新对象，从不修改入参）
 */
export function applyHunk(
  texts: MergeTexts,
  rows: DiffRow[],
  hunk: Hunk,
  direction: MergeDirection,
): MergeTexts {
  // 与 compareFull 管线同口径：先剥 BOM 再切分（hunk 行号基于规范化后文本）。
  const leftLines = splitLines(normalizeText(texts.left))
  const rightLines = splitLines(normalizeText(texts.right))

  // 替换内容序列（以 hunk.rows 为准，按 rows 顺序收集存在侧的行文本）。
  const leftTexts: string[] = []
  const rightTexts: string[] = []
  for (const row of hunk.rows) {
    if (row.left !== undefined) leftTexts.push(row.left.text)
    if (row.right !== undefined) rightTexts.push(row.right.text)
  }

  // 防御性同步核对（尽力而为，仅 debug 记录 —— 契约见文件头）：区间切片应与
  // hunk.rows 行文本一致、hunk.rows 应为 rows 的连续切片。
  const leftInterval = clampInterval(leftLines.length, hunk.oldStart, hunk.oldLines)
  const rightInterval = clampInterval(rightLines.length, hunk.newStart, hunk.newLines)
  const inSync =
    sameSequence(leftLines.slice(leftInterval.start, leftInterval.end), leftTexts) &&
    sameSequence(rightLines.slice(rightInterval.start, rightInterval.end), rightTexts) &&
    isContiguousSlice(hunk.rows, rows)
  if (!inSync) {
    console.debug(
      '[merge] applyHunk：输入文本与 hunk / rows 已不同步，仍按区间执行（调用方契约见 merge.ts 文件头）：',
      hunk.header,
    )
  }

  if (direction === 'left-to-right') {
    // 右侧区间 [newStart-1, newStart-1+newLines) ← hunk.rows 的左侧行文本序列。
    return {
      left: texts.left,
      right: assembleText(
        [
          ...rightLines.slice(0, rightInterval.start),
          ...leftTexts,
          ...rightLines.slice(rightInterval.end),
        ],
        texts.right,
      ),
    }
  }
  // right-to-left：左侧区间 [oldStart-1, oldStart-1+oldLines) ← 右侧行文本序列。
  return {
    left: assembleText(
      [
        ...leftLines.slice(0, leftInterval.start),
        ...rightTexts,
        ...leftLines.slice(leftInterval.end),
      ],
      texts.left,
    ),
    right: texts.right,
  }
}

/**
 * 按 hunk 下标应用的便捷封装（UI-012 视图层的主调用形态：视图只持有
 * result.hunks 的下标）。
 *
 * 越界行为的选择：【返回 null 而非抛错】。理由：下标来自视图渲染序列
 * （v-for 的 hunk 下标），越界只可能发生在「result 已重算而视图事件迟到」
 * 的竞态窗口，属于可静默降级的防御路径 —— 返回 null 让调用方 no-op 即可，
 * 不必在每个调用点包 try/catch；真正的程序性错误（hunks 与 rows 不同源）
 * 由 applyHunk 内部的同步核对 debug 记录兜底。
 *
 * @param texts 双侧原始文本（语义同 `applyHunk`）
 * @param rows  完整行序列（语义同 `applyHunk`）
 * @param hunks hunk 列表（通常为 result.hunks）
 * @param hunkIndex 目标 hunk 在 hunks 中的 0-based 下标
 * @param direction 应用方向（语义同 `applyHunk`）
 * @returns 命中时为 `applyHunk` 的结果；hunkIndex 越界（< 0 / ≥ hunks.length）
 *          或非整数时为 null
 */
export function applyHunkById(
  texts: MergeTexts,
  rows: DiffRow[],
  hunks: Hunk[],
  hunkIndex: number,
  direction: MergeDirection,
): MergeTexts | null {
  if (!Number.isInteger(hunkIndex) || hunkIndex < 0 || hunkIndex >= hunks.length) {
    return null
  }
  return applyHunk(texts, rows, hunks[hunkIndex], direction)
}
