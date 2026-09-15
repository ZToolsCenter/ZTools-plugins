/**
 * ============================================================================
 * diff 引擎（roadmap 任务 ENG-001：行级 diff）
 * ============================================================================
 *
 * 引擎层主入口文件（M1 的第一个模块）：封装 jsdiff（npm 包 `diff` v9.0.0）
 * 的 `diffArrays`，把文本对比结果转换为 `DiffRow[]`（见 `./types.ts` 共享
 * 契约），供 M2 工作台 UI（UI-006~010）直接消费。后续 ENG-002~013 的模块
 * （CJK tokenizer / 词级 diff / 精度选项 / hunk / 统计 / 大文本防护等）
 * 继续在本目录扩展，或在本文件追加导出（词级 / 字符级精度出口
 * `diffWordPrecision` / `diffCharPrecision` 即 ENG-003 在本文件的追加）。
 *
 * 硬性约束：
 * - 零 UI 依赖、零 DOM、零 store 依赖：只允许 import `diff` 包、
 *   `./types.ts`、`./inline.ts`（ENG-003 词级 / 字符级行内 diff）、
 *   `./options.ts`（ENG-006 对比选项的规范化辅助）、`./normalize.ts`
 *   （ENG-010 输入规范化：入口剥 BOM 与边界诊断元数据，叶子模块）、
 *   `./guards.ts`（ENG-011 大文本防护：入口超限校验，近叶子模块）、
 *   `./ignoreRules.ts`（ENG-007 忽略规则的编译与 RuleError）、`./hunks.ts`
 *   （ENG-008 hunk 切分与折叠区段）、`./stats.ts`（ENG-009 统计与导航，
 *   compareFull 的
 *   stats 段消费；`./inline.ts` 自身仅依赖
 *   `diff` 包、`./tokenizer.ts`、`./ignoreRules.ts`、`./options.ts` 与
 *   `./types.ts`，同为纯逻辑引擎模块）；
 * - 所有行号均为 1-based（对齐 `DiffRowSide.lineNo` 的注释约定），并排视图
 *   左右两列行号各自独立累计；
 * - 任意一行 `left` / `right` 至少一侧存在：`'del'` 行无 `right`，
 *   `'add'` 行无 `left`，`'equal'` 行两侧都有且 `text` 相同。
 * ============================================================================
 */

import { diffArrays } from 'diff'
import { buildHunks } from './hunks'
import { checkPairLimits } from './guards'
import { compileIgnoreRules, RuleError } from './ignoreRules'
import { applyInlineSpans } from './inline'
import { isLongLine, normalizeText } from './normalize'
import { DEFAULT_OPTIONS, isEmptyish, normalizeForCompare } from './options'
import { computeStats } from './stats'
import type { DiffOptions, DiffResult, DiffResultOk, DiffRow } from './types'

/**
 * 把任意文本按行切分（ENG-001 辅助函数）。
 *
 * 行为约定：
 * - 支持 `\r\n`（Windows）/ `\n`（Unix）/ `\r`（旧 Mac）三种换行符，
 *   切分结果一律不保留行尾符 → 混用行尾符在行内容层面不产生差异
 *   （ENG-010 定稿策略第 2 条；风格元数据见 `./normalize.ts` 的
 *   `analyzeInput`）；
 * - 空字符串返回 `[]`（0 行），而不是 `['']`（ENG-010 定稿策略第 4 条：
 *   空文本 = 0 行）；
 * - `"a\n"` 与 `"a"` 都返回 `['a']`：注意原生 `String.prototype.split` 对
 *   尾部换行会多产出一个末尾空串（`'a\n'.split(...)` → `['a', '']`），
 *   本函数在其结果上丢弃该空串以满足上述契约 —— 尾部换行的有无在本函数
 *   层面不可区分，这正是 ENG-010 定稿策略的一部分（尾部换行归一化为等价，
 *   策略第 3 条；「唯一差异是尾部换行」的元数据出口见 `./normalize.ts` 的
 *   `analyzeInputPair`）。
 *
 * 与规范化（ENG-010）的分工：完整输入规范化策略定稿于 `./normalize.ts`
 * （BOM 剥除 / 行尾符统一 / 尾部换行等价 / 空文本），引擎入口
 * （`diffLinesCore` / `compareWithOptions`）先经 `normalizeText` 剥除文本
 * 开头的单个 U+FEFF 再交给本函数切分；本函数自身不做 BOM 处理，也不做
 * 其他规范化。
 *
 * @param text 原始文本（原样输入，本函数不做其他规范化；BOM 由入口的
 *             `normalizeText` 先行剥除）
 * @returns 行内容数组（不含行尾符）；不含换行符的非空文本返回单元素数组
 */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r\n|\n|\r/)
  // 文本以换行符结尾时，split 的末尾元素恒为空串（见上方 JSDoc），丢弃之。
  if (/(?:\r\n|\n|\r)$/.test(text)) lines.pop()
  return lines
}

/**
 * 超长行标记的行对象片段（ENG-012 行展开共享辅助，diffLinesCore 与
 * expandRows 两条产出链路共用）：
 *
 * 任一传入的【存在的侧】文本超过 `LONG_LINE_THRESHOLD`（./normalize.ts 的
 * `isLongLine`）时返回 `{ longLine: true }`，否则返回空对象 —— 调用方以
 * spread 接线进 DiffRow 字面量：超长行获得 `longLine: true`，普通行不产生
 * 该键（`'longLine' in row === false`），保持行对象精简（见 `DiffRow.longLine`
 * 契约：`undefined` 即未标记）。
 *
 * 参数约定：按行对象实际存在的侧传入（'del' 行只传左侧、'add' 行只传右侧、
 * 'equal' 行传两侧）；`undefined` 表示该侧不存在（expandRows 的投影空行
 * 双侧可缺省），跳过判定。判定本身为 O(1)（取 `text.length` 比较），对
 * 行展开热路径开销可忽略。
 *
 * @param sideTexts 行对象各侧的 text（按存在与否传入，缺侧传 `undefined`）
 * @returns 可 spread 进 `DiffRow` 字面量的标记片段（超长时含 `longLine: true`）
 */
function longLineMark(...sideTexts: Array<string | undefined>): Partial<Pick<DiffRow, 'longLine'>> {
  for (const text of sideTexts) {
    if (text !== undefined && isLongLine(text)) return { longLine: true }
  }
  return {}
}

/**
 * 行级 diff 核心（ENG-001）：对比左右两段文本，产出并排渲染用的 `DiffRow` 序列。
 *
 * 实现方式：两侧先经 `splitLines` 切分为行数组，再用 jsdiff 的 `diffArrays`
 * （元素为行字符串、默认严格相等 `===` 比较）分块，按块顺序展开：
 *
 * - equal 块（`added === false && removed === false`）→ `'equal'` 行，
 *   left / right 同时存在，text 相同，两侧行号各自递增；
 * - removed 块（`removed === true`）→ `'del'` 行，只有 left，right 缺省；
 * - added 块（`added === true`）→ `'add'` 行，只有 right，left 缺省。
 *   同一替换区域内 jsdiff 先输出 removed 块再输出 added 块，
 *   因此 `'del'` 行总是先于与之相邻的 `'add'` 行出现。
 *
 * 边界处理：jsdiff v9 的 `diffArrays` 在任一侧输入数组为空时会引入幻影空
 * token（`[]` vs `['a']` 会先产出 `value: ['']` 的 removed 块，`[]` vs `[]`
 * 会产出 `value: ['']` 的 equal 块），与「空文本 = 0 行」的切分契约冲突，
 * 故任一侧为 0 行时不进 `diffArrays`，直接按纯删 / 纯增展开。
 *
 * 超长行标记（ENG-012）：每个产出的 DiffRow 经 `longLineMark` 计算
 * `longLine` —— 任一侧文本超过 `LONG_LINE_THRESHOLD`（./normalize.ts 的
 * `isLongLine`）时为 `true`，普通行不产生该键（见 `DiffRow.longLine` 契约）。
 * 带选项路径的同类接线在 `expandRows`（compareWithOptions /
 * compareIncremental 共享链路）。
 *
 * 输入规范化（ENG-010）：入口先对 left / right 各自 `normalizeText` 剥除
 * 文本开头的单个 U+FEFF 再切分 —— 行号与行文本因此不含 BOM（策略定稿与
 * 边界元数据出口见 `./normalize.ts`）；其余边界（单侧为空 / 尾部换行 /
 * 行尾混用）的语义由上方「边界处理」与 `splitLines` 的切分契约承载。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @returns 完整展开的差异行序列（含 `'equal'` 行），行号均为 1-based
 */
