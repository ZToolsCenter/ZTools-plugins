/**
 * 视图与对比选项 store（roadmap 任务 UI-005）。
 *
 * 组合式 reactive 单例（与 workbench.ts / diff.ts 同风格，刻意不引 Pinia）：
 * 持有「工具栏与设置弹窗」的全部视图状态与对比选项，是以下字段的唯一真源
 * （single source of truth）：
 * - 结果视图形态：viewMode（并排/统一）、showCollapsed（折叠未变更）、
 *   wrapLongLines（换行）—— 只影响渲染，由 UI-006/007/008 消费；
 * - 引擎输入：precision（精度）、ignoreWhitespace / ignoreCase /
 *   ignoreEmptyLines（ENG-006 开关）、ignoreRules（ENG-007 自定义忽略规则）、
 *   contextLines（ENG-008 hunk 上下文行数）—— 经 `diffOptions` computed 组装
 *   成 `DiffOptions` 供 diffStore.run() 使用（diffStore 不再自持选项输入，
 *   见 stores/diff.ts 的职责调整说明）；
 * - 语言选择：language（高亮归 INT-001，本任务只存状态与下拉候选）。
 *
 * 与 diff.ts 的职责边界（UI-005 定稿）：
 * - 本 store 持有「选项输入」，diffStore 持有「结果与运行状态机」；
 * - diffStore.run() 在执行时读取 `viewStore.diffOptions` 与 `viewStore.contextLines`，
 *   并把实际生效的选项快照写入 diffStore.lastOptions（输出而非输入，见 diff.ts）；
 * - 「选项变化 → 自动重跑」的触发策略（有结果立即重跑、无结果等显式触发）
 *   归触发层，接线在 App.vue 的 watch 中（与快捷键同处一地）。
 *
 * 规则校验：`getRuleError` / `enabledRulesValid` 复用引擎层
 * `compileIgnoreRules`（src/core/ignoreRules.ts）做编辑期校验 —— 非法的启用
 * 规则不进入 `diffOptions`（引擎永不见到它，运行时不会再产生 invalid-regex），
 * 由设置弹窗的标红与提示承担用户告知；disabled 规则引擎本就跳过（编译时
 * continue），无需拦截。
 */
import { computed, reactive, watch } from 'vue'
import { detectLanguagePair } from '../core/langdetect'
import { compileIgnoreRules } from '../core/ignoreRules'
import type { DiffOptions, DiffPrecision, IgnoreRule } from '../core/types'
import { workbenchStore } from './workbench'

/** 结果视图模式：并排（split，默认）/ 统一（unified） */
export type ViewMode = 'split' | 'unified'

/**
 * 行号列宽映射（UI-015「宽随位数自适应」的纯函数出口）。
 *
 * 依据结果总行数（diffStore.result.stats.totalRows，调用方传入）的十进制位数
 * 决定行号列宽（px）—— 两视图（并排 / 统一）的行号列与记号列 sticky 偏移都
 * 消费同一映射结果（App.vue 计算后以 `--gutter-w` 注入 .result-stage，两视图
 * 的 grid 模板经局部变量 `--split-gutter-w` / `--uni-gutter-w` 引用同一来源）：
 * - ≤3 位（≤999 行）→ 40px（窄窗小 diff 不浪费横向空间）；
 * - 4–5 位（1000–99999 行）→ 52px（与 UI-006 时代固定列宽持平）；
 * - ≥6 位（≥10 万行，ENG-011 输入上限）→ 64px（6 位数字 + 左右 padding）。
 *
 * 防御：非有限 / 非正数输入按 1 位处理（返回最小档 40px）—— 结果缺失
 * （result 为 null / ok:false）时调用方传 0，列宽落最小档，不产生 NaN 宽度。
 *
 * @param totalRows 结果总行数（result.stats.totalRows；未知 / 无结果传 0）
 * @returns 行号列宽（px 数值，调用方拼 `px` 单位注入 CSS 变量）
 */
export function diffGutterWidthPx(totalRows: number): number {
  const rows =
    Number.isFinite(totalRows) && totalRows > 0 ? Math.floor(totalRows) : 1
  const digits = String(rows).length
  if (digits <= 3) return 40
  if (digits <= 5) return 52
  return 64
}

