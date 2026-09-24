/**
 * ============================================================================
 * 智能精度策略与缓存会话（roadmap 任务 ENG-004；选项正交组合 ENG-006）
 * ============================================================================
 *
 * 在 ENG-001 行级骨架、ENG-002 tokenizer、ENG-003 词级 / 字符级行内 diff 之上
 * 实现 `'smart'` 精度（UI-005 精度下拉的默认档）、精度切换缓存层与「精度 ×
 * 对比选项」的正交组合（ENG-006）：
 *
 * 1. 智能精度策略（`diffSmartPrecision`）：
 *    - 行级骨架存在非 equal 行（真正的增 / 删 / 替换）→ 行级骨架 + 变化区域
 *      行内词级高亮（输出与词级投影完全一致）；
 *    - 骨架中存在 `'equal'` 但 `left.text !== right.text` 的行（规范化等价、
 *      原文不同 —— 开启 ENG-006 忽略选项后的「整行等价但词不同」形态）→
 *      为这些等价行补填词级 spans，把原文残差定位到词（降级路径正式生效，
 *      见 `smartFromSkeleton` JSDoc）；
 *    - `left === right` → 直接返回全 equal 骨架，不做词级尝试。
 *
 * 2. 选项正交（ENG-006）：所有精度共享同一组 `DiffOptions` —— 行级骨架由
 *    `compareWithOptions`（ENG-006）产出，word / char / smart 的行内投影经
 *    `applyInlineSpans` / `computeSpans` 透传同一份选项；四个精度出口
 *    （`getDiffRows`）都接受 `options` 并正确传递。缺省
 *    `DEFAULT_OPTIONS`（三开关全关）下与 ENG-001/003/004 的严格比较行为
 *    完全一致（向后兼容）。
 *
 * 3. 缓存会话（`createDiffSession` / `defaultSession`）：以
 *    `left + '\u0000' + right + '\u0000' + optionsKey(options)`（NUL 分隔防
 *    拼接歧义，选项键见 `./options.ts`）为 key 缓存同一「输入 + 选项」的
 *    四种精度结果，每个精度槽位惰性计算（首次请求才算）；同一 key 下行级
 *    骨架只算一次 —— word / char / smart 首算时复用 line 槽位的骨架做重
 *    投影，因此精度切换命中缓存，绝不重算已算过的精度，也不重算原始
 *    骨架 diff。同一输入在不同选项下按键落不同缓存条目（不同槽位）。
 *
 * 4. 统一分发（`getDiffRows`）：四种精度经会话取数的便捷出口，默认走
 *    `defaultSession` 单例，供 UI 后续替换各处直接调用引擎的散点。
 *
 * 硬性约束（对齐 ENG-001/003 的引擎层约束）：
 * - 零 UI 依赖、零 DOM、零 store 依赖：只允许 import `./diff.ts`、
 *   `./inline.ts`、`./options.ts` 与 `./types.ts`（均为纯逻辑引擎模块）；
 * - 不可变风格：所有导出函数返回新数组新对象，从不修改入参；缓存内的结果
 *   数组被视为只读（消费方不得原地修改 `get` 的返回值，改动请基于拷贝）。
 * ============================================================================
 */

import { compareWithOptions } from './diff'
import { applyInlineSpans, computeSpans } from './inline'
import { DEFAULT_OPTIONS, optionsKey } from './options'
import type { DiffOptions, DiffPrecision, DiffRow } from './types'

/* -------------------------------------------------------------------------- */
/* 一、smart 精度：行级骨架 + 词级投影（含降级路径）                              */
/* -------------------------------------------------------------------------- */

/**
 * 智能精度出口（ENG-004，`'smart'` 档默认精度；ENG-006 接入选项）：行级有
 * 差异 → 行级骨架 + 变化行内词级高亮；整行等价但词不同等场景自动降级。
 *
 * 实现方式：先用 `compareWithOptions` 按当前选项产出行骨架（行序 / 行号 /
 * type 与行级精度一致；缺省选项下即 `diffLinesCore`），再按骨架形态分流：
 *
 * - `left === right`：直接返回全 equal 骨架（逐行浅拷贝，不与内部骨架共享
 *   行对象），不做词级尝试 —— 完全相同的输入没有任何可高亮的差异；
 * - 骨架含非 equal 行（主路径）→ `applyInlineSpans`（granularity `'word'`，
 *   透传 options）在「del 块紧跟 add 块」的替换区域内按位置配对填词级高亮；
 * - 骨架中存在 `'equal'` 但两侧原文不同的行（规范化等价，降级路径）→ 为
 *   这些行补填词级 spans（见 `smartFromSkeleton` JSDoc），使「整行等价但
 *   词不同」在行内高亮中可见。
 *
 * 精度切换缓存：本函数是「每次全量计算」的无缓存版本；带缓存的精度切换走
 * `createDiffSession` / `getDiffRows`（smart 槽位复用 line 槽位骨架重投影，
 * 不重算原始骨架 diff）。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @param options 对比选项（ENG-006，缺省 `DEFAULT_OPTIONS` = 严格比较，
 *                行为与 ENG-004 完全一致）
 * @returns 完整展开的差异行序列（含 `'equal'` 行），行号均为 1-based；
 *          变化区域与规范化等价行带行内 `words`
 */
