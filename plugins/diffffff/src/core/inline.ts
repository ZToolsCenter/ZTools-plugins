/**
 * ============================================================================
 * 词级 / 字符级行内 diff（roadmap 任务 ENG-003）
 * ============================================================================
 *
 * 在 ENG-001 行级骨架与 ENG-002 tokenizer 之上实现「行内差异定位」：对
 * 「连续 del 行块紧跟连续 add 行块」的替换区域，把区域内的行按块内位置
 * 一一配对，对每一对的两侧文本做 token 级 diff，产出 `WordDiffSpan[]`
 * 填入 `DiffRow` 的 `left.words` / `right.words`，供 UI-006 做行内高亮。
 *
 * 三类精度统一产出 `DiffRow[]`（行序 / 行号 / type 完全一致）：
 * - 行级（ENG-001 `diffLinesCore`）：只产出行骨架，不填 `words`；
 * - 词级 / 字符级（本模块）：在行骨架上追加 `words`，骨架本身不变；
 * - 「智能」精度（ENG-004）与相似行配对升级（ENG-005）后续将替换
 *   `applyInlineSpans` 的配对策略（本任务为 del/add 块内按位置一一配对，
 *   不做相似度判断），输出形状与本骨架保持不变。
 *
 * 不变量（对齐 `types.ts` 中 `WordDiffSpan` 的拼接契约）：
 * - 每侧 spans 按序拼接（`map(s => s.text).join('')`）恒等于该侧文本
 *   （tokenizer 铁律 `tokens.join('') === text` 的直接推论：块级合并
 *   只是把相邻 token 拼进同一个 span，不丢任何字符）；
 * - `changed === true` 的 span 只来源于 removed 块（左侧）/ added 块
 *   （右侧），equal 块两侧恒为 `false` —— 左右两侧的 changed 标记按
 *   「同一 token 序号位置」互斥对齐。
 *
 * 硬性约束：
 * - 零 UI 依赖、零 DOM、零 store 依赖：只允许 import `diff` 包、
 *   `./tokenizer.ts`、`./ignoreRules.ts`（ENG-007 规则编译原语）、
 *   `./options.ts`（ENG-006 规范化比较辅助，仅类型 + 纯函数）与
 *   `./types.ts`（对齐 ENG-001/002 的引擎层约束）；
 * - 不可变风格：`applyInlineSpans` 返回新数组新对象，不原地改入参。
 * ============================================================================
 */

import { diffArrays } from 'diff'
import { compileIgnoreRules } from './ignoreRules'
import { normalizeForCompare, type CompareOptions } from './options'
import { tokenizeChars, tokenizeWords } from './tokenizer'
import type { DiffRow, WordDiffSpan } from './types'

/* -------------------------------------------------------------------------- */
/* computeSpans：两段文本的 token 级行内差异                                    */
/* -------------------------------------------------------------------------- */

/** 全关比较选项（模块内私有）：仅显式传入 `regexes` 而未传 options 时兜底用，
 *  语义 = 只应用规则、不做空白 / 大小写折叠。 */
const NO_NORMALIZE_OPTIONS: CompareOptions = { ignoreWhitespace: false, ignoreCase: false }

/**
 * 从比较选项解析忽略规则并编译（ENG-007，模块内私有）。
 *
 * 返回约定：
 * - `undefined` = 无需应用规则（未传 options / 无启用规则），下游 comparator
 *   与 ENG-006 时代逐字节一致；
 * - 数组（可能为空）= 规则已解析：空数组用于显式短路下游的重复兜底编译
 *   （存在启用规则但编译失败时规则被跳过 —— 本函数不承担错误上报职责，
 *   非法正则由行级入口 `compareWithOptions`（抛 `RuleError`）与
 *   `compareFull`（返回 invalid-regex）负责，见 `./ignoreRules.ts`）。
 */
function resolveRuleRegexes(options?: CompareOptions): RegExp[] | undefined {
  const rules = options?.ignoreRules
  if (rules === undefined || !rules.some((rule) => rule.enabled)) return undefined
  const compiled = compileIgnoreRules(rules)
  return compiled.ok ? compiled.regexes : []
}