export function diffLinesCore(left: string, right: string): DiffRow[] {
  // ENG-010：入口先剥 BOM（定稿策略见 ./normalize.ts）—— 行文本与行号不含 BOM。
  const leftLines = splitLines(normalizeText(left))
  const rightLines = splitLines(normalizeText(right))

  const rows: DiffRow[] = []
  let leftNo = 0
  let rightNo = 0

  // 任一侧 0 行：不存在公共行，直接按纯删 / 纯增展开（绕开 diffArrays 的
  // 空数组幻影 token，见上方 JSDoc「边界处理」）。
  if (leftLines.length === 0 || rightLines.length === 0) {
    for (const line of leftLines) {
      leftNo += 1
      // ENG-012：单侧超长 → longLine: true（普通行不产生该键，下同）。
      rows.push({ type: 'del', left: { lineNo: leftNo, text: line }, ...longLineMark(line) })
    }
    for (const line of rightLines) {
      rightNo += 1
      rows.push({ type: 'add', right: { lineNo: rightNo, text: line }, ...longLineMark(line) })
    }
    return rows
  }

  const changes = diffArrays(leftLines, rightLines)

  for (const change of changes) {
    if (change.added) {
      // 新增块：只有右侧。
      for (const line of change.value) {
        rightNo += 1
        rows.push({ type: 'add', right: { lineNo: rightNo, text: line }, ...longLineMark(line) })
      }
    } else if (change.removed) {
      // 删除块：只有左侧。
      for (const line of change.value) {
        leftNo += 1
        rows.push({ type: 'del', left: { lineNo: leftNo, text: line }, ...longLineMark(line) })
      }
    } else {
      // 公共块：两侧都有，text 严格相等（同一字符串，标记判定取一次即可）。
      for (const line of change.value) {
        leftNo += 1
        rightNo += 1
        rows.push({
          type: 'equal',
          left: { lineNo: leftNo, text: line },
          right: { lineNo: rightNo, text: line },
          ...longLineMark(line),
        })
      }
    }
  }

  return rows
}

/* -------------------------------------------------------------------------- */
/* 带选项行级 diff 的计划 / 展开内部机制（ENG-011 重构）                          */
/*                                                                            */
/* 把原 compareWithOptions 的内联实现拆成可复用的三段，行级骨架只有一条产出    */
/* 链路（单一事实来源）：                                                      */
/*   1. prepareLineDiff  —— 切行后的行集过滤 / 空行投影队列 / 公共前后缀裁剪    */
/*                          （廉价 O(n) 扫描，不含 diff 计算）；                */
/*   2. executeLineDiff  —— 在（裁剪后的）中间行集上调用 jsdiff diffArrays，   */
/*                          归一化为 PlannedChange 块序列（唯一计算热点）；     */
/*   3. expandRows       —— 逐块展开为 DiffRow 的同步生成器（逐行 yield）。    */
/* compareWithOptions 同步消费三段（行为与 ENG-011 之前逐字节一致）；           */
/* compareIncremental 异步消费三段，在段间与行分片之间让出主线程。              */
/* -------------------------------------------------------------------------- */

/**
 * 空行投影队列的条目（ENG-006 ignoreEmptyLines）：`left` / `right` 为该空行
 * 在所属侧【原始行数组】中的 0-based 下标（双侧配对项两者都有，单侧余量项
 * 只有其一）。
 */
type PendingEmpty = { left?: number; right?: number }

/**
 * 归一化的 diff 块（executeLineDiff 的产出元素）：只保留展开所需的三个字段
 * —— jsdiff 公共块的 `value` 只保留其中一侧 token（见 compareWithOptions
 * JSDoc），行展开只读块长度与 added / removed 标记，原文按双侧游标各取各的，
 * 因此这里不保留 `value` 内容。
 */
interface PlannedChange {
  /** 新增块（只消费右侧行）。 */
  added: boolean
  /** 删除块（只消费左侧行）。 */
  removed: boolean
  /** 块内行数（两侧公共块为每侧行数）。 */
  count: number
}

/**
 * prepareLineDiff 的产出（一次 diff 的「行集计划」，不含 diff 块序列）。
 *
 * 命名对照 ENG-006 时代的内联局部变量：`leftDiff` / `leftOrig` /
 * `leftSkipped` 等语义不变；`prefixLen` / `suffixLen` / `leftMid` /
 * `rightMid` 为 ENG-011 新增的裁剪产物。
 */
interface PreparedLineDiff {
  /** 左侧原始行数组（剥 BOM 后切分；expandRows 取原文与行号用）。 */
  leftLines: string[]
  /** 右侧原始行数组（同上）。 */
  rightLines: string[]
  /** 左侧参与 diff 的行（ignoreEmptyLines 开启时已剔除空行）。 */
  leftDiff: string[]
  /** 右侧参与 diff 的行（同上）。 */
  rightDiff: string[]
  /** 左侧参与 diff 行的原始 0-based 下标（与 leftDiff 等长、逐元素对应）。 */
  leftOrig: number[]
  /** 右侧参与 diff 行的原始 0-based 下标（同上）。 */
  rightOrig: number[]
  /** 空行投影队列（FIFO；expandRows 按就绪判据冲刷，语义见 ENG-006）。 */
  pending: PendingEmpty[]
  /**
   * 空侧守卫：任一侧「参与 diff 的行集」为空时为 `true` —— 不进
   * diffArrays（jsdiff 空数组幻影 token 规避），expandRows 按纯删 / 纯增
   * 展开（含被剔除空行的投影补回）。
   */
  pureAddRemove: boolean
  /** 已裁剪的公共前缀行数（两侧参与 diff 行集的严格相等前缀；未裁剪为 0）。 */
  prefixLen: number
  /** 已裁剪的公共后缀行数（与前缀不重叠；不安全或未裁剪为 0，见 suffixTrimSafe）。 */
  suffixLen: number
  /** 裁剪后进入 differ 的左侧中间行集（leftDiff 去掉前后缀后的切片）。 */
  leftMid: string[]
  /** 裁剪后进入 differ 的右侧中间行集（同上）。 */
  rightMid: string[]
  /**
   * 'diff' 阶段的总量（按行）：进入 differ 的中间行数之和
   * （leftMid.length + rightMid.length）。空侧守卫路径没有 differ 计算，
   * 恒为 0。
   */
  diffLinesTotal: number
  /** 空行投影队列长度（= expandRows 将产出的投影空行数，rowsTotal 的组成部分）。 */
  emptyRowCount: number
}

/**
 * 参与 diff 行集的划分（prepareLineDiff 辅助）：把一行数组按 ignoreEmptyLines
 * 开关分成「参与 diff 的行」与「被剔除的空行」，并保留参与行在原数组中的
 * 0-based 下标（行号与原文回取用）。
 *
 * 为 compareWithOptions（ENG-006 时代内联实现）与 prepareLineDiff 共享的
 * 纯提取辅助：开关关闭时 `diff` 即入参数组拷贝、`orig` 为恒等下标、
 * `skipped` 为空。
 *
 * @param lines 某一侧的原始行数组（只读，不修改）
 * @param ignoreEmpty 是否剔除空行（`isEmptyish` 判定，含纯空白行）
 * @returns `{ diff, orig, skipped }`：参与 diff 的行 / 其原始下标 / 被剔除
 *          空行的原始下标（三者顺序都与原数组出现顺序一致）
 */
function partitionLinesForDiff(
  lines: string[],
  ignoreEmpty: boolean,
): { diff: string[]; orig: number[]; skipped: number[] } {
  const diff: string[] = []
  const orig: number[] = []
  const skipped: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (ignoreEmpty && isEmptyish(lines[i])) skipped.push(i)
    else {
      diff.push(lines[i])
      orig.push(i)
    }
  }
  return { diff, orig, skipped }
}

/**
 * 判定当前选项下 `normalizeForCompare` 是否为恒等映射（REL-002 性能回归抽取
 * 的共享判定，原为 suffixTrimSafe 内联的 canUseRawKey 条件）：三个忽略开关
 * 全关且无启用规则（已编译 regexes 为空数组）时，规范形恒等于原文 ——
 * diff comparator 与后缀裁剪的等价类键都可走「原文严格相等」快路径，免去
 * 逐行 / 逐比较的规范化函数调用。
 *
 * @param options 对比选项（只读 ignoreWhitespace / ignoreCase 开关）
 * @param ruleRegexes 已编译忽略规则（空数组 = 无生效规则）
 * @returns `true` = 比较语义即严格相等（`===`）
 */
function isIdentityComparator(options: DiffOptions, ruleRegexes: RegExp[]): boolean {
  return (
    options.ignoreWhitespace !== true && options.ignoreCase !== true && ruleRegexes.length === 0
  )
}

