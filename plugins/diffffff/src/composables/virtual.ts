/**
 * ============================================================================
 * 结果虚拟滚动（roadmap 任务 UI-009）：大 diff 只渲染可视行 —— 轻量自研实现
 * ============================================================================
 *
 * 背景与约束：两个结果视图（SplitDiffView / UnifiedDiffView）在 UI-008 之后
 * 仍全量渲染 displayItems / items —— 十万行级 diff（ENG-011 输入上限内）会
 * 产生十万级 DOM 行。本模块提供「等行高窗口切片」的最小虚拟滚动：滚动容器
 * 内只渲染 [start, end) 区间的渲染单元，上下各用一个 spacer 撑起等价高度，
 * DOM 行数 = 可视窗口行数 + 2*overscan，与总行数无关。任务约束不引入第三方
 * 虚拟滚动库（轻量自研），且纯函数部分（computeVisibleRange）可脱离 Vue
 * 单测（tests/ui/virtual.test.ts）。
 *
 * 渲染单元策略（任务给定两选项，采用 A）：
 * - A（采用）：一切渲染单元（diff 行 / 折叠条 / hunk 头条）统一按 rowHeight
 *   （20px，与 main.css 的 --diff-line-height 严格一致）编号计高。折叠条与
 *   hunk 头条的视觉高度本就设计为一行 —— main.css 已把它们调到与行高严格
 *   等高（折叠条 line-height = 行高 − 上下虚线边 2px；hunk 头 line-height =
 *   行高，无竖向 padding），因此「统一编号」在本视图是【精确模型】而非近似；
 *   配套的行高恒定保证见 main.css 的 .diff-content（内容格滚动条隐藏，
 *   经典滚动条 +8px 不再出现）注释。
 * - B（未采用）：非 20px 单元独占精确高度需要前缀和与逐项测量，复杂度不成
 *   比例 —— 仅当单元高度不可控（如富文本行）时才有必要。
 *
 * 换行模式直通（enabled=false 的决策）：
 * wrapLongLines=true 时行高不均（1~4 行不等，见 main.css 的 .is-wrap 与
 * longLine 截断），等行高模型失效；逐行测量（每行 ResizeObserver / 前缀和
 * 缓存失效）的复杂度与收益不成比例，且换行是「明读」场景 —— 大 diff +
 * 换行的组合已有 ENG-011 输入上限（5MB / 10 万行）与 longLine max-height
 * 截断兜底。因此换行模式关闭虚拟化：range 覆盖全量（直通模式），视图全量
 * 渲染、spacer 恒为 0，行为与 UI-008 时代完全一致。
 *
 * 展开折叠条的位置稳定性（简单策略，任务指定）：展开 / 收起改变
 * displayItems 长度 → itemCount watch 触发重算，scrollTop 保持不变，不做
 * 滚动位置锚定 —— 视口下方展开时可视位置稳定；视口上方展开时内容向下推移
 * （浏览器不回滚 scrollTop）。位置锚定（scrollTop 补偿）如体验需要，归
 * 后续打磨任务。
 * ============================================================================
 */
import { onScopeDispose, reactive, watch } from 'vue'
import type { Ref } from 'vue'

/**
 * 虚拟滚动计高常量：必须与 main.css 的 --diff-line-height（20px）严格一致。
 * CSS token 是行高的唯一事实来源，此常量是其虚拟计高镜像；两者分叉会导致
 * spacer 高度与真实行高漂移（可视位置逐渐错位）—— 修改任一侧必须同步。
 * 单测（tests/ui/virtual.test.ts）会对 main.css 做文本断言守住该一致性。
 */
export const DIFF_ROW_HEIGHT = 20

/** 可视区间与布局量（渲染单元下标空间为 0-based 闭开区间 [start, end)） */
export interface VirtualRange {
  /** 首个渲染单元下标（已含 overscan 前置缓冲，钳制到 [0, totalCount]） */
  start: number
  /** 渲染区间尾（不含；≤ totalCount，恒 ≥ start） */
  end: number
  /** 渲染区间之前的空白高度 = start * rowHeight（顶部 spacer 的高度） */
  offsetTop: number
  /** 全量内容高度 = totalCount * rowHeight（滚动内容总高，与滚动位置无关） */
  totalHeight: number
}

