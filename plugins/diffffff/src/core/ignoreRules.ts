/**
 * ============================================================================
 * 自定义忽略规则的编译与应用（roadmap 任务 ENG-007）
 * ============================================================================
 *
 * 为 `DiffOptions.ignoreRules`（UI-005 设置弹窗管理的用户正则列表）提供
 * 「规则层」的单一事实来源：对比前按规则对文本做归一化替换（被命中的片段
 * 从比较文本中删除），原文（`DiffRow` 各侧的 `text`、spans 的 `text`）恒
 * 保留用于展示 —— 「忽略」语义只作用在比较层，与 ENG-006 的开关一致。
 *
 * 三个出口：
 * 1. `compileIgnoreRules`：把规则列表一次性编译为 RegExp 数组（仅取 enabled
 *    规则；逐条 `new RegExp(pattern, flags)`，失败返回结构化错误而不是抛出，
 *    供入口决定错误通道 —— 行级 API 抛 `RuleError`、`compareFull` 返回
 *    `DiffResultErr`）。全局标志 `g` 自动补上，保证一条规则替换整行 /
 *    整 token 内的所有命中；
 * 2. `normalizeWithRules`：对单行（或单 token）依次应用全部已编译规则做
 *    全量替换（replaceAll 语义）；
 * 3. `RuleError`：行级 API（返回 `DiffRow[]` 的函数，如
 *    `compareWithOptions` / `applyInlineSpans` 链路）无法用 `DiffResult`
 *    通道报错，约定以本异常类型上报 —— `error` 属性携带结构化 `DiffError`
 *    （`kind: 'invalid-regex'` + 出错 pattern），需要「不抛」通道的调用方
 *    （UI 主入口 `compareFull`）捕获后原样转写为 `{ ok: false, error }`。
 *
 * 应用顺序约定（与 `./options.ts` `normalizeForCompare` 对齐，固定不可交换）：
 * 规则替换最先执行（作用于原始行 / 原始 token）→ 再 ignoreWhitespace →
 * 再 ignoreCase。规则先行的意义：规则可以从原文中删除「带空白 / 带大小写
 * 信息」的片段，其留下的空白由后续空白折叠吸收（见 options.ts 的顺序证明
 * 用例）。
 *
 * 硬性约束（对齐 ENG-001/002/003/004/006 的引擎层约束）：
 * - 零 UI 依赖、零 DOM、零 store 依赖：仅类型依赖 `./types.ts`
 *   （type-only import，运行时零依赖）；
 * - 纯函数：不修改入参（含 `rules` 数组与已编译正则），不持有任何可变状态。
 * ============================================================================
 */

import type { DiffError, IgnoreRule } from './types'

/* -------------------------------------------------------------------------- */
/* RuleError：行级 API 的结构化错误异常                                          */
/* -------------------------------------------------------------------------- */

/**
 * 忽略规则错误的异常类型（ENG-007）：行级 API（返回 `DiffRow[]` /
 * spans 的函数，如 `compareWithOptions`）的错误约定。
 *
 * 背景：`DiffResult`（`{ ok, error }` 判别联合）是引擎入口层的返回通道，
 * 而行级核心函数的返回值是裸 `DiffRow[]`，没有携带错误的形状。约定：
 * - 行级 API 遇到非法规则 → `throw new RuleError(error)`，结构化错误挂在
 *   `error` 属性上（类型收窄后可直接读取，不必解析 message）；
 * - `compareFull`（UI 主入口，返回 `DiffResult`）捕获本异常，把 `error`
 *   原样转写为 `{ ok: false, error }` 返回 —— UI 侧只面对 DiffResult 通道；
 * - 下游（缓存会话 / 精度出口）不捕获，异常沿调用链自然上抛到入口。
 */
export class RuleError extends Error {
  /** 结构化错误详情（当前只可能是 `kind: 'invalid-regex'`）。 */
  readonly error: DiffError

  /**
   * @param error 结构化错误（`kind: 'invalid-regex'` 时含出错的 pattern）
   */
  constructor(error: DiffError) {
    super(describeRuleError(error))
    this.name = 'RuleError'
    this.error = error
  }
}

/**
 * 生成 RuleError 的人类可读 message（模块内私有）：结构化信息在 `error`
 * 属性上，message 只用于日志 / 兜底展示。
 */
function describeRuleError(error: DiffError): string {
  if (error.kind === 'invalid-regex') {
    return `忽略规则正则非法：${error.pattern}`
  }
  return `忽略规则错误：${error.kind}`
}