/**
 * 后缀裁剪的安全性判定（ENG-011 裁剪算法的关键防线）。
 *
 * 背景：jsdiff v9 的 Myers 实现通过「起始最大公共蛇」（extractCommon 从
 * (0,0) 起逐步吞掉相等前缀）天然分解掉【严格公共前缀】—— 对输入裁掉严格
 * 公共前缀再 diff 中间部分，块序列与全量 diff 严格一致（前缀裁剪无条件
 * 安全）。但【后缀】没有对应保证：当中间行与后缀行在比较语义下等价时，
 * jsdiff 可能把这些行的等价配对放在对齐序列中部而不是尾部（例：
 * `['','','']` vs `['b','c','']` 全量 diff 产出 add2/equal1/del2 ——
 * 左侧第一个空行与右侧最后一个空行配对），此时「裁后缀 + 尾部补 equal 块」
 * 的合成序列会与全量 diff 的行序列不同。
 *
 * 充分安全条件（本函数判定）：中间行集（两侧）没有任何一行与后缀行
 * （两侧）在【diff 比较器语义】下等价。此时后缀行只能与后缀行依序配对，
 * 任何最小对齐（含 jsdiff 的特定选择）都必然以「后缀 equal 块」收尾，
 * 合成序列 = 全量 diff 序列。判定用 Set 做哈希查重，O(middle + suffix)。
 *
 * 等价类口径：与 diffArrays 实际使用的 comparator 一致 —— 存在生效的
 * 忽略选项 / 规则时以 `normalizeForCompare` 的规范形为键（规则替换 →
 * 空白折叠 → 小写化，见 ./options.ts）；三关全关 + 无规则时规范形恒等
 * 于原文，直接用原文作键（快路径，免去逐行 normalizeForCompare 调用）。
 *
 * @param leftDiff 左侧参与 diff 的行集（只读）
 * @param rightDiff 右侧参与 diff 的行集（只读）
 * @param prefixLen 已裁剪的前缀长度（扫描中间行集的起点）
 * @param suffixLen 待裁剪的后缀长度（恒 ≥ 1）
 * @param options 对比选项（判定生效的忽略开关）
 * @param ruleRegexes 已编译忽略规则（规范形计算用；空数组 = 无规则）
 * @returns `true` = 后缀可安全裁剪；`false` = 存在跨区等价可能，放弃裁剪
 *          后缀（前缀裁剪不受影响）
 */
function suffixTrimSafe(
  leftDiff: string[],
  rightDiff: string[],
  prefixLen: number,
  suffixLen: number,
  options: DiffOptions,
  ruleRegexes: RegExp[],
): boolean {
  const canUseRawKey = isIdentityComparator(options, ruleRegexes)
  const keyOf = canUseRawKey
    ? (line: string) => line
    : (line: string) => normalizeForCompare(line, options, ruleRegexes)

  // 后缀行的等价类集合（两侧后缀行都纳入：等价配对可能跨越两侧）。
  const suffixKeys = new Set<string>()
  for (let j = 0; j < suffixLen; j += 1) {
    suffixKeys.add(keyOf(leftDiff[leftDiff.length - 1 - j]))
    suffixKeys.add(keyOf(rightDiff[rightDiff.length - 1 - j]))
  }
  const leftMidEnd = leftDiff.length - suffixLen
  const rightMidEnd = rightDiff.length - suffixLen
  for (let i = prefixLen; i < leftMidEnd; i += 1) {
    if (suffixKeys.has(keyOf(leftDiff[i]))) return false
  }
  for (let i = prefixLen; i < rightMidEnd; i += 1) {
    if (suffixKeys.has(keyOf(rightDiff[i]))) return false
  }
  return true
}

/**
 * 行级 diff 计划的第一段（廉价 O(n) 预处理，不含 diff 计算）：
 * 行集过滤 + 空行投影队列构建 + 公共前后缀裁剪。
 *
 * 裁剪算法（ENG-011 真实优化点，`trim = false` 时整体跳过、等价于不裁剪）：
 * - 在【参与 diff 的行集】（ignoreEmptyLines 过滤后）上做严格相等（`===`）
 *   的最长公共前缀 / 后缀扫描，前缀 + 后缀不重叠（后缀上限 = min(两侧长度)
 *   - 前缀长度）；裁剪只动「进 differ 的行集」，行号与原文仍由 orig 映射
 *   从全量行数组回取，故行号体系不变；
 * - 前缀裁剪无条件应用（jsdiff 起始公共蛇分解的等价改写，见
 *   suffixTrimSafe JSDoc「背景」）；
 * - 后缀裁剪仅在 suffixTrimSafe 判定安全时应用，否则放弃（s 归零、后缀
 *   行留在中间行集里参与 diff）—— 宁可少裁不减正确性；
 * - 全量输入逐字节相同的特例（两侧中间行集同时为空）不进 differ，块序列
 *   由 executeLineDiff 直接合成（前后缀 equal 块），即「全 equal 组装」。
 *
 * 空侧守卫：任一侧参与 diff 行集为空（`pureAddRemove`）时不做裁剪也无需
 * 裁剪（expandRows 走纯删 / 纯增展开路径），`diffLinesTotal` 为 0。
 *
 * @param leftLines 左侧原始行数组（剥 BOM 后切分，见 splitLines）
 * @param rightLines 右侧原始行数组（同上）
 * @param options 对比选项（ignoreEmptyLines 过滤判据 + 裁剪安全判定的
 *                等价类口径）
 * @param ruleRegexes 已编译忽略规则（ENG-007；空数组 = 无规则）
 * @param trim 是否启用公共前后缀裁剪（compareWithOptions 恒 false 保持
 *             既有行为；compareIncremental 恒 true）
 * @returns 行集计划（diff 块序列除外，见 executeLineDiff）
 */
function prepareLineDiff(
  leftLines: string[],
  rightLines: string[],
  options: DiffOptions,
  ruleRegexes: RegExp[],
  trim: boolean,
): PreparedLineDiff {
  const ignoreEmpty = options.ignoreEmptyLines === true
  const leftPart = partitionLinesForDiff(leftLines, ignoreEmpty)
  const rightPart = partitionLinesForDiff(rightLines, ignoreEmpty)
  const leftDiff = leftPart.diff
  const leftOrig = leftPart.orig
  const leftSkipped = leftPart.skipped
  const rightDiff = rightPart.diff
  const rightOrig = rightPart.orig
  const rightSkipped = rightPart.skipped

  // 空行投影队列：左右空行按位置顺序两两配对（FIFO），余量成单侧行。
  const pending: PendingEmpty[] = []
  const pairedCount = Math.min(leftSkipped.length, rightSkipped.length)
  for (let k = 0; k < pairedCount; k += 1) {
    pending.push({ left: leftSkipped[k], right: rightSkipped[k] })
  }
  for (let k = pairedCount; k < leftSkipped.length; k += 1) {
    pending.push({ left: leftSkipped[k] })
  }
  for (let k = pairedCount; k < rightSkipped.length; k += 1) {
    pending.push({ right: rightSkipped[k] })
  }

  // 空侧守卫（幻影 token 规避，与 diffLinesCore 相同，作用于「参与 diff 的
  // 行集」）：先按序展开纯删，再纯增，空行在各游标越过其位置时插入。
  const pureAddRemove = leftDiff.length === 0 || rightDiff.length === 0

  let prefixLen = 0
  let suffixLen = 0
  if (trim && !pureAddRemove) {
    // 严格相等的最长公共前缀 / 后缀（O(n)；前缀 + 后缀不重叠）。
    const maxCommon = Math.min(leftDiff.length, rightDiff.length)
    while (prefixLen < maxCommon && leftDiff[prefixLen] === rightDiff[prefixLen]) {
      prefixLen += 1
    }
    const maxSuffix = maxCommon - prefixLen
    while (
      suffixLen < maxSuffix &&
      leftDiff[leftDiff.length - 1 - suffixLen] === rightDiff[rightDiff.length - 1 - suffixLen]
    ) {
      suffixLen += 1
    }
    // 后缀跨区等价可能（中间行与后缀行等价）时放弃后缀裁剪，保证裁剪
    // 结果与不裁剪的块序列逐字节一致（见 suffixTrimSafe JSDoc）。
    if (suffixLen > 0 && !suffixTrimSafe(leftDiff, rightDiff, prefixLen, suffixLen, options, ruleRegexes)) {
      suffixLen = 0
    }
  }

  // 中间行集：空侧守卫路径没有内容进 differ（保持空数组，避免无谓的
  // 整侧拷贝）；常规路径为参与行集去掉前后缀后的连续切片。
  const leftMid = pureAddRemove ? [] : leftDiff.slice(prefixLen, leftDiff.length - suffixLen)
  const rightMid = pureAddRemove ? [] : rightDiff.slice(prefixLen, rightDiff.length - suffixLen)

  return {
    leftLines,
    rightLines,
    leftDiff,
    rightDiff,
    leftOrig,
    rightOrig,
    pending,
    pureAddRemove,
    prefixLen,
    suffixLen,
    leftMid,
    rightMid,
    diffLinesTotal: pureAddRemove ? 0 : leftMid.length + rightMid.length,
    emptyRowCount: pending.length,
  }
}