export function diffSmartPrecision(
  left: string,
  right: string,
  options: DiffOptions = DEFAULT_OPTIONS,
): DiffRow[] {
  return smartFromSkeleton(left, right, compareWithOptions(left, right, options), options)
}

/**
 * 在既有行级骨架上执行 smart 精度策略（`diffSmartPrecision` 的骨架复用内核，
 * 模块内私有）：缓存会话的 smart 槽位经它复用 line 槽位的骨架，避免为
 * smart 单独重算一次骨架 diff。无缓存版 `diffSmartPrecision` 传
 * `compareWithOptions` 的结果进来，行为一致。
 *
 * 分支结构：
 *
 * 1. `left === right`：直接返回全 equal 骨架的逐行浅拷贝（使返回值与入参
 *    骨架不共享行对象），不做词级尝试；
 * 2. 其余情况 → 词级投影（`applyInlineSpans`，透传 options），随后对
 *    `'equal'` 且 `left.text !== right.text` 的行（规范化等价、原文不同，
 *    开启 ENG-006 忽略选项后的典型形态）补填词级 spans：
 *    - spans 用【严格比较】的 `computeSpans`（不带 options）计算 —— 等价行
 *      的两侧原文已确定不同，行内 spans 的职责是把「原文到底哪里不同」
 *      定位到词；若按选项规范化比较，被忽略维度内的差异（恰是等价行残差
 *      的全部来源）会被折叠成 changed: false，等价行将与完全相同的行不可
 *      区分，「使整行等价但词不同可见」的目标落空；
 *    - 填充同时作用于主路径（骨架含 del/add，混合了等价残差行）与纯降级
 *      路径（骨架全 equal），两侧 `words` 拼接恒等于各自 `text`；
 *    - `left === right` 的输入不会产生原文不同的等价行，行为不变。
 *
 * @param left 左侧（旧文本）原始输入（用于 `left === right` 快速判等）
 * @param right 右侧（新文本）原始输入（同上）
 * @param skeleton 行级骨架（通常来自 `compareWithOptions(left, right, options)`
 *                 或缓存会话的 line 槽位；本函数不修改入参）
 * @param options 对比选项（ENG-006，透传给词级投影；缺省严格比较）
 * @returns smart 精度的 `DiffRow[]`：行序 / 行号 / type 与骨架一致
 */
function smartFromSkeleton(
  left: string,
  right: string,
  skeleton: DiffRow[],
  options: DiffOptions = DEFAULT_OPTIONS,
): DiffRow[] {
  if (left === right) {
    // 全等输入：骨架必然全 equal 且无任何可高亮差异。逐行浅拷贝返回而不是
    // 返回骨架本身：缓存会话场景下入参是 line 槽位的缓存数组，拷贝保证
    // smart 槽位与 line 槽位不共享行对象（缓存只读约定的防御性落实）。
    return skeleton.map((row) => ({ ...row }))
  }

  // 主路径（骨架含 del/add 块）与降级路径（骨架全 equal）统一产出「行级骨架
  // + 词级投影」：前者 applyInlineSpans 在替换区域填词级高亮；后者骨架无
  // 配对区域，投影原样返回等价行序列，随后由下方补填逻辑定位等价行残差。
  const projected = applyInlineSpans(skeleton, 'word', options)

  // ENG-006 降级路径正式生效：规范化等价（type 'equal'）但原文不同的行 →
  // 补填词级 spans（严格比较，理由见函数 JSDoc），使残差差异行内可见。
  return projected.map((row) => {
    if (
      row.type === 'equal' &&
      row.left !== undefined &&
      row.right !== undefined &&
      row.left.text !== row.right.text
    ) {
      const spans = computeSpans(row.left.text, row.right.text, 'word')
      return {
        ...row,
        left: { ...row.left, words: spans.left },
        right: { ...row.right, words: spans.right },
      }
    }
    return row
  })
}