/* -------------------------------------------------------------------------- */
/* compileIgnoreRules：规则列表 → 已编译正则（一次编译，全链路复用）              */
/* -------------------------------------------------------------------------- */

/** `compileIgnoreRules` 的返回类型（判别联合，判别字段 `ok`）。 */
export type CompiledIgnoreRules =
  | { /** 全部 enabled 规则编译成功。 */ ok: true; /** 已编译正则（顺序与 enabled 规则出现顺序一致，恒带 g）。 */ regexes: RegExp[] }
  | { /** 存在非法正则。 */ ok: false; /** 第一个非法规则的结构化错误。 */ error: DiffError }

/**
 * 把忽略规则列表一次性编译为 RegExp 数组（ENG-007 核心）。
 *
 * 编译规则：
 * - 仅取 `enabled === true` 的规则，按出现顺序编译（规则的先后即替换的
 *   先后，语义有序，不可重排）；
 * - 每条 `new RegExp(pattern, flags)`：`flags` 缺省按 `'g'` 处理；提供的
 *   flags 不含 `g` 时自动追加（替换必须全量命中）；已含 `g` 则原样保留；
 * - 任一条编译失败（pattern 或 flags 非法）→ 立即返回
 *   `{ ok: false, error: { kind: 'invalid-regex', pattern } }`，报告
 *   【第一个】非法 pattern，不再编译后续规则（fail-fast）；
 * - disabled 规则【不参与编译】：其 pattern 即便非法也不报错（禁用的规则
 *   不影响本次对比）。
 *
 * 性能约定：调用方（`compareWithOptions` / `applyInlineSpans` 链路）在
 * 入口调用本函数一次，把 `regexes` 沿调用链传入
 * `normalizeForCompare` / `computeSpans`，避免逐行 / 逐 token 重编译。
 *
 * 纯函数：不修改 `rules`，返回的 RegExp 由本函数新建。
 *
 * @param rules 用户规则列表（原样读取，允许含 disabled / 非法规则）
 * @returns 全部 enabled 规则编译成功 → `{ ok: true, regexes }`；
 *          存在非法正则 → `{ ok: false, error }`（第一个非法 pattern）
 */
export function compileIgnoreRules(rules: IgnoreRule[]): CompiledIgnoreRules {
  const regexes: RegExp[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    try {
      // 全局标志 g 自动补上：一条规则须替换整行（/ 整 token）内的所有命中。
      // flags 已含 g 时原样保留（重复追加 'g' 会因 flags 非法抛错）。
      const flags =
        rule.flags === undefined ? 'g' : rule.flags.includes('g') ? rule.flags : rule.flags + 'g'
      regexes.push(new RegExp(rule.pattern, flags))
    } catch {
      return { ok: false, error: { kind: 'invalid-regex', pattern: rule.pattern } }
    }
  }
  return { ok: true, regexes }
}

/* -------------------------------------------------------------------------- */
/* normalizeWithRules：单行（/ 单 token）的规则替换                              */
/* -------------------------------------------------------------------------- */

/**
 * 对一段文本依次应用全部已编译规则做归一化替换（ENG-007 应用层）。
 *
 * 行为：按 `regexes` 的顺序逐条执行「全量删除」（replaceAll 语义 —— 命中
 * 片段替换为空串）。实现用 `String.prototype.replace(re, '')`：`regexes`
 * 来自 `compileIgnoreRules` 时恒带全局标志 `g`，`replace` 与 `replaceAll`
 * 等价（本工程 TS lib 为 ES2020，未引入 `replaceAll` 的类型声明，故用
 * `replace` + g 实现；直接传入不带 g 的正则时仅替换首个命中，不属本函数
 * 的支持用法）。多条规则叠加时前一条的输出即后一条的输入。
 *
 * 用途边界：返回值仅用于「相等性比较」（行级 comparator、行内 token
 * comparator 的输入），绝不写入 `DiffRow` 的 `text` / spans —— 展示文本
 * 恒为原文。
 *
 * @param line 一行文本（或行内单个 token，见 `./inline.ts` 的用法）
 * @param regexes 已编译规则（须来自 `compileIgnoreRules`，恒带 g；
 *                空数组 = 无规则，原样返回）
 * @returns 规则替换后的比较文本（非展示用）
 */
export function normalizeWithRules(line: string, regexes: RegExp[]): string {
  let normalized = line
  for (const re of regexes) {
    // re 恒带 g（compileIgnoreRules 保证）→ 全量替换（replaceAll 语义）。
    normalized = normalized.replace(re, '')
  }
  return normalized
}