/** 精度分段候选（value 与 `DiffPrecision` 一一对应，顺序即分段展示顺序） */
export const PRECISION_OPTIONS: { label: string; value: DiffPrecision }[] = [
  { label: '智能', value: 'smart' },
  { label: '行级', value: 'line' },
  { label: '单词', value: 'word' },
  { label: '字符', value: 'char' },
]

/**
 * 语言下拉候选（UI-005）：`'auto'`（自动检测）恒为第一项；其余为手动指定语言。
 * 语法高亮归 INT-001，本任务只存状态与下拉 —— 选中值当前不影响引擎与渲染。
 */
export const LANGUAGE_OPTIONS: { label: string; value: string }[] = [
  { label: '自动检测', value: 'auto' },
  { label: '纯文本', value: 'plaintext' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'Python', value: 'python' },
  { label: 'Java', value: 'java' },
  { label: 'Go', value: 'go' },
  { label: 'SQL', value: 'sql' },
  { label: 'JSON', value: 'json' },
  { label: 'YAML', value: 'yaml' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'XML', value: 'xml' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'C/C++', value: 'cpp' },
]

/** hunk 上下文行数的取值范围（设置弹窗数字输入的钳制区间，默认 3） */
export const CONTEXT_LINES_MIN = 0
export const CONTEXT_LINES_MAX = 10
export const DEFAULT_CONTEXT_LINES = 3

/** 新增忽略规则的默认 flags：与 ENG-007 语义一致（全局匹配） */
const DEFAULT_RULE_FLAGS = 'g'

/** 规则 id 生成序号：配合时间戳保证同毫秒内多次新增也不撞 id */
let ruleIdSeq = 0

/**
 * 生成规则稳定唯一 id（作为 UI 规则列表的 key 与删除定位，不依赖数组下标）。
 */
function createRuleId(): string {
  ruleIdSeq += 1
  return `rule-${Date.now().toString(36)}-${ruleIdSeq.toString(36)}`
}

/** 对外 store 形状：视图状态 + 对比选项 + 规则管理动作 + 派生选项 */
export interface ViewStore {
  /** 结果视图模式：'split' 并排（默认）/ 'unified' 统一（UI-006/007 消费） */
  viewMode: ViewMode
  /**
   * 容器是否处于窄窗（UI-015 小窗口降级）：App.vue 以 ResizeObserver 观察
   * 工作台容器宽度、低于降级阈值时写入 true（唯一写入方，本 store 只存状态）。
   */
  narrowWindow: boolean
  /**
   * 窄窗episode内用户坚持使用并排（UI-015）：窄窗下用户在分段控件主动点回
   * 「并排」时置 true —— 本episode内不再自动降级（尊重用户选择），并在
   * 结果视图顶部显示「建议使用统一视图」轻提示；窗口退出窄窗时自动复位。
   */
  keepSplitInNarrow: boolean
  /**
   * 是否处于「自动降级为统一视图」状态（UI-015 内部标志，只读派生）：
   * narrowWindow 且用户未坚持并排时为 true —— App.vue 据此渲染统一视图
   * （viewMode 本身不被改写，窗口变宽后自动回到用户原选视图）。
   */
  readonly autoUnified: boolean
  /**
   * 实际生效的结果视图模式（UI-015 只读派生）：autoUnified 时恒为
   * 'unified'，否则等于用户选择的 viewMode。结果视图渲染与工具栏分段
   * 控件的回显都消费本值（控件如实反映「当前看到的视图」）。
   */
  readonly effectiveViewMode: ViewMode
  /** 对比精度（默认 'smart'；当前 run() 走智能链路，精度重投影归 ENG-004/UI-006） */
  precision: DiffPrecision
  /** 语言选择（默认 'auto' 自动检测；INT-001 起被高亮渲染消费） */
  language: string
  /**
   * 实际生效的语言（INT-001 只读派生）：language 非 'auto' 时等于所选语言；
   * 'auto' 时为 detectLanguagePair 的检测结果（'plaintext' 兜底）。结果
   * 视图的语法 spans 渲染与 InputEditor 的语言 compartment 都消费本值。
   */
  readonly effectiveLanguage: string
  /** 折叠未变更行（默认 true；只影响渲染，UI-008 消费，不接引擎） */
  showCollapsed: boolean
  /** 超长行换行（默认 false；只影响渲染，UI-006/007 消费，不接引擎） */
  wrapLongLines: boolean
  /** unified hunk 上下文行数（默认 3，范围 [0, 10]；UI-005 起唯一真源在本 store） */
  contextLines: number
  /** 忽略空白差异（ENG-006，默认 false） */
  ignoreWhitespace: boolean
  /** 忽略大小写（ENG-006，默认 false） */
  ignoreCase: boolean
  /** 忽略空行变化（ENG-006 可选项，默认 false；工具栏暂不露出，仅设置态可扩展） */
  ignoreEmptyLines: boolean
  /** 自定义忽略规则列表（ENG-007，默认空；设置弹窗管理） */
  ignoreRules: IgnoreRule[]
  /** 引擎输入选项（由当前开关/规则组装，非法启用规则被拦截，见下） */
  readonly diffOptions: DiffOptions
  /** 启用中的规则是否全部通过校验（false = 存在启用且非法的规则） */
  readonly enabledRulesValid: boolean
  /** 新增一条空规则（enabled，flags 'g'；空 pattern 在编辑期被标记为非法） */
  addIgnoreRule: () => void
  /** 按 id 删除一条规则（未命中时静默忽略） */
  removeIgnoreRule: (id: string) => void
  /** 单条规则的编辑期校验：返回错误文案；null = 通过（语义见 getRuleError JSDoc） */
  getRuleError: (rule: IgnoreRule) => string | null
}