/**
 * 行级 diff 计划的第二段（ENG-011【唯一计算热点】—— jsdiff diffArrays 调用
 * 所在，也是未来迁移 Web Worker 的迁移点）：在裁剪后的中间行集上计算 diff，
 * 产出归一化块序列（含合成的前后缀 equal 块）。
 *
 * 块序列的合成规则（裁剪开启时）：
 * `[equal(prefixLen)] + diff(leftMid, rightMid) + [equal(suffixLen)]`
 * —— 前缀 / 后缀行在两侧严格相等（后缀另需 suffixTrimSafe 判定），作为
 * equal 块直接合成即可；中间行集为空时按三种特例合成：
 * - 两侧中间都空（全量输入逐字节相同）：仅前后缀 equal 块，不进 differ；
 * - 仅左侧中间为空：整个中间是右侧的新增块（纯 add 合成）；
 * - 仅右侧中间为空：整个中间是左侧的删除块（纯 del 合成）。
 * 空侧守卫路径（pureAddRemove）不进本函数的实际计算，返回空数组
 * （expandRows 按纯删 / 纯增自行展开）。
 *
 * 深度一致性的保证（裁剪结果 ≡ 不裁剪结果）：
 * - 前缀：jsdiff 起始公共蛇分解的等价改写（无条件成立）；
 * - 后缀：suffixTrimSafe 的充分安全条件（后缀行只能与后缀行依序配对，
 *   任何最小对齐都以尾部 equal 块收尾）；
 * - 中间：与全量 diff 用同一 comparator，diffArrays 输入为全量的连续切片，
 *   起始公共蛇论证对中间子问题同样成立。
 * 以上由 tests/core/guards.test.ts 的确定性模糊测试（小字符集 × 比较器
 * 开关 × 数万轮）锁定。
 *
 * 【Worker 迁移点】本函数是整条链路里唯一无法分片的同步热点；入参
 * （行集切片 + 选项 + 编译规则）与出参（PlannedChange[]）均为可结构化
 * 克隆的纯数据，未来把 diffArrays 迁入 Worker 时，compareIncremental 的
 * 其余链路（裁剪 / 行展开 / hunk 统计组装 / 调度）可原样复用 —— 把本函数
 * 换成 `postMessage` 往返即可，onProgress 的 'diff' 阶段事件正好承担
 * 「迁移后等待 Worker 回包」期间的进度语义（done: 0 → total）。
 *
 * @param prepared prepareLineDiff 的产出（只读，不修改）
 * @param options 对比选项（comparator 的规范化口径）
 * @param ruleRegexes 已编译忽略规则（comparator 用；空数组 = 无规则）
 * @returns 归一化 diff 块序列（顺序即行展开顺序；空侧守卫路径为空数组）
 */
function executeLineDiff(
  prepared: PreparedLineDiff,
  options: DiffOptions,
  ruleRegexes: RegExp[],
): PlannedChange[] {
  if (prepared.pureAddRemove) return []

  const changes: PlannedChange[] = []
  const { prefixLen, suffixLen, leftMid, rightMid } = prepared

  if (prefixLen > 0) changes.push({ added: false, removed: false, count: prefixLen })

  if (leftMid.length === 0 && rightMid.length === 0) {
    // 全量输入逐字节相同（或裁剪后中间为空）：无差异，仅前后缀 equal 块。
  } else if (leftMid.length === 0) {
    // 中间只剩右侧行：整块纯新增。
    changes.push({ added: true, removed: false, count: rightMid.length })
  } else if (rightMid.length === 0) {
    // 中间只剩左侧行：整块纯删除。
    changes.push({ added: false, removed: true, count: leftMid.length })
  } else {
    // REL-002 性能回归（comparator 恒等快路径 + 规范形记忆化）：
    // - 三开关全关 + 无启用规则（isIdentityComparator）时 normalizeForCompare
    //   是恒等映射 → comparator 退化为严格相等，直接【省略 comparator】
    //   （jsdiff 缺省 equals 即 `===`）：Myers 探索的比较次数为 O(D²) 量级，
    //   原实现每次比较都要付两次 normalizeForCompare 调用与选项检查（REL-002
    //   基准实测约 2~3% 耗时，且属任务点名的「重复规范化」低效点）；
    // - 存在生效的忽略开关 / 规则时，按【本次 diffArrays 调用】记忆化规范形：
    //   normalizeForCompare 是纯函数（规则已编译一次，同一行字符串恒得同一
    //   规范形），逐比较重跑空白折叠正则 / toLowerCase 会被 O(D²) 比较次数
    //   放大为秒级开销 —— Map 以行字符串为键、左右侧共享，容量上界为本次
    //   参与行集的去重行数（≤ 输入行数），生命周期仅限本次调用；
    // 两条路径的相等性判定结果与原实现逐字节一致（恒等映射 / 纯函数记忆化
    // 均不改变比较语义），diff 块序列不变（既有全量单测与模糊测试锁定）。
    let rawChanges: Array<{ added?: boolean; removed?: boolean; value: string[] }>
    if (isIdentityComparator(options, ruleRegexes)) {
      rawChanges = diffArrays(leftMid, rightMid)
    } else {
      // 规范形记忆化缓存：键 = 行字符串（左右侧共享），值 = 规范形。
      const normalizedCache = new Map<string, string>()
      rawChanges = diffArrays(leftMid, rightMid, {
        comparator: (a: string, b: string) => {
          let leftNormalized = normalizedCache.get(a)
          if (leftNormalized === undefined) {
            leftNormalized = normalizeForCompare(a, options, ruleRegexes)
            normalizedCache.set(a, leftNormalized)
          }
          let rightNormalized = normalizedCache.get(b)
          if (rightNormalized === undefined) {
            rightNormalized = normalizeForCompare(b, options, ruleRegexes)
            normalizedCache.set(b, rightNormalized)
          }
          return leftNormalized === rightNormalized
        },
      })
    }
    for (const change of rawChanges) {
      changes.push({
        added: change.added === true,
        removed: change.removed === true,
        count: change.value.length,
      })
    }
  }

  if (suffixLen > 0) changes.push({ added: false, removed: false, count: suffixLen })
  return changes
}

/**
 * 精确预估 expandRows 将产出的总行数（compareIncremental 的 'rows' 阶段
 * progress total 用；与展开逻辑共享同一套计数口径，恒等于实际产出行数）：
 * - 空侧守卫路径：左侧参与行数 + 右侧参与行数 + 空行投影数；
 * - 常规路径：块序列行数之和 + 空行投影数（投影空行不占块序列行数，
 *   由 flushReadyEmpties 额外产出）。
 *
 * @param prepared prepareLineDiff 的产出（只读）
 * @param changes executeLineDiff 的产出（只读）
 * @returns expandRows 将产出的 DiffRow 总数
 */
function computeRowsTotal(prepared: PreparedLineDiff, changes: PlannedChange[]): number {
  if (prepared.pureAddRemove) {
    return prepared.leftOrig.length + prepared.rightOrig.length + prepared.emptyRowCount
  }
  let total = prepared.emptyRowCount
  for (const change of changes) total += change.count
  return total
}

/**
 * 把 diff 块序列展开为差异行序列的同步生成器（ENG-011 重构：原
 * compareWithOptions 内联展开逻辑的逐行 yield 版本，行序 / 行号 / type 与
 * 原实现逐字节一致）。
 *
 * 展开规则（与 ENG-006 定稿语义一致，逐段对照原实现）：
 * - 空侧守卫路径（pureAddRemove）：先按序展开纯删，再纯增，空行在各游标
 *   越过其原始位置时插入（flushReadyEmpties）；
 * - 常规路径：按块顺序消费 PlannedChange，注意【不读块内容】（jsdiff 公共
 *   块只保留新侧 token），行原文与行号按双侧游标从各自侧的 orig 映射回取；
 * - ignoreEmptyLines 的空行投影队列：每产出一行前冲刷队首已就绪的空行
 *   （就绪判据 = 双侧 diff 游标都已越过该空行的原始位置；耗尽侧游标视为
 *   已越过一切），尾部再冲刷一次兜底；
 * - 超长行标记（ENG-012）：每行经 `longLineMark` 计算 `longLine`（任一侧
 *   超过 `LONG_LINE_THRESHOLD` 即 `true`，普通行不产生该键），与
 *   `diffLinesCore` 的行级标记语义一致。
 *
 * 消费方式：
 * - 同步（compareWithOptions）：`for (const row of expandRows(...)) rows.push(row)`
 *   —— 生成器逐行产出，拼接结果与内联 push 完全一致；
 * - 异步分片（compareIncremental）：逐行消费，每累计 chunkLines 行让出一次
 *   主线程 —— 生成器的惰性推进使「产到一半暂停」成为可能，且暂停点不影响
 *   行序列（产出只由块序列与游标决定，与消费节奏无关）。
 *
 * @param prepared prepareLineDiff 的产出（其 pending 队列会被本生成器原地
 *                 冲刷消费 —— 与原实现的 splice 语义一致，单次展开后即耗尽）
 * @param changes executeLineDiff 的产出（块序列，只读）
 * @returns 逐行产出的 DiffRow 序列（生成器，需消费到底）
 */
