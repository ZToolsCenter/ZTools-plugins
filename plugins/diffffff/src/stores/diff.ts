/**
 * 对比结果状态 store（roadmap 任务 UI-004；UI-005 职责调整）。
 *
 * 组合式 reactive 单例（与 workbench.ts 同风格，刻意不引 Pinia）：持有
 * 「最近一次对比」的引擎结果与运行状态，作为「查找差异」主按钮 /
 * ⌘/Ctrl+Enter 快捷键 / 选项变化自动重跑（UI-005）多条触发路径的共同出口，
 * 结果视图（UI-006/007）、统计条（UI-010）与错误提示（UI-013）后续直接消费
 * 本 store。
 *
 * 职责边界（UI-005 定稿：选项输入归 viewStore，本 store 只管结果）：
 * - 本 store 只负责「触发 → 调引擎 → 存结果」的状态机，不做任何 UI 反馈：
 *   错误结果（ok:false）也原样存入 result（UI-013 消费展示），本层不 toast；
 * - 对比输入恒从 workbenchStore 取（leftText / rightText），本 store 不持有
 *   文本副本，避免双份状态漂移；
 * - 生效选项不再自持：run() 执行时从 viewStore.diffOptions 读取选项、从
 *   viewStore.contextLines 读取 hunk 上下文行数（唯一真源在 viewStore，
 *   由工具栏 / 设置弹窗写入）；lastOptions 保留为 run() 落下的「最近一次
 *   实际生效选项」快照（输出而非输入），供摘要展示与 INT-004 历史序列化
 *   消费，原有对外字段不删。
 */
import { nextTick, reactive } from 'vue'
import { compareFull } from '../core/diff'
import type { DiffOptions, DiffResult } from '../core/types'
import { workbenchStore } from './workbench'
import { viewStore } from './view'

/** 对外 store 形状：最近一次对比结果 + 运行状态 + 生效选项快照 */
export interface DiffStore {
  /**
   * 最近一次对比结果（DiffResult 判别联合，含 ok:false 错误通道）。
   * null = 尚未对比过（或已被 clear() / 空态短路清空）。
   */
  result: DiffResult | null
  /** 是否正在对比：主按钮禁用与「对比中…」文案的消费源。 */
  isRunning: boolean
  /**
   * 最近一次 run() 实际生效的选项快照（UI-005 起为输出：run() 从
   * viewStore.diffOptions 读取后深拷贝落下；UI-004 阶段为 DEFAULT_OPTIONS
   * 快照）。不再是选项输入 —— 修改对比选项请写 viewStore。
   */
  lastOptions: DiffOptions
  /** 执行一次对比（语义见 run 函数 JSDoc）。 */
  run: () => Promise<void>
  /** 清空对比结果（语义见 clear 函数 JSDoc）。 */
  clear: () => void
}

/**
 * 把选项对象深拷贝为独立快照（run() 写 lastOptions 用）：store 的 reactive
 * 代理会就地包装嵌套对象，若把 viewStore.diffOptions 的 reactive 规则数组
 * 直接引用进 lastOptions，后续对 viewStore.ignoreRules 的增删改会连带篡改
 * 「历史快照」；故浅拷贝一层、规则数组逐条拷贝。
 */
function snapshotOptions(options: DiffOptions): DiffOptions {
  return { ...options, ignoreRules: options.ignoreRules.map((rule) => ({ ...rule })) }
}

/**
 * 执行一次对比（三条触发路径共用：主按钮 / ⌘/Ctrl+Enter / 选项变化自动重跑
 * —— 最后一条为 UI-005 新增，接线在 App.vue 的 watch）。
 *
 * 行为约定：
 * - 重入守卫：isRunning 期间直接忽略后续调用 —— 当前实现里 compareFull
 *   是同步函数，await nextTick 后一口气算完，重入窗口极小，但键盘 /
 *   选项 watch 仍可能在窗口内触发，忽略即可（进行中的那次在
 *   nextTick 之后才读取 store 文本，天然拿到最新输入与选项）；
 * - 空态短路：两侧文本全空时不跑引擎，直接 clear() —— 保证不产生
 *   「空对比结果」（空态语义的完整呈现归 UI-013 完善，此处只兜底）；
 *   放在 run() 内而非按钮回调里，是为了让选项重跑路径享受同一守卫；
 * - 选项来源（UI-005）：执行时读取 viewStore.diffOptions（工具栏开关 +
 *   设置弹窗规则的组装结果）与 viewStore.contextLines，并把快照写入
 *   lastOptions —— 生效选项以「本次 run 的读取值」为准，与工具栏当前
 *   状态天然一致，不存在双份选项漂移。
 *
 * async 包裹的说明：compareFull 本身是同步函数，此处仍以 async 导出
 * （返回 Promise），一是先 await nextTick 让「对比中…」状态先上屏再进入
 * 会阻塞主线程的同步计算，二是未来切换分片异步的 compareIncremental
 * （ENG-011）时调用方契约（Promise 语义）不变，只换内部一行调用。
 *
 * 错误通道：compareFull 的契约内错误（too-large / invalid-regex / internal）
 * 以 ok:false 结果存入 result，不抛出；契约外异常（引擎约定原样上抛）经
 * finally 保证 isRunning 复位后继续上抛，不在 store 层吞掉。（UI-005 起
 * 非法启用规则已在 viewStore.diffOptions 编辑期拦截，invalid-regex 理论上
 * 不可达，错误通道保留兜底。）
 */
async function run(): Promise<void> {
  if (diffStore.isRunning) return

  // 空态短路：不产生空对比结果（语义见上方 JSDoc）。
  if (workbenchStore.leftText === '' && workbenchStore.rightText === '') {
    clear()
    return
  }

  diffStore.isRunning = true
  try {
    // 让出一轮渲染：isRunning=true 的 DOM 更新先落地，再进入同步计算。
    await nextTick()
    const options = viewStore.diffOptions
    diffStore.result = compareFull(
      workbenchStore.leftText,
      workbenchStore.rightText,
      options,
      viewStore.contextLines,
    )
    diffStore.lastOptions = snapshotOptions(options)
  } finally {
    diffStore.isRunning = false
  }
}

/**
 * 清空对比结果（result 置 null）：空态点击 / 未来「清空」入口共用。
 * 只清结果不动输入，也不触碰 isRunning（进行中的对比完成时照常写 result）。
 */
function clear(): void {
  diffStore.result = null
}

/**
 * 对比结果单例 store（模块级 reactive，与 workbench.ts 同风格）。
 * 各字段缺省值见 DiffStore 字段注释；lastOptions 初值为空选项快照，
 * 首次 run() 后被真实生效选项覆盖（UI-005 起选项输入归 viewStore）。
 */
export const diffStore: DiffStore = reactive({
  result: null,
  isRunning: false,
  lastOptions: snapshotOptions({
    ignoreWhitespace: false,
    ignoreCase: false,
    ignoreEmptyLines: false,
    ignoreRules: [],
  }),
  run,
  clear,
})