/* -------------------------------------------------------------------------- */
/* 二、缓存会话：同一「输入 + 选项」四种精度的惰性槽位缓存                         */
/* -------------------------------------------------------------------------- */

/** 会话缓存条目：同一 (left, right, options) 下四种精度的惰性槽位（未计算 = 缺省）。 */
type DiffSessionEntry = Partial<Record<DiffPrecision, DiffRow[]>>

/**
 * 缓存会话统计快照（`DiffSession.stats()` 返回值，供测试与调试观测）。
 */
export interface DiffSessionStats {
  /**
   * 实际执行的精度投影次数：每个精度槽位首次计算计 1（含被 word / char /
   * smart 首算连带触发的 line 骨架计算），缓存命中不计数。
   */
  computations: number
  /**
   * 缓存命中次数：外层 `get` 命中已算过的精度槽位计 1；word / char / smart
   * 首算时复用已算过的 line 槽位同样计 1（内部复用是真实的重算规避，
   * 计入后才能观测到「同一 key 下 line 骨架只算一次」）。
   */
  cacheHits: number
  /** 缓存条目数：当前缓存的 (left, right, options) 输入状态数量。 */
  cacheSize: number
}

/**
 * 缓存会话（ENG-004；ENG-006 接入选项维度）：同一「输入 + 选项」的四种精度
 * 结果缓存与统一取数入口。
 *
 * 精度切换基于同一输入缓存重投影：`(left, right, options)` 相同而
 * `precision` 不同时，各精度槽位独立惰性缓存、互不重算；word / char /
 * smart 首算时复用 line 槽位的骨架（line 未算过则连带惰性计算一次），保证
 * 同一 key 下行级骨架只算一次。`(left, right)` 相同而 `options` 不同时，
 * `optionsKey` 使不同选项落不同缓存条目（互不串用）。
 */
export interface DiffSession {
  /**
   * 取指定精度的差异行序列（带缓存）。
   *
   * 首次请求某精度才计算并缓存，之后同精度请求返回缓存中的同一份结果；
   * 返回值为缓存内容本身（只读约定，见文件头），跨调用共享引用。
   *
   * @param left 左侧（旧文本）原始输入
   * @param right 右侧（新文本）原始输入
   * @param precision 目标精度（`'smart' | 'line' | 'word' | 'char'`）
   * @param options 对比选项（ENG-006，缺省 `DEFAULT_OPTIONS`）；缺省选项下
   *                行为与 ENG-004 完全一致
   * @returns 该精度的 `DiffRow[]`（语义与各自独立入口一致：line →
   *          `compareWithOptions`（缺省选项下同 `diffLinesCore`）、
   *          word / char → 骨架 + 行内投影、smart → `diffSmartPrecision`）
   */
  get(left: string, right: string, precision: DiffPrecision, options?: DiffOptions): DiffRow[]
  /** 当前统计快照（每次调用返回新对象，不共享内部计数器）。 */
  stats(): DiffSessionStats
}

/**
 * 创建缓存会话（ENG-004 核心）：内部以
 * `left + '\u0000' + right + '\u0000' + optionsKey(options)` 为 key 的
 * `Map` 缓存，value 为 `{ line, word, char, smart }` 四个惰性槽位。
 *
 * 键设计：NUL（U+0000）分隔符防拼接歧义 —— 简单拼接 `'ab' + 'c'` 与
 * `'a' + 'bc'` 会撞 key，带分隔后分别为 `'ab\u0000c'` 与 `'a\u0000bc'`；
 * 常规文本输入几乎不含 U+0000，不做转义（对齐任务书约定的键格式）。
 * 第三段为 `optionsKey(options)`（JSON 片段，不含 U+0000，见
 * `./options.ts`）：同一输入不同选项落不同缓存条目，同选项共享条目并按
 * 精度分槽位。
 *
 * @returns 全新空缓存的会话实例（多实例互不影响，测试用独立实例避免串扰）
 */