function* expandRows(
  prepared: PreparedLineDiff,
  changes: PlannedChange[],
): Generator<DiffRow, void, void> {
  const { leftLines, rightLines, leftOrig, rightOrig, pending } = prepared
  let li = 0
  let ri = 0
  // 两侧「下一个待消费 diff 元素」的原始下标（耗尽后为 MAX_SAFE_INTEGER，
  // 使任意空行约束视为已满足 —— 尾部冲刷时全部就绪）。
  const nextLeftOrig = () => (li < leftOrig.length ? leftOrig[li] : Number.MAX_SAFE_INTEGER)
  const nextRightOrig = () => (ri < rightOrig.length ? rightOrig[ri] : Number.MAX_SAFE_INTEGER)

  /** 把一个待插入空行（双侧重配对 / 单侧余量）物化为 `'equal'` 行。 */
  function* buildEmptyRow(item: PendingEmpty): Generator<DiffRow, void, void> {
    // ENG-012：投影空行也可能超长（isEmptyish 含纯空白行，> 1 万空白字符
    // 的行同样标记），双侧可缺省（undefined = 该侧不存在，跳过判定）。
    const leftText = item.left !== undefined ? leftLines[item.left] : undefined
    const rightText = item.right !== undefined ? rightLines[item.right] : undefined
    yield {
      type: 'equal',
      ...(item.left !== undefined
        ? { left: { lineNo: item.left + 1, text: leftText! } }
        : {}),
      ...(item.right !== undefined
        ? { right: { lineNo: item.right + 1, text: rightText! } }
        : {}),
      ...longLineMark(leftText, rightText),
    }
  }

  /** 冲刷队首已就绪的空行（就绪判据见函数 JSDoc「空行投影队列」）。 */
  function* flushReadyEmpties(): Generator<DiffRow, void, void> {
    let head = 0
    while (head < pending.length) {
      const item = pending[head]
      const ready =
        (item.left === undefined || nextLeftOrig() > item.left) &&
        (item.right === undefined || nextRightOrig() > item.right)
      if (!ready) break
      yield* buildEmptyRow(item)
      head += 1
    }
    pending.splice(0, head)
  }

  // 空侧守卫路径：纯删 → 纯增，空行在各游标越过其位置时插入。
  if (prepared.pureAddRemove) {
    for (const orig of leftOrig) {
      yield* flushReadyEmpties()
      yield {
        type: 'del',
        left: { lineNo: orig + 1, text: leftLines[orig] },
        ...longLineMark(leftLines[orig]),
      }
      li += 1
    }
    for (const orig of rightOrig) {
      yield* flushReadyEmpties()
      yield {
        type: 'add',
        right: { lineNo: orig + 1, text: rightLines[orig] },
        ...longLineMark(rightLines[orig]),
      }
      ri += 1
    }
    yield* flushReadyEmpties()
    return
  }

  for (const change of changes) {
    // 注意：不读块的内容（jsdiff 公共块只保留新侧 token），只用块长度确定
    // 行数，行原文按双侧游标各取各的（见函数 JSDoc）。
    const count = change.count
    if (change.added) {
      for (let k = 0; k < count; k += 1) {
        yield* flushReadyEmpties()
        const orig = rightOrig[ri]
        yield {
          type: 'add',
          right: { lineNo: orig + 1, text: rightLines[orig] },
          ...longLineMark(rightLines[orig]),
        }
        ri += 1
      }
    } else if (change.removed) {
      for (let k = 0; k < count; k += 1) {
        yield* flushReadyEmpties()
        const orig = leftOrig[li]
        yield {
          type: 'del',
          left: { lineNo: orig + 1, text: leftLines[orig] },
          ...longLineMark(leftLines[orig]),
        }
        li += 1
      }
    } else {
      for (let k = 0; k < count; k += 1) {
        yield* flushReadyEmpties()
        const lOrig = leftOrig[li]
        const rOrig = rightOrig[ri]
        // 规范化等价行的左右原文可能不同（ignoreWhitespace / ignoreCase /
        // 忽略规则），任一侧超长即标记。
        yield {
          type: 'equal',
          left: { lineNo: lOrig + 1, text: leftLines[lOrig] },
          right: { lineNo: rOrig + 1, text: rightLines[rOrig] },
          ...longLineMark(leftLines[lOrig], rightLines[rOrig]),
        }
        li += 1
        ri += 1
      }
    }
  }
  yield* flushReadyEmpties()
}

/**
 * 带对比选项的行级 diff 核心（ENG-006）：在 `diffLinesCore` 的行骨架语义上
 * 叠加三个忽略选项 —— 忽略空白（含行尾 / 全行空白）、忽略大小写、忽略空行
 * 变化。`diffLinesCore` 等价于本函数在 `DEFAULT_OPTIONS` 下的结果（三个
 * 开关全关时 comparator 退化为严格相等、无空行过滤，展开逻辑逐块一致）。
 *
 * 行为约定（对齐 `types.ts` 的 `DiffRow` 语义）：
 * - 行文本恒保留原文：规范化（`normalizeForCompare`）只用于相等性判定，
 *   各侧 `text` / `lineNo` 仍是该侧自己的原文与 1-based 行号；
 * - 「规范化等价但原文不同」的行输出为 `'equal'`（left / right 同时存在
 *   且 text 可不同），不拆成 del / add —— 这是「忽略」语义的核心；
 * - `ignoreWhitespace` / `ignoreCase`：切行后交给 `diffArrays` 并注入
 *   comparator（两侧 `normalizeForCompare` 相等即等价）；
 * - `ignoreEmptyLines`（开启时）：过滤-投影算法 —— 先把两侧 `isEmptyish`
 *   的行从 diff 输入中剔除（记录原始行号），只对非空行集做上述带
 *   comparator 的 diff；空行【永远不产生 'del' / 'add'】，投影回结果时
 *   一律输出为 `'equal'` 行：
 *   1. 左右空行按各自出现顺序两两配对（第 k 个左空行 ↔ 第 k 个右空行）
 *      → 双侧 `'equal'` 行；
 *   2. 配对余量（只有一侧才有的空行）→ 单侧 `'equal'` 行（只有 left 或
 *      只有 right，另一侧缺省）；
 *   3. 插入时机：待插入空行按配对顺序组成 FIFO 队列，队首行在其约束满足
 *      时尽早插入 —— 双侧行要求「左右两侧的 diff 游标都已越过其原始行
 *      位置」，单侧行只要求所属侧游标越过。因此空行落在变更行之间的
 *      最早可用间隙；当左右空行相对真实变更的位置错位时，落点可能相对
 *      其一侧的原始位置后移（空行不参与变更判定，这正是「忽略空行变化」
 *      的语义），但不影响「空行永不 del/add」与「空行按位置顺序配对」
 *      两条硬约定。
 *
 * 展开方式：逐块消费 diff 结果并用双侧游标从【各自侧】取原文与行号。
 * 不直接使用 `change.value` 的原因：jsdiff 对公共块只保留其中一侧的 token
 * （见 jsdiff `buildValues`），规范化等价行的左右原文可能不同，必须按游标
 * 各取各的。ENG-011 重构后本函数经共享三段链路产出（prepareLineDiff →
 * executeLineDiff → expandRows，见上方内部机制段说明），trim = false 保持
 * 既有行为不变 —— diffArrays 输入为【全量参与行集】、不裁剪公共前后缀，
 * 产出与内联实现逐字节一致（既有单测全量锁定）。
 *
 * 忽略规则（ENG-007）：入口先 `compileIgnoreRules(options.ignoreRules)`
 * 【编译一次】，非法正则 → 抛出 `RuleError`（`error` 属性携带结构化
 * `DiffError`，`kind: 'invalid-regex'` + 出错 pattern）—— 这是行级 API
 * （返回裸 `DiffRow[]`）的错误约定：无 `DiffResult` 通道可用，以异常上报；
 * 需要「不抛」通道的调用方走 `compareFull`（捕获后转写为
 * `{ ok: false, error }`）。编译成功的 regexes 传入 `normalizeForCompare`
 * 第 3 参（comparator 用），折叠顺序 = 规则替换（作用于原始行）→
 * ignoreWhitespace → ignoreCase（见 `./options.ts`）；被规则判等的行输出
 * `'equal'` 且各侧 `text` 恒保留原文。
 *
 * 边界处理：与 `diffLinesCore` 相同的幻影 token 规避 —— 任一侧「参与
 * diff 的行集」为空时不进 `diffArrays`，直接按纯删 / 纯增展开非空行
 * （开启 ignoreEmptyLines 时被剔除的空行仍按上述投影规则补回）。
 *
 * 输入规范化（ENG-010）：入口先对 left / right 各自 `normalizeText` 剥除
 * 文本开头的单个 U+FEFF 再切分 —— 行号与行文本因此不含 BOM（策略定稿见
 * `./normalize.ts`）；行尾符 / 尾部换行 / 空文本语义同 `splitLines` 契约，
 * 与下方忽略选项正交（规范化先行于逐行忽略折叠）。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @param options 对比选项（ENG-006 开关 + ENG-007 忽略规则；存在非法规则
 *                时抛 `RuleError`，见上）
 * @returns 完整展开的差异行序列（含 `'equal'` 行），行号均为 1-based
 * @throws {RuleError} `options.ignoreRules` 存在非法正则时
 */