/**
 * 计算两段文本的行内 token 级差异（ENG-003 核心，`applyInlineSpans` 的
 * 单行配对单元）。
 *
 * 实现方式：按 `granularity` 选 ENG-002 的 tokenizer —— `'word'` 用
 * `tokenizeWords`（CJK 逐字成 token，让没有空格的中文也具备词粒度定位
 * 能力；拉丁词 / 数字串 / 空白按 ENG-002 规则切分），`'char'` 用
 * `tokenizeChars`（逐 Unicode code point）。两侧 token 数组交给 jsdiff
 * 的 `diffArrays` 分块，再按块归并成 spans：一个 diff 块 = 一个 span
 * （相邻同类 token 合并）。
 *
 * 比较方式（ENG-006/007）：不带 `options`（或开关全关且无规则）时为严格
 * 相等 `===`（ENG-003 既有行为）；带比较选项时经 `diffArrays` 的
 * `comparator` 注入「规范化后相等」的比较 —— 两侧 token 先应用忽略规则
 * 替换（ENG-007，token 级 replaceAll：规则命中在词 / 字符粒度同样生效，
 * 单 token 内命中的片段被删除后再比较），再经 `normalizeForCompare` 折叠，
 * 相等即等价：
 * - `ignoreRules`：token 内 / 整 token 命中用户正则的片段从比较文本中删除
 *   （规则替换作用于【原始 token】，原文 token 仍按原样保留在 spans 中）；
 * - `ignoreWhitespace`：空白 token（word 粒度的连续空白段 / char 粒度的
 *   单个空白字符）互相视为相等 —— 它们在 tokenizer 产出中本就无损保留，
 *   此处只在比较层忽略其差异；
 * - `ignoreCase`：小写比较（`'Hello'` 与 `'hello'` 等价）。
 * 被视为等价的 token 文本仍按原样保留在 spans 中用于展示。
 *
 * 块 → span 的映射规则：
 * - equal 块 → 两侧各一个 `{ text, changed: false }`；
 * - removed 块 → 仅左侧一个 `{ text, changed: true }`；
 * - added 块 → 仅右侧一个 `{ text, changed: true }`。
 *   token 级分块中 added / removed 块的先后顺序不保证（jsdiff 按其对齐
 *   策略输出），但二者去向不同侧，按块顺序归并不受影响。
 *
 * 不变量：
 * - `left` / `right` spans 各自按序拼接恒等于 `leftText` / `rightText`
 *   （tokenizer 无损拼接铁律的直接推论，规则替换只在比较层、不参与
 *   spans 文本产出，测试显式断言）；
 * - `changed: true` 只出现在 removed（左）/ added（右）块产出的 span 上，
 *   equal 块两侧恒为 `false`。
 *
 * 实现细节（ENG-006 改造点）：块的展开用双侧游标从【各自侧】token 数组
 * 取文本（`leftTokens.slice(li, li + count)` / `rightTokens.slice(...)`），
 * 而不是直接 `change.value.join('')` —— jsdiff 对公共块只保留新侧 token
 * （见 jsdiff `buildValues`），规范化等价的 token 左右原文可能不同（如
 * `'Hello'` vs `'hello'`、`' '` vs `'\t'`），若公共块两侧都取新侧文本会
 * 破坏左侧的拼接恒等式。游标取法下不带 options 的行为与旧实现逐字节一致。
 *
 * 空侧边界：ENG-002 的 tokenizer 对空串返回空 token 数组；实测 jsdiff
 * v9 的 `diffArrays` 对空数组输入产出干净的纯增 / 纯删块（无幻影空
 * token，见下方的空 span 防御），与「空文本」场景天然衔接，无需像
 * ENG-001 那样绕开空侧。
 *
 * @param leftText 左侧文本（通常是配对成功的一对 del / add 行的行文本）
 * @param rightText 右侧文本（同上）
 * @param granularity token 粒度：`'word'`（CJK 感知词级）/ `'char'`（字符级）
 * @param options 可选比较选项（ENG-006/007）：读取 `ignoreWhitespace` /
 *                `ignoreCase` / `ignoreRules`；缺省（或全关且无规则）为
 *                严格相等 —— 行为与 ENG-003 完全一致
 * @param regexes 已编译忽略规则（ENG-007，可选，性能参数）：来自
 *                `compileIgnoreRules(...).regexes`，由 `applyInlineSpans`
 *                对整个骨架编译一次后传入，避免逐 token 对重编译；
 *                `undefined` = 按 options 兜底解析（慢路径，逐次调用都会
 *                重新编译），空数组 = 显式无规则
 * @returns 两侧的行内差异 spans；两侧均为空文本时两个数组皆为空
 */