export function createDiffSession(): DiffSession {
  const cache = new Map<string, DiffSessionEntry>()
  let computations = 0
  let cacheHits = 0

  /**
   * 取单个精度槽位（惰性）：已缓存 → 命中计数并直接返回；未缓存 → 计算
   * （word / char / smart 先递归取 line 槽位复用骨架：line 已算过则记一次
   * 内部命中，未算过则惰性触发一次 line 计算），写入槽位并计一次投影。
   * entry 已按 (left, right, options) 定位，槽位内选项恒一致。
   */
  const getSlot = (
    left: string,
    right: string,
    entry: DiffSessionEntry,
    options: DiffOptions,
    precision: DiffPrecision,
  ): DiffRow[] => {
    const cached = entry[precision]
    if (cached !== undefined) {
      cacheHits += 1
      return cached
    }

    let rows: DiffRow[]
    if (precision === 'line') {
      // line 槽位：带选项的行级骨架本体（同一 key 下全局只算这一次）。
      rows = compareWithOptions(left, right, options)
    } else if (precision === 'word' || precision === 'char') {
      // 词级 / 字符级投影：复用 line 槽位骨架做重投影（透传 options），
      // 不重算骨架 diff。
      rows = applyInlineSpans(getSlot(left, right, entry, options, 'line'), precision, options)
    } else {
      // smart：同样复用 line 槽位骨架执行智能策略（含 ENG-006 降级路径）。
      rows = smartFromSkeleton(left, right, getSlot(left, right, entry, options, 'line'), options)
    }

    entry[precision] = rows
    computations += 1
    return rows
  }

  return {
    get(left, right, precision, options = DEFAULT_OPTIONS) {
      const key = left + '\u0000' + right + '\u0000' + optionsKey(options)
      let entry = cache.get(key)
      if (entry === undefined) {
        entry = {}
        cache.set(key, entry)
      }
      return getSlot(left, right, entry, options, precision)
    },
    stats() {
      return { computations, cacheHits, cacheSize: cache.size }
    },
  }
}

/* -------------------------------------------------------------------------- */
/* 三、默认单例与统一分发                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 默认单例的真实状态持有者：`resetDefaultSession` 通过整体重建它来清空缓存，
 * `defaultSession` 门面对象的身份恒定不变（UI 持有的引用不会因 reset 失效）。
 */
let defaultSessionState = createDiffSession()

/**
 * 默认缓存会话单例（ENG-004，供 UI 后续直接使用）：进程内共享一份缓存，
 * 同一输入 + 选项的重复对比（实时对比防抖、精度 / 选项切换）不再重算。
 */
export const defaultSession: DiffSession = {
  get(left, right, precision, options = DEFAULT_OPTIONS) {
    return defaultSessionState.get(left, right, precision, options)
  },
  stats() {
    return defaultSessionState.stats()
  },
}

/**
 * 清空默认会话的缓存与统计计数（测试隔离用；UI 运行期一般无需调用）。
 * 仅重建内部状态：`defaultSession` 门面引用不变，之后的 `get` 重新计算。
 */
export function resetDefaultSession(): void {
  defaultSessionState = createDiffSession()
}

/**
 * 判断 `getDiffRows` 第 4 参是否为缓存会话实例（模块内私有，向后兼容垫片的
 * 判据）：`DiffSession` 以 `get` / `stats` 两个函数成员为特征，`DiffOptions`
 * 不含任何函数字段，二者不可能混淆。
 */
function isDiffSession(value: DiffOptions | DiffSession): value is DiffSession {
  const candidate = value as Partial<DiffSession> | null
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.get === 'function' &&
    typeof candidate.stats === 'function'
  )
}

/**
 * 统一分发便捷函数（ENG-004；ENG-006 接入选项维度）：按精度 + 选项取差异
 * 行序列，默认走 `defaultSession`。
 *
 * UI 侧推荐统一经本函数取数（精度 / 选项切换即换 `precision` / `options`
 * 参数，缓存层保证同一「输入 + 选项」不重算）；需要缓存隔离（单测 /
 * 一次性大批量场景）时可传入 `createDiffSession()` 创建的独立会话。
 *
 * 向后兼容（ENG-004 签名）：第 4 参也可以传缓存会话实例（旧调用形态
 * `getDiffRows(left, right, precision, session)`）—— 经 `isDiffSession`
 * 识别后按旧语义以 `DEFAULT_OPTIONS` 在该会话上取数；`DiffOptions` 与
 * `DiffSession` 字段不相交，识别无歧义。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @param precision 目标精度（`'smart' | 'line' | 'word' | 'char'`）
 * @param options 对比选项（ENG-006，缺省 `DEFAULT_OPTIONS`；传会话实例时
 *                触发向后兼容路径，见上）
 * @param session 缓存会话，缺省为 `defaultSession` 单例
 * @returns 该精度的 `DiffRow[]`（语义对齐各精度独立入口，见 `DiffSession.get`）
 */
export function getDiffRows(
  left: string,
  right: string,
  precision: DiffPrecision,
  options: DiffOptions | DiffSession = DEFAULT_OPTIONS,
  session: DiffSession = defaultSession,
): DiffRow[] {
  // 向后兼容垫片：旧签名把 session 放在第 4 参。
  if (isDiffSession(options)) {
    return options.get(left, right, precision)
  }
  return session.get(left, right, precision, options)
}
