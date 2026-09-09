/**
 * ============================================================================
 * 折叠未更改行（roadmap 任务 UI-008）：并排 / 统一视图共享的折叠状态 composable
 * ============================================================================
 *
 * 把引擎（ENG-008 `buildHunks`）产出的 `CollapseRange[]` 投影为「折叠条 +
 * 显示行」的交错序列，供 SplitDiffView（并排）与 UnifiedDiffView（统一）共用
 * 同一份折叠语义（序列形状、展开态生命周期、下标约定只有一份实现）。核心
 * 约定（与 `core/types.ts` 的 `CollapseRange` 契约对齐）：
 *
 * - rows 恒为完整展开序列：被折叠的行仍留在入参 rows 中，折叠只是投影视图；
 *   区段为 `rows[beforeRow - count, beforeRow)`（0-based 闭开区间），折叠条
 *   渲染在 `rows[beforeRow]` 之前；
 * - displayItems：enabled=false 或无 collapses 时全为 row 项（即 UI-006/007
 *   的全量渲染行为，折叠条不出现）；每个「未展开」的折叠区段产出一条
 *   collapsed 项（渲染「⋯ 展开未更改的 N 行」条带），区段内的行被剔除；
 *   点击展开后该区段的行原样回到序列中、折叠条消失；
 * - beforeRow 都基于原始 rows 下标：展开某个区段只影响自己的区段，后续
 *   collapsed 项的位置与内容不受影响（剔除按 beforeRow key 判断，不做下标
 *   平移），因此 expandedKeys 以 beforeRow 为稳定标识；
 *
 * 重要前置条件（调用方责任）：rows 与 collapses 必须处于【同一下标空间】。
 * 统一视图直接消费 result.rows / result.collapses（天然一致）；并排视图的
 * 渲染序列经 `rowsWithPairing` 合并（配对的 del+add 合并为一条 modify 行，
 * 序列变短），必须先在组件侧把 collapses 翻译到配对序列的下标空间再传入
 * （翻译依据与实现见 SplitDiffView 的 pairedCollapses computed）。
 *
 * 展开态的生命周期（纯 UI 态）：expandedKeys 是组件内 ref，不进 store、不
 * 持久化 —— diff 重跑 / 输入变化后旧下标失去意义，watch rows / collapses 的
 * 【引用变化】即整体重置为空集。两视图传入的 rows / collapses 都是 computed
 * 产物：result 变化 → 重算出新数组引用 → 触发重置；不改变下标空间的派生
 * （如并排视图的字符级重投影只替换行内 spans、序列不变）不经过这两个源，
 * 不会误触发。折叠开关（showCollapsed）切换刻意不重置：off→on 时恢复用户
 * 此前的展开探索状态。
 *
 * 性能注记：displayItems 为 O(rows.length) 的单趟扫描，每次展开 / 折叠操作
 * 触发一次重算 —— 大 diff 的渲染量治理归 UI-009 虚拟滚动，本层不缓存增量。
 * ============================================================================
 */