export function compareWithOptions(left: string, right: string, options: DiffOptions): DiffRow[] {
  // ENG-007：入口统一编译忽略规则（一次编译，comparator 全程复用，避免
  // 逐行重编译）；存在非法正则时 fail-fast，不进入 diff 计算。
  // （用 `'error' in compiled` 收窄判别联合：工程 strictNullChecks 关闭，
  // TS 非严格模式下布尔判别元的否定分支（!x.ok / === false / else）不收窄，
  // 仅肯定分支与 in 检查可收窄，见 ignoreRules.ts 的返回类型。）
  const compiled = compileIgnoreRules(options.ignoreRules)
  if ('error' in compiled) {
    throw new RuleError(compiled.error)
  }
  const ruleRegexes = compiled.regexes

  // ENG-010：入口先剥 BOM（定稿策略见 ./normalize.ts）—— 行文本与行号不含 BOM。
  const leftLines = splitLines(normalizeText(left))
  const rightLines = splitLines(normalizeText(right))

  // ENG-011 重构（行为不变）：原内联实现拆为「计划（prepare + execute）→
  // 行展开（expandRows 生成器）」三段 —— compareIncremental 复用同三段做
  // 公共前后缀裁剪与分片让出；trim = false 时 prepare 不裁剪、execute 在
  // 【全量行集】上调用 diffArrays，与 ENG-011 之前的行为逐字节一致。
  const prepared = prepareLineDiff(leftLines, rightLines, options, ruleRegexes, false)
  const changes = executeLineDiff(prepared, options, ruleRegexes)
  const rows: DiffRow[] = []
  for (const row of expandRows(prepared, changes)) rows.push(row)
  return rows
}

/**
 * 把差异行序列组装为成功结果（模块内私有，ENG-001 起供 `compare` 使用）。
 *
 * 统计规则：
 * - `addedLines` / `removedLines`：`'add'` / `'del'` 行数；
 * - `modifiedPairs`：`'modify'` 行数（一对计 1；其左右两侧不计入
 *   added/removed，避免重复计数）—— 当前骨架产出方均不产 `'modify'` 行
 *   （ENG-005 配对接线归 UI-006），恒为 0，按类型分支预留；
 * - `hunkCount`：本函数恒为 0，`hunks` / `collapses` 返回空数组占位 ——
 *   `compare`（无选项入口）保持该占位行为；ENG-009 起 `compareFull` 的
 *   stats 段改用 `./stats.ts` 的 `computeStats`（hunkCount 传
 *   `hunks.length`），不再经本函数；
 * - `totalRows`：恒等于 `rows.length`。
 */
function buildDiffResult(rows: DiffRow[]): DiffResultOk {
  let addedLines = 0
  let removedLines = 0
  let modifiedPairs = 0
  for (const row of rows) {
    if (row.type === 'add') addedLines += 1
    else if (row.type === 'del') removedLines += 1
    else if (row.type === 'modify') modifiedPairs += 1
  }

  return {
    ok: true,
    rows,
    // compare 通道恒为空数组占位（ENG-008 起 compareFull 用 buildHunks 填充）。
    hunks: [],
    collapses: [],
    stats: {
      addedLines,
      removedLines,
      modifiedPairs,
      // 恒等于 hunks.length（本函数内 hunks 为空故为 0；compareFull 填充后改写）。
      hunkCount: 0,
      totalRows: rows.length,
    },
  }
}

/**
 * 把差异行序列组装为完整的成功结果（ENG-011 从 compareFull 抽出的可复用
 * 组装段，行为与原内联实现一致）：
 *
 * - `buildHunks(rows, contextLines)`（ENG-008）：投影 hunks / collapses；
 * - `computeStats(rows, hunks.length)`（ENG-009）：从 rows 单趟统计，
 *   `hunkCount` 由调用方传 `hunks.length`（恒等于 `hunks.length`，见
 *   `DiffStats` 契约）；`modifiedPairs` 语义已按契约实现：当前骨架产出方
 *   不产 'modify' 行故恒为 0，UI-006 接线 rowsWithPairing 后非零。
 *
 * `hunk.rows` 是 rows 的连续切片（共享行对象引用），`collapses` 只覆盖
 * 「两 hunk 之间」超出上下文的 equal 区段，语义见 `./hunks.ts`。
 *
 * @param rows 完整展开的差异行序列（来自 compareWithOptions /
 *             compareIncremental 的行展开段；本函数不修改）
 * @param contextLines unified hunk 的上下文行数（透传 buildHunks，默认 3）
 * @returns 五字段齐备的 `DiffResultOk`
 */
function assembleFullResult(rows: DiffRow[], contextLines: number): DiffResultOk {
  const { hunks, collapses } = buildHunks(rows, contextLines)
  return {
    ok: true,
    rows,
    hunks,
    collapses,
    stats: computeStats(rows, hunks.length),
  }
}

/**
 * 引擎统一入口 v1（ENG-001）：对比左右两段文本，返回 `DiffResult`。
 *
 * 当前（行级精度）内部直接调 `diffLinesCore`（严格比较，无选项维度 ——
 * 带选项 / 忽略规则的 UI 主入口是 `compareFull`），统计规则见
 * `buildDiffResult`。
 *
 * hunks / collapses 语义（ENG-008 起明确）：本入口【不接线】hunk 切分，
 * `hunks` / `collapses` 恒为空数组占位、`stats.hunkCount` 恒为 0（保持
 * 既有行为不变）；需要 @@ 分块与默认折叠区段的调用方请走 `compareFull`
 * （其第 4 参可调上下文行数，默认 3）。
 *
 * 错误路径：本任务只做防御式输入类型检查 —— 两侧输入非 string（正常经
 * `ComparePayload` 构造的调用不应触发）时返回
 * `{ ok: false, error: { kind: 'internal', message } }`，不抛异常打断调用方。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @returns 成功时为 `DiffResultOk`（rows / hunks / collapses / stats），
 *          防御失败时为 `DiffResultErr`（kind: 'internal'）
 */
export function compare(left: string, right: string): DiffResult {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return {
      ok: false,
      error: {
        kind: 'internal',
        message: `compare() 两侧输入必须为 string，实际收到 left: ${typeof left}, right: ${typeof right}`,
      },
    }
  }

  return buildDiffResult(diffLinesCore(left, right))
}

/* -------------------------------------------------------------------------- */
/* UI 主入口：带全部选项的 DiffResult 通道（ENG-007）                             */
/* -------------------------------------------------------------------------- */

/**
 * 带全部对比选项的引擎主入口（ENG-007；ENG-008 起追加 hunk / 折叠接线）：
 * `compare` 的选项完整版，UI 的统一调用点 —— 返回 `DiffResult` 判别联合
 * （不抛异常），支持 ENG-006 开关与 ENG-007 忽略规则的正交组合。
 *
 * 实现方式：复用 `compareWithOptions` 产出行骨架，用 `buildHunks`（ENG-008）
 * 把 rows 投影为 `hunks` / `collapses`，统计段（ENG-009）改用 `./stats.ts`
 * 的 `computeStats(rows, hunks.length)` 一次性汇总 —— `modifiedPairs` 从
 * rows 统计（当前行级骨架产出方均不产 `'modify'` 行，故恒为 0；UI-006
 * 使用 `rowsWithPairing` 产 modify 行后该值非零），`hunkCount` 由调用方
 * 传 `hunks.length`（恒等于 `hunks.length`，见 `DiffStats` 契约）。
 * `hunk.rows` 是 rows 的连续切片（共享行对象引用），`collapses` 只覆盖
 * 「两 hunk 之间」超出上下文的 equal 区段，语义见 `./hunks.ts`。
 *
 * 错误通道（ENG-007 约定）：行级 API `compareWithOptions` 遇到非法规则
 * 抛 `RuleError`（行级返回 `DiffRow[]` 无 DiffResult 通道），本函数捕获后
 * 把其 `error` 属性【原样转写】为 `{ ok: false, error }` 返回 —— UI 侧只
 * 面对 `DiffResult`，按 `error.kind === 'invalid-regex'` + `pattern`
 * 定位到具体规则提示（UI-013）。其他异常（防御式检查外的内部错误）原样
 * 上抛，不吞。
 *
 * 向后兼容：无规则、无选项（`DEFAULT_OPTIONS`）时 rows 与其余统计和
 * `compare` 的结果深度一致（`compareWithOptions` 在三关全关 + 无规则下
 * comparator 退化为严格相等、无空行过滤，展开逻辑逐块一致；测试显式断言）。
 * 差异仅在于 ENG-008 的投影字段：本函数填充 `hunks` / `collapses` /
 * `stats.hunkCount`，而 `compare` 恒为空占位（全 equal 输入下两者仍完全
 * 一致 —— 无变更即无 hunk 也无折叠）。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @param options 对比选项（ENG-006 开关 + ENG-007 忽略规则）
 * @param contextLines unified hunk 的上下文行数（ENG-008，默认 3，可调；
 *                     ≤ 0 按 0 处理，hunk 紧贴变更行）
 * @returns 成功 → `DiffResultOk`；存在非法忽略规则 →
 *          `DiffResultErr`（`kind: 'invalid-regex'`，含出错的 pattern，
 *          不抛异常）；输入非 string → `DiffResultErr`（`kind: 'internal'`，
 *          对齐 `compare` 的防御约定）；输入超过大文本上限（ENG-011，默认
 *          5MB / 10 万行）→ `DiffResultErr`（`kind: 'too-large'`，在规则
 *          编译与 diff 计算之前短路返回，actual / limit 字段见
 *          `./guards.ts`）
 */