export function computeSpans(
  leftText: string,
  rightText: string,
  granularity: 'word' | 'char',
  options?: CompareOptions,
  regexes?: RegExp[],
): { left: WordDiffSpan[]; right: WordDiffSpan[] } {
  const tokenize = granularity === 'word' ? tokenizeWords : tokenizeChars
  const leftTokens = tokenize(leftText)
  const rightTokens = tokenize(rightText)

  // ENG-007：token 比较前先应用忽略规则替换（token 级 replaceAll）。
  const ruleRegexes = regexes !== undefined ? regexes : resolveRuleRegexes(options)
  const hasRules = ruleRegexes !== undefined && ruleRegexes.length > 0
  const diffOptions =
    options !== undefined || hasRules
      ? {
          comparator: (a: string, b: string) =>
            normalizeForCompare(a, options ?? NO_NORMALIZE_OPTIONS, ruleRegexes) ===
            normalizeForCompare(b, options ?? NO_NORMALIZE_OPTIONS, ruleRegexes),
        }
      : undefined

  const left: WordDiffSpan[] = []
  const right: WordDiffSpan[] = []

  /**
   * 块 → span 追加（含空 span 防御）：tokenizer 产出的 token 恒非空串，
   * 因此空 span 只可能来自 jsdiff 的空值块（旧版本对空数组输入的幻影
   * token 行为，见 ENG-001 diffLinesCore JSDoc「边界处理」）。防御性
   * 跳过空文本 span：既不破坏拼接恒等式（拼上空串等于没拼），也保证
   * 输出中不出现无意义的空高亮片段。
   */
  const pushSpan = (spans: WordDiffSpan[], text: string, changed: boolean) => {
    if (text !== '') spans.push({ text, changed })
  }

  let li = 0
  let ri = 0
  for (const change of diffArrays(leftTokens, rightTokens, diffOptions)) {
    // 块大小取 value.length（与 count 恒等）；文本按双侧游标各取各的，
    // 保证规范化等价 token 的原文不串侧（见函数 JSDoc「实现细节」）。
    const count = change.value.length
    if (change.added) {
      // 新增块：只进右侧。
      pushSpan(right, rightTokens.slice(ri, ri + count).join(''), true)
      ri += count
    } else if (change.removed) {
      // 删除块：只进左侧。
      pushSpan(left, leftTokens.slice(li, li + count).join(''), true)
      li += count
    } else {
      // 公共块：两侧都有（token 经 comparator 规范化等价，原文可不同）。
      pushSpan(left, leftTokens.slice(li, li + count).join(''), false)
      li += count
      pushSpan(right, rightTokens.slice(ri, ri + count).join(''), false)
      ri += count
    }
  }

  return { left, right }
}

/* -------------------------------------------------------------------------- */
/* applyInlineSpans：把行内差异填到行级骨架上                                    */
/* -------------------------------------------------------------------------- */