/**
 * 计算可视渲染区间（纯函数，可单测）。
 *
 * 任务给定公式：
 * - start = max(0, floor(scrollTop / rowHeight) - overscan)
 * - end   = min(totalCount, ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
 * - offsetTop = start * rowHeight；totalHeight = totalCount * rowHeight
 *
 * 边界行为：
 * - totalCount = 0 → 全零区间（空 diff 不渲染任何单元）；
 * - viewportHeight = 0 → end 只由 scrollTop 与 overscan 决定（渲染 overscan
 *   行作首帧缓冲，不产生负宽区间）；
 * - scrollTop 越过内容底部（程序化滚动 / 容器骤缩）→ start 钳到 totalCount，
 *   与 end 相等：空 slice + 满高顶部 spacer，布局量自洽；
 * - scrollTop 为负 / 非有限值（NaN 会经 Math.floor 扩散）→ 归 0 处理；
 * - rowHeight ≤ 0（契约违约，无法计高）→ 防御性退化为全量直通
 *   （start=0 / end=totalCount / totalHeight=0，spacer 归零、内容自然撑高）。
 *
 * @param scrollTop 滚动容器当前纵向偏移（px）
 * @param viewportHeight 滚动容器视口高（px，通常为 clientHeight）
 * @param rowHeight 单元等高（px，须 > 0）
 * @param totalCount 渲染单元总数
 * @param overscan 视口外上下各多渲染的单元数（默认 10，快速滚动的视觉缓冲）
 */
export function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalCount: number,
  overscan = 10,
): VirtualRange {
  // 防御：非有限输入归零（NaN 在 Math.floor / Math.max 下会扩散成 NaN 下标）。
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
  const viewport =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0
  const height = Number.isFinite(rowHeight) ? rowHeight : 0
  const total = Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : 0

  if (total === 0) {
    return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 }
  }
  if (height <= 0) {
    // 契约违约防御：见函数 JSDoc「rowHeight ≤ 0」分支。
    return { start: 0, end: total, offsetTop: 0, totalHeight: 0 }
  }

  // start 额外钳到 ≤ total：scrollTop 远超内容底部时不产生 start > end 的
  // 负宽区间（top 钳非负已保证 floor ≥ 0；end 公式值随 viewport ≥ 0 恒 ≥
  // start + overscan，故 start ≤ total 时恒有 end ≥ start）。
  const start = Math.min(total, Math.max(0, Math.floor(top / height) - overscan))
  const end = Math.min(
    total,
    Math.max(start, Math.ceil((top + viewport) / height) + overscan),
  )
  return {
    start,
    end,
    offsetTop: start * height,
    totalHeight: total * height,
  }
}

/** useVirtualRows 的可选配置 */
export interface VirtualRowsOptions {
  /** 视口外上下各多渲染的单元数（默认 10，透传给 computeVisibleRange） */
  overscan?: number
  /**
   * 虚拟化开关（getter，响应式读取）：返回 false 时进入直通模式 —— range
   * 覆盖全量（start=0 / end=itemCount() / offsetTop=0），视图全量渲染、
   * spacer 恒为 0。两视图用它承载「换行模式关闭虚拟化」决策（理由见文件头）。
   */
  enabled?: () => boolean
}

/** useVirtualRows 的返回形状 */
export interface VirtualRowsState {
  /** 当前可视区间（reactive；模板 / computed 直消费） */
  range: VirtualRange
  /**
   * 手动同步入口：rAF 合帧后按容器当前 scrollTop / clientHeight 重算 range。
   * 供「改变了滚动几何但可能不触发 scroll 事件」的场景调用（如程序化滚动
   * 到原位、外部布局骤变后立即取值）；与内部 scroll / ResizeObserver 监听
   * 共用同一条 rAF 去重通路，重复调用幂等。
   */
  onScrollNatural: () => void
}

/**
 * 结果视图虚拟滚动的容器接线（UI-009 主入口）。
 *
 * 监听职责：
 * - 容器 scroll（passive）：滚动 → rAF 合帧重算 range（同帧多次 scroll 合并
 *   为一次 reactive 写入，每帧至多一次视图重渲染）；
 * - 容器 ResizeObserver：视口尺寸变化（窗口缩放 / 布局折叠）→ 可视行数变化
 *   → 重算；实例销毁（onScopeDispose）时断开并注销全部监听；
 * - itemCount 变化（展开折叠条 / diff 重跑等改变渲染单元数）：watch 触发
   * 【同步】重算（pre-flush，先于重渲染）——低频事件不走 rAF，避免切换帧内
 *   出现「新长度 × 旧 range」的瞬间错位；
 * - enabled 切换（如换行开关）：直通 ↔ 虚拟模型切换，同步重算。
 *
 * 初始 range：容器挂载（watch flush 'post'，模板 ref 就绪后）即同步重算一次，
 * 首个渲染周期内 range 即反映真实滚动几何。
 *
 * @param containerRef 滚动容器模板 ref（两视图的根节点 .split-view / .unified-view）
 * @param itemCount 渲染单元总数 getter（响应式读取，随 displayItems 动态变化）
 * @param rowHeight 单元等高（px；两视图传 DIFF_ROW_HEIGHT，与 CSS token 一致）
 * @param opts 见 VirtualRowsOptions（overscan 默认 10；enabled 缺省恒虚拟化）
 * @returns 见 VirtualRowsState
 */