export function compareFull(
  left: string,
  right: string,
  options: DiffOptions,
  contextLines = 3,
): DiffResult {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return {
      ok: false,
      error: {
        kind: 'internal',
        message: `compareFull() 两侧输入必须为 string，实际收到 left: ${typeof left}, right: ${typeof right}`,
      },
    }
  }

  // ENG-011：大文本防护 —— 限制检查【先行于规则编译与一切 diff 计算】：
  // 超限直接返回 too-large，不编译忽略规则、不切行、不进 diffArrays。
  // 检查顺序可由「非法规则 + 超限输入」用例验证：返回的是 too-large 而非
  // invalid-regex。侧别定位方式见 ./guards.ts checkPairLimits 的说明。
  const limitError = checkPairLimits(left, right)
  if (limitError !== null) {
    return { ok: false, error: limitError }
  }

  try {
    // ENG-009：统计段统一走 computeStats（从 rows 单趟统计，hunkCount 由
    // 调用方传 hunks.length），组装段抽为 assembleFullResult 供
    // compareIncremental 复用（ENG-011）。
    const rows = compareWithOptions(left, right, options)
    return assembleFullResult(rows, contextLines)
  } catch (error) {
    // 只转写规则错误（结构化信息在 error 属性上）；其余异常非契约内错误，
    // 原样上抛交由上层兜底。
    if (error instanceof RuleError) {
      return { ok: false, error: error.error }
    }
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* 异步分块对比入口（ENG-011：分片让出主线程 + 公共前后缀裁剪）                    */
/* -------------------------------------------------------------------------- */

/**
 * 行展开的默认分片行数（ENG-011）：行展开每累计这么多行让出一次主线程。
 * 5000 行在常规行高下约对应一屏到数屏内容，分片粒度足够让 UI 保持响应，
 * 又不至于让让出开销（每片一次调度）占比过高。
 */
export const DEFAULT_CHUNK_LINES = 5000

/**
 * compareIncremental 的阶段进度（`onProgress` 的事件对象）。
 *
 * `done` / `total` 均按【行】计数，同一阶段内 `done` 单调不减、最终事件
 * 恒为 `done === total`；阶段按 `diff → rows → hunks` 顺序各上报一组
 * 起点（done: 0）与终点（done: total）事件：
 * - `diff`：jsdiff diffArrays 计算热点，total = 裁剪后进入 differ 的中间
 *   行数之和（空侧守卫路径为 0）；起点事件在计算前上报、终点在计算后
 *   —— 迁移 Web Worker 后这两点正好框住「等待 Worker 回包」的区间；
 * - `rows`：行展开，total = 精确总行数（含 ignoreEmptyLines 的投影空行，
 *   见 computeRowsTotal）；每累计 chunkLines 行上报一次中间进度；
 * - `hunks`：hunk / 折叠 / 统计组装，total = 行展开产出的总行数。
 */
export interface IncrementalProgress {
  /** 当前阶段。 */
  phase: 'diff' | 'rows' | 'hunks'
  /** 已完成的行数（按阶段语义见类型说明）。 */
  done: number
  /** 该阶段的总行数。 */
  total: number
}

/**
 * compareIncremental 的可选配置（全部缺省即「默认分片 + 默认调度器 +
 * 不上报进度」）。
 */
export interface CompareIncrementalOpts {
  /**
   * 行展开分片行数（每累计这么多行让出一次主线程；缺省
   * `DEFAULT_CHUNK_LINES` = 5000）。非正数 / 非整数按 1 处理（防御式
   * 归一，等价于逐行让出的最慢路径）。
   */
  chunkLines?: number
  /**
   * 让出调度器（可注入）：收到一个「继续」回调，应在主线程空闲时调用它
   * （缺省特性检测：`requestIdleCallback` 可用则走空闲回调，否则退化为
   * `setTimeout(cb, 0)`）。测试注入同步直接调用（`(cb) => cb()`）即可
   * 让整个计算在单个微任务序列内完成。
   */
  scheduler?: (cb: () => void) => void
  /** 阶段进度回调（事件语义见 `IncrementalProgress`；缺省不上报）。 */
  onProgress?: (p: IncrementalProgress) => void
  /**
   * unified hunk 的上下文行数（ENG-008，缺省 3）：与 `compareFull` 的第 4
   * 参同义，供两通道做深度一致性验证时对齐。
   */
  contextLines?: number
}

/**
 * 解析让出调度器（ENG-011 调度策略的单一出口）：
 * 1. 注入优先：传入了 `injected` 直接原样返回（测试注入同步调度器、
 *    UI 注入自定义节流策略都走这条路）；
 * 2. 特性检测：`typeof requestIdleCallback === 'function'`（浏览器环境）
 *    → 包一层空闲回调（`requestIdleCallback(() => cb())`，继续回调在
 *    空闲时段执行，不与渲染争帧）；
 * 3. 兜底：Node / 老环境无 `requestIdleCallback` → `setTimeout(cb, 0)`
 *    （宏任务让出，至少把事件循环还给渲染与输入）。
 *
 * 特性检测读取的是调用时的全局绑定（裸标识符运行时查找），测试可通过
 * 设置 / 删除 `globalThis.requestIdleCallback` 验证两个分支。
 *
 * @param injected 注入的调度器（可选）
 * @returns 可直接调用的调度器（`cb` 保证最终被调用，同步或异步）
 */
export function resolveScheduler(injected?: (cb: () => void) => void): (cb: () => void) => void {
  if (injected !== undefined) return injected
  return typeof requestIdleCallback === 'function'
    ? (cb) => {
        requestIdleCallback(() => cb())
      }
    : (cb) => {
        setTimeout(cb, 0)
      }
}

/**
 * 异步分块对比入口（ENG-011）：`compareFull` 的分片异步版 —— 行级骨架与
 * compareFull 共享同一条产出链路（prepareLineDiff → executeLineDiff →
 * expandRows → assembleFullResult），在链路各段之间按调度器让出主线程，
 * 避免大文本对比长时间阻塞 UI。
 *
 * 放在 diff.ts 而非 guards.ts 的理由：它与 compareFull 共享组装链路的全部
 * 内部辅助（裁剪 / 行展开 / hunk 统计组装），且 guards.ts 是近叶子模块
 * （diff.ts → guards.ts → normalize.ts 的单向依赖）—— 若把本函数放进
 * guards.ts 会构成 guards ↔ diff 循环依赖。
 *
 * 处理流程（三阶段，onProgress 依次上报）：
 * 1. `'diff'`：公共前后缀裁剪（O(n) 廉价扫描）+ jsdiff diffArrays 计算
 *    （唯一热点，见 executeLineDiff 的 Worker 迁移点说明）；
 * 2. `'rows'`：行展开，按 `chunkLines`（默认 5000 行）分片，片间让出；
 * 3. `'hunks'`：hunk / 折叠 / 统计组装（与 compareFull 共享
 *    assembleFullResult，行为一致）。
 *
 * 公共前后缀裁剪（真实算法优化）：normalizeText + splitLines（及
 * ignoreEmptyLines 过滤）后，O(n) 找两侧参与行集的【严格相等】最长公共
 * 前缀与后缀（前缀 + 后缀不重叠），只有中间部分进 diffArrays；前缀裁剪
 * 无条件安全（jsdiff 起始公共蛇分解的等价改写），后缀裁剪仅在无跨区等价
 * 可能时应用（suffixTrimSafe 的充分安全条件）—— 裁剪结果与不裁剪深度
 * 一致（单测锁定，含确定性模糊测试）。裁剪后中间为空的特例直接按纯
 * equal / 纯增 / 纯删合成块序列，不进 differ。
 *
 * 与 compareFull 的深度一致性：同一输入 + 选项 + 上下文行数下，本函数的
 * `DiffResultOk`（rows / hunks / collapses / stats）与 `compareFull` 逐
 * 字段相等 —— 行级骨架只有一条产出链路，本函数只是改变了消费节奏
 * （分片让出）与 differ 输入（裁剪，等价改写）；单测以多组固定用例 +
 * 种子化模糊测试锁定。
 *
 * 错误通道（与 compareFull 对齐，全部「不抛」）：
 * - 输入超限（ENG-011，默认 5MB / 10 万行）→ `{ ok: false, error: too-large }`
 *   在规则编译与一切计算之前返回（入口首段让出都不做）；
 * - 非法忽略规则 → `{ ok: false, error: invalid-regex }`（行级 API 的
 *   RuleError 在本入口被转写为 DiffResult 错误结果）；
 * - 输入非 string → `{ ok: false, error: internal }`（防御式检查）；
 * - 其余内部异常沿 Promise 拒绝上抛（与 compareFull 的「不吞」一致）。
 *
 * 【Worker 迁移点预留】整条链路中唯一无法分片的同步热点是 executeLineDiff
 * 里的 diffArrays 调用（jsdiff Myers 为整体算法，不可中途中断）。未来迁移
 * Web Worker 时：把 executeLineDiff 的调用替换为 postMessage 往返（入参
 * 行集切片 + 选项 + 编译规则、出参 PlannedChange[] 均为可结构化克隆的
 * 纯数据），其余链路 —— 裁剪（prepareLineDiff）、行展开（expandRows）、
 * hunk / 统计组装（assembleFullResult）、调度与进度上报 —— 原样复用：
 * 行展开的分片让出改为等待 Worker 回包后的展开即可，'diff' 阶段的起点 /
 * 终点进度事件天然框住等待区间。本函数的入参（字符串 + 选项 + 配置）与
 * 出参（DiffResult）也均为纯数据，Worker 化不影响调用方契约。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @param options 对比选项（ENG-006 开关 + ENG-007 忽略规则；缺省
 *                `DEFAULT_OPTIONS` = 严格比较）
 * @param opts 分片与调度配置（分片行数 / 调度器 / 进度回调 / 上下文行数，
 *             全部可选，见 `CompareIncrementalOpts`）
 * @returns 成功 → `DiffResultOk`（与 compareFull 深度一致）；失败 →
 *          `DiffResultErr`（too-large / invalid-regex / internal，见上）
 */
export async function compareIncremental(
  left: string,
  right: string,
  options: DiffOptions = DEFAULT_OPTIONS,
  opts: CompareIncrementalOpts = {},
): Promise<DiffResult> {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return {
      ok: false,
      error: {
        kind: 'internal',
        message: `compareIncremental() 两侧输入必须为 string，实际收到 left: ${typeof left}, right: ${typeof right}`,
      },
    }
  }

  // ENG-011：限制检查先行（同 compareFull：先于规则编译与一切计算，超限
  // 连入口的首轮让出都不做），超限 → too-large 错误结果，不抛。
  const limitError = checkPairLimits(left, right)
  if (limitError !== null) {
    return { ok: false, error: limitError }
  }

  // ENG-007：规则编译一次（非法规则经 DiffResult 通道返回，不抛 —— 对齐
  // compareFull 对 RuleError 的转写行为）。
  const compiled = compileIgnoreRules(options.ignoreRules)
  if ('error' in compiled) {
    return { ok: false, error: compiled.error }
  }
  const ruleRegexes = compiled.regexes

  const scheduler = resolveScheduler(opts.scheduler)
  const chunkLines = Math.max(1, Math.floor(opts.chunkLines ?? DEFAULT_CHUNK_LINES))
  const contextLines = opts.contextLines ?? 3

  // 进度上报（同键去重：同一 phase:done:total 只报一次，保证 done 单调且
  // 不出现重复事件；onProgress 缺省时为零开销直通）。
  const onProgress = opts.onProgress
  let lastReportKey = ''
  const report = (phase: IncrementalProgress['phase'], done: number, total: number) => {
    if (onProgress === undefined) return
    const key = `${phase}:${done}:${total}`
    if (key === lastReportKey) return
    lastReportKey = key
    onProgress({ phase, done, total })
  }
  // 让出主线程：经调度器调度 resolve —— 注入同步调度器时在微任务序列内
  // 继续（测试确定性）；默认调度器（requestIdleCallback / setTimeout）时
  // 真正还给主线程一个空闲时段 / 一个事件循环轮次。
  const yieldToMain = (): Promise<void> =>
    new Promise<void>((resolve) => {
      scheduler(resolve)
    })

  // 入口先让出一次：调用方（UI）有机会在首轮计算前渲染「计算中」状态。
  await yieldToMain()

  // ENG-010：入口先剥 BOM 再切分（与 compareWithOptions 同一口径）。
  const leftLines = splitLines(normalizeText(left))
  const rightLines = splitLines(normalizeText(right))

  // 'diff' 阶段：裁剪等廉价预处理 → 上报起点 → 让出 → jsdiff 计算（热点）
  // → 上报终点。让出点放在热点之前，是本函数防阻塞的关键位置。
  const prepared = prepareLineDiff(leftLines, rightLines, options, ruleRegexes, true)
  report('diff', 0, prepared.diffLinesTotal)
  await yieldToMain()
  const changes = executeLineDiff(prepared, options, ruleRegexes)
  report('diff', prepared.diffLinesTotal, prepared.diffLinesTotal)

  // 'rows' 阶段：行展开按 chunkLines 分片，片间让出（expandRows 为惰性
  // 生成器，暂停点不影响行序列，见其 JSDoc）。
  const rowsTotal = computeRowsTotal(prepared, changes)
  const rows: DiffRow[] = []
  let done = 0
  report('rows', 0, rowsTotal)
  for (const row of expandRows(prepared, changes)) {
    rows.push(row)
    done += 1
    if (done % chunkLines === 0) {
      report('rows', done, rowsTotal)
      await yieldToMain()
    }
  }
  // 内部不变量自检：行展开数必须与计划一致（expandRows 与 computeRowsTotal
  // 共享计数口径；不一致说明引擎内部不变量被破坏，走 internal 兜底）。
  if (done !== rowsTotal) {
    return {
      ok: false,
      error: {
        kind: 'internal',
        message: `compareIncremental() 行展开数与计划不一致：计划 ${rowsTotal} 行，实际 ${done} 行`,
      },
    }
  }
  report('rows', rowsTotal, rowsTotal)

  // 'hunks' 阶段：hunk / 折叠 / 统计组装（与 compareFull 共享组装辅助）。
  report('hunks', 0, rows.length)
  await yieldToMain()
  const result = assembleFullResult(rows, contextLines)
  report('hunks', rows.length, rows.length)
  return result
}

