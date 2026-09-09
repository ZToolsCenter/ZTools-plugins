/**
 * ============================================================================
 * hunk 导航状态 store（roadmap 任务 UI-010）
 * ============================================================================
 *
 * 持有「上一处 / 下一处差异」导航的当前定位态，供主区顶部工具条的导航按钮
 * 组（▲/▼ 图标按钮与 F3/Shift+F3 快捷键）与两个结果视图（当前 hunk 高亮、
 * 滚动定位）消费。
 *
 * store 归属决策（任务给定「独立小 store 或并入 diff.ts」二选一，选独立）：
 * - diffStore 的职责是「触发 → 调引擎 → 存结果」的结果状态机（diff.ts 文件头
 *   有明确的职责边界声明），导航定位是纯 UI 态（视图探索进度），与结果生命
 *   周期不同步 —— result 重跑时导航重置（App.vue watch 调 reset()），但「返
 *   回编辑再回到结果态」时定位保留（result 未变）；并入会让 diff.ts 同时背
 *   两种生命周期；
 * - 消费面也与 diffStore 不同：本 store 被两视图 + App 工具条导航组三方读、仅导航
 *   入口（按钮 / 快捷键）写，独立小文件边界最清晰（与 workbench / view 同为
 *   模块级 reactive 单例，刻意不引 Pinia 的工程惯例一致）。
 *
 * 下标空间约定（跨视图共享的关键决策）：
 * - `currentIndex` 基于 `diffStore.result.hunks` 的下标（0-based，-1 = 未定
 *   位），跳转计算走 ENG-009 的 `nextHunkIndex`（循环回绕）；
 * - `currentAnchor` 是当前 hunk 在【result.rows 原始下标空间】的起止
 *   （hunkAnchorRows 契约）。统一视图（UnifiedDiffView）的行序列就是原始
 *   rows（不经配对合并），直接消费；并排视图（SplitDiffView）的渲染序列经
 *   rowsWithPairing 合并（del+add → modify，序列变短），须先经
 *   `translateAnchorToPaired` 翻译到配对序列的下标空间再消费（翻译实现与
 *   单测见下方函数 JSDoc 与 tests/ui/nav.test.ts）。切换视图不丢当前位置：
 *   两视图各自从同一 store 读取并做各自的翻译 / 定位。
 *
 * 单一出口原则：键盘（F3/Shift+F3）与按钮（▲/▼）都只调 goNext / goPrev，
 * 导航语义（循环回绕、无结果 / 空 hunks 时的 no-op）只有这一份实现。
 * ============================================================================
 */
import { computed, reactive } from 'vue'
import { hunkAnchorRows, nextHunkIndex } from '../core/stats'
import { isDiffOk } from '../core/types'
import type { DiffRow, Hunk } from '../core/types'
import { diffStore } from './diff'

/** 导航锚点：某一下标空间中当前 hunk 覆盖的 0-based 闭区间起止 */
export interface RowAnchor {
  /** 起始行下标（0-based，含） */
  start: number
  /** 结束行下标（0-based，含） */
  end: number
}

/** 对外 store 形状：当前定位 + 导航动作 + 锚点派生 */
export interface NavStore {
  /**
   * 当前定位的 hunk 下标（result.hunks 的 0-based 下标；-1 = 未定位）。
   * 只经 goNext / goPrev / reset 变更（单一出口原则，见文件头）。
   */
  currentIndex: number
  /**
   * 导航动作序号：每次 goNext / goPrev / reset 自增。视图 watch 本序号而非
   * currentIndex 来触发滚动定位 —— 单 hunk 场景下 goNext 的目标下标与当前
   * 相同（循环回绕 (0+1+1)%1 = 0），currentIndex 不变 watch 不触发，用户
   * 手动滚走后按 F3 / 点按钮就「跳不回」当前 hunk；seq 保证每次导航动作
   * （含同值定位）都可被视图感知。reset 也自增（此时锚点为 null，视图自然
   * 跳过滚动，无副作用）。
   */
  seq: number
  /**
   * 当前 hunk 的滚动 / 高亮锚点（result.rows 原始下标空间，语义见文件头）。
   * null = 未定位（currentIndex 为 -1 / 越界）或 hunkAnchorRows 尽力定位
   * 失败（start 为 -1）—— 两视图对 null 一致跳过高亮与滚动。
   */
  readonly currentAnchor: RowAnchor | null
  /** 定位到下一处差异（循环回绕；无结果 / 无 hunk 时 no-op） */
  goNext: () => void
  /** 定位到上一处差异（循环回绕；无结果 / 无 hunk 时 no-op） */
  goPrev: () => void
  /**
   * 重置定位（currentIndex 归 -1）：result 变化（重跑 / 清空 / 空态短路）
   * 后旧下标失去意义，由 App.vue 的 result watch 调用（任务指定接线位置）。
   */
  reset: () => void
}

/**
 * 当前结果的有效 hunk 列表：仅成功结果有 hunks；错误结果 / 无结果视为空
 * （nextHunkIndex 对空列表返回 -1，导航动作自然退化为 no-op）。
 */
function currentHunks(): Hunk[] {
  const result = diffStore.result
  return result !== null && isDiffOk(result) ? result.hunks : []
}

/**
 * 定位到下一处差异（循环回绕）。键盘与按钮的唯一出口之一：未定位（-1）/
 * 越界时从第一个 hunk 开始（nextHunkIndex 契约），合法时 +1 回绕。
 */
function goNext(): void {
  navStore.currentIndex = nextHunkIndex(currentHunks(), navStore.currentIndex, 1)
  navStore.seq += 1
}