export function useVirtualRows(
  containerRef: Ref<HTMLElement | null>,
  itemCount: () => number,
  rowHeight: number,
  opts: VirtualRowsOptions = {},
): VirtualRowsState {
  const overscan = opts.overscan ?? 10

  /** 当前可视区间（reactive，字段整体覆写式更新，模板依赖跟踪不受影响） */
  const range = reactive<VirtualRange>({ start: 0, end: 0, offsetTop: 0, totalHeight: 0 })

  /** 按容器当前几何 + itemCount + enabled 重算 range（同步覆写） */
  function recompute(): void {
    const el = containerRef.value
    const total = itemCount()
    if (opts.enabled !== undefined && !opts.enabled()) {
      // 直通模式（enabled=false，如换行模式）：range 覆盖全量 —— 视图 slice
      // 取到全部单元；top spacer = 0，bottom spacer = totalHeight − 全量行高
      // = 0，布局回到自然流（与未虚拟化时代逐像素一致）。
      range.start = 0
      range.end = total
      range.offsetTop = 0
      range.totalHeight = total * rowHeight
      return
    }
    const next = computeVisibleRange(
      el?.scrollTop ?? 0,
      el?.clientHeight ?? 0,
      rowHeight,
      total,
      overscan,
    )
    range.start = next.start
    range.end = next.end
    range.offsetTop = next.offsetTop
    range.totalHeight = next.totalHeight
  }

  /*
   * rAF 合帧：scroll / resize 高频触发，同一帧内的多次触发合并为一次重算
   * （去重后每帧至多一次 reactive 写入）。rafId !== null 即表示已有 pending
   * 帧，直接短路。
   */
  let rafId: number | null = null
  function schedule(): void {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      recompute()
    })
  }

  /** 手动同步入口（语义见 VirtualRowsState.onScrollNatural） */
  function onScrollNatural(): void {
    schedule()
  }

  /** ResizeObserver 实例（容器切换 / 销毁时整体断开重建） */
  let observer: ResizeObserver | null = null

  /** 解绑某容器的 scroll 监听（容器切换 / 作用域销毁共用） */
  function detach(el: HTMLElement): void {
    el.removeEventListener('scroll', onScrollNatural)
  }

  /**
   * 绑定容器：scroll（passive —— 处理器只读不写布局，不阻塞滚动合成）+
   * ResizeObserver（视口尺寸变化）。绑定即同步重算一次，保证首个响应式
   * 渲染周期后 range 就反映真实滚动几何。
   */
  function attach(el: HTMLElement): void {
    el.addEventListener('scroll', onScrollNatural, { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => schedule())
      observer.observe(el)
    }
    recompute()
  }

  // 容器挂载 / 替换：flush 'post' 保证模板 ref 已写入（首个渲染完成后绑定）。
  watch(
    containerRef,
    (el, prev) => {
      // immediate 首帧回调 prev 为 undefined（非 null），须按空值一并判空。
      if (prev != null) detach(prev)
      observer?.disconnect()
      observer = null
      if (el !== null) attach(el)
    },
    { immediate: true, flush: 'post' },
  )

  // itemCount 变化（展开折叠条 / diff 重跑改变渲染单元数）→ 同步重算：
  // pre-flush 先于重渲染执行，重渲染看到的就是「新长度 × 新 range」。
  // 注意不做滚动位置锚定（简单策略，见文件头「展开折叠条的位置稳定性」）。
  watch(itemCount, () => {
    recompute()
  })

  // enabled 切换（如换行开关）：直通 ↔ 虚拟两套计高模型切换，同步重算。
  if (opts.enabled !== undefined) {
    watch(opts.enabled, () => {
      recompute()
    })
  }

  // 作用域销毁：取消挂起的 rAF 帧、注销 scroll 监听、断开 ResizeObserver。
  onScopeDispose(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    const el = containerRef.value
    if (el != null) detach(el)
    observer?.disconnect()
    observer = null
  })

  return { range, onScrollNatural }
}