/**
 * 单条忽略规则的编辑期校验（设置弹窗实时标红 + diffOptions 拦截共用）。
 *
 * 校验语义与引擎 `compileIgnoreRules` 完全对齐（保证「编辑期判合法」⇔
 * 「运行期可编译」，不会出现编辑期放行、运行期 invalid-regex 的裂缝）：
 * - pattern 为空串 / 纯空白 → '规则内容为空'：`new RegExp('')` 虽合法，但空规则
 *   会匹配并删除整行全部内容，属于典型误操作，编辑期即拦截；
 * - flags / pattern 组合按引擎同款归一化（缺省补 'g'）试编译失败 →
 *   '正则非法，无法编译'；
 * - 校验与 enabled 无关（编译时临时置 enabled）：禁用规则同样标红，让用户
 *   在启用前就能看到问题；disabled 规则不进 diffOptions，不影响运行。
 *
 * @returns null = 校验通过；否则为人类可读错误文案（供弹窗逐条展示）
 */
function getRuleError(rule: IgnoreRule): string | null {
  if (typeof rule.pattern !== 'string' || rule.pattern.trim() === '') {
    return '规则内容为空'
  }
  const compiled = compileIgnoreRules([{ ...rule, enabled: true }])
  return compiled.ok ? null : '正则非法，无法编译'
}

/**
 * 把「非法的启用规则」拦截在引擎输入之外（UI-005 决策：编辑期拦截优于
 * 运行期报错）：
 * - 引擎契约里非法规则会让 compareFull 返回 invalid-regex（把一次好结果顶成
 *   错误态）；本 computed 只放行「enabled 且校验通过」的规则，非法规则等同
 *   未启用 —— 引擎侧不再可能出现规则导致的失败；
 * - 拦截的连带收益（自动重跑 watch，接线在 App.vue）：编辑非法正则的过程中
 *   被拦截规则不改变本 computed 的内容，不会反复触发无意义重跑；pattern 补
 *   完成合法的那一刻重新入选，重跑自然发生；
 * - disabled 规则不进入数组：引擎 compileIgnoreRules 对 disabled 本就跳过，
 *   不传等价；optionsKey（缓存键）也只统计启用规则，行为一致。
 */
const diffOptions = computed<DiffOptions>(() => ({
  ignoreWhitespace: viewStore.ignoreWhitespace,
  ignoreCase: viewStore.ignoreCase,
  ignoreEmptyLines: viewStore.ignoreEmptyLines,
  ignoreRules: viewStore.ignoreRules.filter((rule) => rule.enabled && getRuleError(rule) === null),
}))