/* -------------------------------------------------------------------------- */
/* 词级 / 字符级精度出口（ENG-003：与行级骨架统一产出 DiffRow[]）                  */
/* -------------------------------------------------------------------------- */

/**
 * 词级精度出口（ENG-003）：行级骨架 + 替换区域内的词级（CJK 感知）行内高亮。
 *
 * 实现方式：先用 `diffLinesCore` 产出与行级精度完全一致的行骨架
 * （行序 / 行号 / type 不变），再经 `applyInlineSpans`（granularity
 * `'word'`）对「连续 del 块紧跟连续 add 块」的区域按块内位置一一配对，
 * 逐对调用 ENG-002 tokenizer + `computeSpans` 计算行内 token 差异，
 * 填入 del 行的 `left.words` 与 add 行的 `right.words`。`'equal'` 行与
 * 配对剩余的尾部行不填 `words`。
 *
 * 配对策略说明：当前为「位置配对」（块内下标相同即配对，不做相似度
 * 判断）。ENG-004「智能」精度（整行等价但词不同的降级等策略）与
 * ENG-005 相似行配对（LCS / 相似度阈值）后续将替换 `applyInlineSpans`
 * 的配对策略，本出口的签名与输出形状保持不变。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @returns 与 `diffLinesCore` 骨架一致的 `DiffRow[]`，替换区域内带行内 `words`
 */
export function diffWordPrecision(left: string, right: string): DiffRow[] {
  return applyInlineSpans(diffLinesCore(left, right), 'word')
}

/**
 * 字符级精度出口（ENG-003）：行级骨架 + 替换区域内的字符级（逐 code point）
 * 行内高亮。
 *
 * 与 `diffWordPrecision` 唯一差异是 `applyInlineSpans` 的粒度为 `'char'`
 * （tokenize 用 ENG-002 的 `tokenizeChars`，逐 Unicode code point，空白
 * 不合并），因此单词内部的字符改动只标红对应字符而不是整词。其余行为
 * （行骨架一致、位置配对、尾部弃配、不可变风格）与 `diffWordPrecision`
 * 完全相同，配对策略的后续演进（ENG-004/005）也同上。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @returns 与 `diffLinesCore` 骨架一致的 `DiffRow[]`，替换区域内带行内 `words`
 */
export function diffCharPrecision(left: string, right: string): DiffRow[] {
  return applyInlineSpans(diffLinesCore(left, right), 'char')
}

/* -------------------------------------------------------------------------- */
/* 智能精度与缓存会话出口（ENG-004：实现在 ./precision.ts，此处统一再导出）        */
/* -------------------------------------------------------------------------- */

/**
 * ENG-004 的智能精度策略层（`diffSmartPrecision` / 缓存会话
 * `createDiffSession` / `defaultSession` / `getDiffRows` 等）依赖本文件的
 * `diffLinesCore` 与 `./inline` 的 `applyInlineSpans`（单向依赖），在此做
 * 名字再导出，让 UI 与后续模块继续从本文件单一入口 import 全部精度出口
 * （ESM `export *` 对同名导出自动让位于本文件自身的导出，无冲突）。
 */
export * from './precision'