import { computed, ref, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import type { CollapseRange, DiffRow } from '../core/types'

/**
 * 渲染序列条目：显示行与折叠条的交错列表（模板直消费）。
 *
 * - `row`：未折叠的显示行，`index` 为其在入参 rows 中的原始下标（调用方
 *   据此对齐自己的视图模型数组，v-for key 也由它派生）；
 * - `collapsed`：折叠条，渲染在 `rows[beforeRow]` 之前，`count` 为被折叠的
 *   未更改行数（已按 rows 边界钳制）。
 */
export type CollapseDisplayItem =
  | { kind: 'row'; row: DiffRow; index: number }
  | { kind: 'collapsed'; beforeRow: number; count: number }

/** useCollapse 的返回形状（语义见各字段 / 函数的 JSDoc） */
export interface CollapseState {
  /** 折叠感知的渲染序列（computed，随入参与展开态自动重算） */
  displayItems: ComputedRef<CollapseDisplayItem[]>
  /**
   * 已展开区段的 beforeRow 集合（纯 UI 态 ref）。整体替换式更新（expand /
   * expandAll / 重置都换新 Set，从不原地改写），消费方可安全快照引用。
   */
  expandedKeys: Ref<Set<number>>
  /** 展开单个区段（折叠条点击，幂等） */
  expand: (beforeRow: number) => void
  /** 全部展开（「全部展开」按钮；幂等） */
  expandAll: () => void
  /**
   * 全部收起（「全部展开/收起」双态按钮的收起侧）：清空展开集合，回到
   * 「只显示折叠条」的默认折叠形态；无折叠时幂等 no-op。
   */
  collapseAll: () => void
  /**
   * 当前是否存在折叠区段（与展开态无关，computed）：双态按钮的禁用依据 ——
   * 无折叠时「展开 / 收起」都无事可做；isAnyCollapsed 只表达「未展开的
   * 折叠条是否还有剩余」，全展开后为 false 但仍可收起，不能当禁用条件。
   */
  hasCollapses: ComputedRef<boolean>
  /** 是否存在未展开的折叠条（「全部展开」按钮的显隐条件，computed） */
  isAnyCollapsed: ComputedRef<boolean>
}

/**
 * 折叠未更改行的共享视图逻辑（UI-008 主入口）。
 *
 * @param rows 完整展开的差异行序列（与 collapses 同一下标空间；接受 ref /
 *             computed / getter / 裸数组）
 * @param collapses 折叠区段列表（引擎按 beforeRow 升序产出；接受 ref /
 *                  computed / getter / 裸数组）
 * @param enabled 折叠开关（viewStore.showCollapsed；false 时全量渲染，
 *                折叠条不出现、expand / expandAll 不产生可见效果）
 * @returns 见 `CollapseState`
 */
export function useCollapse(
  rows: MaybeRefOrGetter<DiffRow[]>,
  collapses: MaybeRefOrGetter<CollapseRange[]>,
  enabled: MaybeRefOrGetter<boolean>,
): CollapseState {
  /**
   * 已展开区段的 beforeRow 集合（纯 UI 态，重置时机见文件头「展开态的生命
   * 周期」）。更新策略为整体替换新 Set：ref 写入天然触发响应，也避免依赖
   * Vue 对 Set 的深层代理行为。
   */
  const expandedKeys = ref(new Set<number>())

  // 重置时机：rows / collapses 任一引用变化（diff 重跑、输入变化、结果切换）
  // → 旧展开态整体作废。watch 逐源做引用比较（Object.is），computed 缓存未
  // 失效时不触发；watch 不加 immediate —— 初次挂载本就是空集，无需重置。
  watch([() => toValue(rows), () => toValue(collapses)], () => {
    expandedKeys.value = new Set<number>()
  })

  /**
   * 折叠感知的渲染序列（语义见文件头）。
   *
   * 实现：先按「未展开」的区段标记被隐藏的行（`rows[beforeRow - count,
   * beforeRow)`，边界按 rows 长度钳制，越界 / 空区段防御性跳过），再单趟
   * 扫描 rows 产出交错序列 —— 折叠条按 beforeRow 升序插在命中下标的行前
   * （契约已升序，排序为防御性兜底）。全展开 / 无折叠时退化为全量 row 项。
   */
  const displayItems = computed<CollapseDisplayItem[]>(() => {
    const list = toValue(rows)
    const ranges = toValue(collapses)
    if (!toValue(enabled) || ranges.length === 0) {
      return list.map((row, index) => ({ kind: 'row' as const, row, index }))
    }

    const hidden = new Uint8Array(list.length)
    const bars: CollapseRange[] = []
    for (const range of ranges) {
      // 已展开的区段：行保留在序列中，不产出折叠条。
      if (expandedKeys.value.has(range.beforeRow)) continue
      const start = Math.max(0, range.beforeRow - range.count)
      const end = Math.min(list.length, range.beforeRow)
      if (end <= start) continue // 空区段（契约保证 count > 0）防御性跳过
      bars.push({ beforeRow: range.beforeRow, count: end - start })
      for (let i = start; i < end; i += 1) hidden[i] = 1
    }
    if (bars.length === 0) {
      return list.map((row, index) => ({ kind: 'row' as const, row, index }))
    }

    bars.sort((a, b) => a.beforeRow - b.beforeRow)
    const out: CollapseDisplayItem[] = []
    let barIndex = 0
    for (let i = 0; i < list.length; i += 1) {
      while (barIndex < bars.length && bars[barIndex].beforeRow === i) {
        const bar = bars[barIndex]
        out.push({ kind: 'collapsed', beforeRow: bar.beforeRow, count: bar.count })
        barIndex += 1
      }
      if (hidden[i] === 0) out.push({ kind: 'row', row: list[i], index: i })
    }
    // 越界兜底：beforeRow ≥ rows.length 的陈旧折叠条（契约上不可达）追加
    // 到序列尾部，保证「有折叠条」与「isAnyCollapsed」的判断始终一致。
    while (barIndex < bars.length) {
      const bar = bars[barIndex]
      out.push({ kind: 'collapsed', beforeRow: bar.beforeRow, count: bar.count })
      barIndex += 1
    }
    return out
  })

  /**
   * 展开单个区段（折叠条点击）：把 beforeRow 计入已展开集合，该区段的行
   * 回到 displayItems、折叠条消失。重复展开（幂等）与「全部展开后再点
   * 单条」都直接短路，不产生无意义的 Set 重建。
   */
  function expand(beforeRow: number): void {
    if (expandedKeys.value.has(beforeRow)) return
    const next = new Set(expandedKeys.value)
    next.add(beforeRow)
    expandedKeys.value = next
  }

  /**
   * 全部展开（「全部展开」按钮）：把当前 collapses 的全部 beforeRow 计入
   * 已展开集合 —— displayItems 退化为全量 row 项，isAnyCollapsed 随之转
   * false、按钮自行隐藏。以「点击时刻的 collapses」为准；此后的新结果经
   * 重置 watch 归零，不残留旧 key。
   */
  function expandAll(): void {
    expandedKeys.value = new Set(toValue(collapses).map((range) => range.beforeRow))
  }

  /**
   * 全部收起（双态按钮的收起侧）：清空已展开集合 —— displayItems 恢复为
   * 「折叠条 + 未折叠行」的默认形态，isAnyCollapsed 随之回 true。此前的
   * 单条展开探索整体作废（与 expandAll 的「以点击时刻 collapses 为准」
   * 对偶）；无折叠（collapses 为空）时是幂等 no-op。
   */
  function collapseAll(): void {
    expandedKeys.value = new Set<number>()
  }

  /**
   * 是否存在未展开的折叠条：直接从 displayItems 判定（而非对比集合大小），
   * 保证与「实际渲染出的折叠条」严格一致 —— 空区段 / 越界折叠条被防御性
   * 剔除时不会出现「按钮显示却无事可做」的错位。
   */
  const isAnyCollapsed = computed(() =>
    displayItems.value.some((item) => item.kind === 'collapsed'),
  )

  /**
   * 是否存在折叠区段（computed）：折叠开关关闭时折叠条不渲染（视图是
   * 全量展开形态，「展开 / 收起」都无事可做），与入参 collapses 的「实际
   * 有效区段」一并判定（走与 displayItems 相同的边界钳制，空区段 / 越界
   * 折叠条不算数）。双态按钮的禁用依据 —— 有折叠时按钮恒可用，只在
   * 「全部展开 / 全部收起」两侧切换文案。
   */
  const hasCollapses = computed(() => {
    if (!toValue(enabled)) return false
    const list = toValue(rows)
    return toValue(collapses).some((range) => {
      const start = Math.max(0, range.beforeRow - range.count)
      const end = Math.min(list.length, range.beforeRow)
      return end > start
    })
  })

  return {
    displayItems,
    expandedKeys,
    expand,
    expandAll,
    collapseAll,
    hasCollapses,
    isAnyCollapsed,
  }
}