/**
 * 启用中的规则是否全部合法：自动重跑的护栏（存在启用且非法的规则时跳过重跑，
 * 详见 App.vue watch 注释），也是设置弹窗顶部提示条的显示条件。
 */
const enabledRulesValid = computed(
  () => !viewStore.ignoreRules.some((rule) => rule.enabled && getRuleError(rule) !== null),
)

/*
 * 生效语言（INT-001）：语言是「本次对比」一个值，两结果视图与两侧编辑器
 * 共用。language = 'auto' 时按检测优先级链（文件名扩展名左右各查、内容
 * 启发式左右各查、合并采样兜底）得到检测结果；手动指定语言（非 auto）
 * 原样透传 —— 'plaintext' 即显式关闭语法高亮，其余语言直接命中语言包。
 * computed 缓存：依赖（language / 两侧文件名与文本）不变时不重复检测。
 */
const effectiveLanguage = computed<string>(() => {
  if (viewStore.language !== 'auto') return viewStore.language
  return detectLanguagePair(
    workbenchStore.leftFileName,
    workbenchStore.rightFileName,
    workbenchStore.leftText,
    workbenchStore.rightText,
  )
})

/*
 * 小窗口降级派生态（UI-015）：autoUnified 是「自动降级为统一视图」的内部
 * 标志（narrowWindow 且用户未坚持并排）；effectiveViewMode 是结果视图的
 * 实际渲染模式 —— 降级时接管为 'unified'，但【不改写 viewMode】，窗口变宽
 * 后自动回到用户原选视图（用户选择与自动降级因此可区分：keepSplitInNarrow
 * 记录窄窗内用户的主动坚持，复位时机见下方 watch）。
 */
const autoUnified = computed(() => viewStore.narrowWindow && !viewStore.keepSplitInNarrow)

const effectiveViewMode = computed<ViewMode>(() =>
  autoUnified.value ? 'unified' : viewStore.viewMode,
)

/** 新增一条空规则（语义见 addIgnoreRule JSDoc）：enabled + flags 'g' + 空 pattern */
function addIgnoreRule(): void {
  viewStore.ignoreRules.push({
    id: createRuleId(),
    pattern: '',
    flags: DEFAULT_RULE_FLAGS,
    enabled: true,
  })
}

/** 按 id 删除规则（未命中静默忽略，语义见 removeIgnoreRule JSDoc） */
function removeIgnoreRule(id: string): void {
  const index = viewStore.ignoreRules.findIndex((rule) => rule.id === id)
  if (index !== -1) {
    viewStore.ignoreRules.splice(index, 1)
  }
}

/**
 * 视图与选项单例 store（模块级 reactive，与 workbench.ts / diff.ts 同风格）。
 * 各字段缺省值见 ViewStore 字段注释。
 */
export const viewStore: ViewStore = reactive({
  viewMode: 'split',
  narrowWindow: false,
  keepSplitInNarrow: false,
  precision: 'smart',
  language: 'auto',
  showCollapsed: true,
  wrapLongLines: false,
  contextLines: DEFAULT_CONTEXT_LINES,
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreEmptyLines: false,
  ignoreRules: [],
  // computed 并入 reactive 单例：访问时自动解包（viewStore.diffOptions 直接是
  // DiffOptions 值），依赖跟踪与响应性不受影响。
  diffOptions,
  enabledRulesValid,
  effectiveLanguage,
  autoUnified,
  effectiveViewMode,
  addIgnoreRule,
  removeIgnoreRule,
  getRuleError,
})

// 窗口退出窄窗时复位「窄窗内坚持并排」（UI-015，置于单例声明之后 —— watch
// 的 getter 立即求值，前置会踩 TDZ）：宽窗下用户的 split 选择本就生效，该
// 标志只表达「本episode内别再自动降级」，跨episode不延续（再次变窄时重新
// 自动降级一次，用户可再次坚持）。flush: 'sync' —— narrowWindow 是低频写入
// （仅容器跨越降级阈值时变化），同步复位保证「退出窄窗 ⇒ 坚持标志必然已清」
// 的不变量即时成立，派生它的提示条文案 / 降级判定不读到跨帧的旧值。
watch(
  () => viewStore.narrowWindow,
  (narrow) => {
    if (!narrow) viewStore.keepSplitInNarrow = false
  },
  { flush: 'sync' },
)