/** 定位到上一处差异（循环回绕；未定位时从最后一个 hunk 开始）。语义同 goNext */
function goPrev(): void {
  navStore.currentIndex = nextHunkIndex(currentHunks(), navStore.currentIndex, -1)
  navStore.seq += 1
}

/** 重置定位（语义见 NavStore.reset JSDoc）。seq 同步自增，视图可感知重置 */
function reset(): void {
  navStore.currentIndex = -1
  navStore.seq += 1
}

/**
 * 当前 hunk 的原始下标空间锚点（computed 并入 reactive 单例，与 viewStore 的
 * diffOptions 同风格）。防御链：无成功结果 / currentIndex 越界（含 -1）/
 * hunkAnchorRows 尽力定位失败（start < 0）一律返回 null。
 */
const currentAnchor = computed<RowAnchor | null>(() => {
  const result = diffStore.result
  if (result === null || !isDiffOk(result)) return null
  const index = navStore.currentIndex
  if (!Number.isInteger(index) || index < 0 || index >= result.hunks.length) return null
  const anchor = hunkAnchorRows(result.hunks[index], result.rows)
  return anchor.start < 0 ? null : { start: anchor.start, end: anchor.end }
})

/**
 * 导航状态单例 store（模块级 reactive，与 workbench / view / diff 同风格）。
 */
export const navStore: NavStore = reactive({
  currentIndex: -1,
  seq: 0,
  currentAnchor,
  goNext,
  goPrev,
  reset,
})

/* -------------------------------------------------------------------------- */
/* translateAnchorToPaired：锚点的原始 → 配对下标空间翻译（纯函数）               */
/* -------------------------------------------------------------------------- */

/**
 * 把原始 rows 下标空间的导航锚点翻译到「配对后序列」的下标空间（UI-010）。
 *
 * 背景：导航锚点基于 result.rows（hunkAnchorRows 契约），并排视图的渲染序列
 * 经 rowsWithPairing 合并（替换区域内相似度达标的 del+add 合并为一条 modify
 * 行，序列变短），两端点必须翻译后才能用于高亮范围与滚动定位。与
 * SplitDiffView 的 pairedCollapses（UI-008）同属「原始 → 配对」翻译，依据
 * 同一组结构不变量（ENG-005 / ENG-008 保证）：
 *
 * 1. 任一侧 lineNo 在整个序列中唯一（旧文件的每一行恰好成为某行的 left 一
 *    次，新文件同理于 right；modify 的 left / right 分别取自原 del / add 行）
 *    —— 原始行按其存在侧 lineNo 在配对序列中唯一定位（定位到的可能是
 *    modify：del / add 被配对时其镜像就是该 modify 行）；
 * 2. 配对不改变相对顺序、不跨区段（del+add 只在相邻替换块内合并，equal 行
 *    原位 1:1 保留）—— 翻译后 start ≤ end 恒成立，hunk 覆盖的行在配对序列
 *    中仍是连续区段（高亮 / 滚动可直接用 [start, end] 闭区间）。
 *
 * 快路径：配对未合并任何行（pairedRows.length === originalRows.length，纯
 * 增删 diff 的常见形态）时两个下标空间相同，直接原样返回。
 *
 * 防御：anchor 本身非法（start < 0 / end < start / end 越过原始序列）或任
 * 一端点按 lineNo 定位失败（契约上不可达，仅防御 rows 与配对序列不一致的
 * 竞态）→ 返回 { start: -1, end: -1 }，视图对 -1 一致跳过高亮与滚动。
 *
 * @param anchor 原始 rows 下标空间的锚点（navStore.currentAnchor 产物）
 * @param originalRows 原始完整行序列（result.rows；只读）
 * @param pairedRows 配对后行序列（rowsWithPairing 产物；只读）
 * @returns 配对序列下标空间的锚点；无法翻译时为 { start: -1, end: -1 }
 */
export function translateAnchorToPaired(
  anchor: RowAnchor,
  originalRows: DiffRow[],
  pairedRows: DiffRow[],
): RowAnchor {
  const notFound: RowAnchor = { start: -1, end: -1 }
  if (!Number.isInteger(anchor.start) || !Number.isInteger(anchor.end)) return notFound
  if (anchor.start < 0 || anchor.end < anchor.start || anchor.end >= originalRows.length) {
    return notFound
  }
  if (pairedRows.length === originalRows.length) {
    return { start: anchor.start, end: anchor.end }
  }

  // lineNo → 配对序列下标（左右各一张；lineNo 唯一性不变量见上，重复时
  // 后写覆盖仅作防御，不影响正确性）。
  const leftIndexByLineNo = new Map<number, number>()
  const rightIndexByLineNo = new Map<number, number>()
  pairedRows.forEach((row, index) => {
    if (row.left !== undefined) leftIndexByLineNo.set(row.left.lineNo, index)
    if (row.right !== undefined) rightIndexByLineNo.set(row.right.lineNo, index)
  })

  // 原始行 → 配对下标：按存在侧 lineNo 定位（先左后右；del 只有 left、
  // add 只有 right、equal / modify 两侧都有且定位结果一致）。
  const locate = (rowIndex: number): number => {
    const row = originalRows[rowIndex]
    if (row.left !== undefined) return leftIndexByLineNo.get(row.left.lineNo) ?? -1
    if (row.right !== undefined) return rightIndexByLineNo.get(row.right.lineNo) ?? -1
    return -1
  }
  const start = locate(anchor.start)
  const end = locate(anchor.end)
  if (start < 0 || end < 0) return notFound
  // 配对保持相对顺序（不变量 2）：start ≤ end 恒成立；单 hunk 仅一对配对时
  // 两端点可折叠为同一条 modify 行（start === end），属合法区间。
  return { start, end }
}