/**
 * 在行级骨架上追加行内词级 / 字符级高亮数据（ENG-003 精度主入口）。
 *
 * 处理流程：
 * 1. 顺序扫描行骨架，定位「连续 del 行块紧跟连续 add 行块」的替换区域。
 *    jsdiff 的分块输出保证同一替换区域内 removed 块先于 added 块出现，
 *    因此 del 块总是先于与之相邻的 add 块（见 ENG-001 `diffLinesCore`）；
 * 2. 区域内按块内位置一一配对（第 i 个 del 行 ↔ 第 i 个 add 行），对每
 *    一对调用 `computeSpans`，把结果填到两侧行：del 行填 `left.words`，
 *    add 行填 `right.words`；
 * 3. 配对剩余的尾部（del 块比 add 块长，或反之）保持原样不填 `words` ——
 *    位置配对无法为其找到对应行，语义升级（相似行配对）留给 ENG-005；
 * 4. `'equal'` 行、纯 add / 纯 del（后面没有紧跟 add / 前面没有 del 块，
 *    即无配对区域）一律不填 `words`。
 *
 * 配对策略说明：本任务为「位置配对」——块内下标相同即配对，不做相似度
 * 判断（del 块与 add 块行数不等时多余行弃配）。ENG-004「智能」精度与
 * ENG-005 相似行配对（LCS / 相似度阈值产出 `LinePair`）后续将替换这里的
 * 配对策略；行骨架（行序 / 行号 / type）与本函数的输出形状保持不变。
 *
 * 忽略规则（ENG-007）：`options.ignoreRules` 在本函数入口经
 * `compileIgnoreRules` 【编译一次】（避免逐 token 对重编译），沿
 * `computeSpans` 第 5 参下发 —— 规则在 token 粒度同样生效（词 / 字符
 * 粒度命中用户正则的片段不参与比较，原文保留在 spans 中）。编译失败的
 * 规则在此被跳过（错误上报职责在行级入口 `compareWithOptions` /
 * `compareFull`，见 `./ignoreRules.ts` 的错误约定）。
 *
 * 不可变风格：返回新数组，且每一行都是新行对象（`{ ...row }` 浅拷贝）；
 * 填了 `words` 的行会同时新建对应的 side 对象（`{ ...side, words }`），
 * 其余嵌套对象与入参共享引用——本函数从不修改入参的任何对象。
 *
 * @param rows 行级骨架（通常来自 `diffLinesCore` / `compareWithOptions`；
 *             若入参行已带 `words`，结果行会携带重新计算的 `words`，
 *             入参本身仍不被修改）
 * @param granularity 行内 diff 粒度：`'word'`（CJK 感知词级）/ `'char'`（字符级）
 * @param options 可选比较选项（ENG-006/007）：原样透传给 `computeSpans`
 *                （含 `ignoreRules`，规则在本函数入口编译一次），
 *                缺省为严格相等 —— 行为与 ENG-003 完全一致（向后兼容）
 * @returns 追加了行内 `words` 的新 `DiffRow[]`；行序 / 行号 / type 与入参一致
 */
export function applyInlineSpans(
  rows: DiffRow[],
  granularity: 'word' | 'char',
  options?: CompareOptions,
): DiffRow[] {
  // ENG-007：整个骨架只编译一次忽略规则，经第 5 参传给每次 computeSpans
  //（undefined = 无启用规则；[] = 有启用规则但编译失败，显式短路下游兜底）。
  const ruleRegexes = resolveRuleRegexes(options)

  const result: DiffRow[] = []

  let i = 0
  while (i < rows.length) {
    const row = rows[i]

    // 非 del 行（equal / add / 将来的 modify 等）：不在配对区域头部，
    // 原样浅拷贝进入结果（add 行只可能与前方的 del 块配对，已在下方处理）。
    if (row.type !== 'del') {
      result.push({ ...row })
      i += 1
      continue
    }

    // 收集连续 del 块（jsdiff 保证其后再出现的一定不是 del，除非隔了
    // equal / add —— 隔断后的 del 属于下一个区域，由后续循环处理）。
    const delBlock: DiffRow[] = []
    while (i < rows.length && rows[i].type === 'del') {
      delBlock.push(rows[i])
      i += 1
    }

    // del 块之后紧跟的连续 add 块（若有）构成一个替换区域。
    const addBlock: DiffRow[] = []
    while (i < rows.length && rows[i].type === 'add') {
      addBlock.push(rows[i])
      i += 1
    }

    // 纯删除区域（del 块后面没有紧跟 add 块）：无配对对象，整块原样保留。
    if (addBlock.length === 0) {
      for (const delRow of delBlock) result.push({ ...delRow })
      continue
    }

    // 位置一一配对：第 k 个 del ↔ 第 k 个 add；多余尾部弃配（不填 words）。
    const pairCount = Math.min(delBlock.length, addBlock.length)
    const pairSpans: Array<{ left: WordDiffSpan[]; right: WordDiffSpan[] }> = []
    for (let k = 0; k < pairCount; k += 1) {
      const delRow = delBlock[k]
      const addRow = addBlock[k]
      pairSpans.push(
        computeSpans(delRow.left!.text, addRow.right!.text, granularity, options, ruleRegexes),
      )
    }

    for (let k = 0; k < delBlock.length; k += 1) {
      const delRow = delBlock[k]
      if (k < pairCount) {
        result.push({ ...delRow, left: { ...delRow.left!, words: pairSpans[k].left } })
      } else {
        result.push({ ...delRow })
      }
    }
    for (let k = 0; k < addBlock.length; k += 1) {
      const addRow = addBlock[k]
      if (k < pairCount) {
        result.push({ ...addRow, right: { ...addRow.right!, words: pairSpans[k].right } })
      } else {
        result.push({ ...addRow })
      }
    }
  }

  return result
}
