/**
 * ============================================================================
 * 输入规范化与边界诊断元数据（roadmap 任务 ENG-010）
 * ============================================================================
 *
 * 定稿本插件的输入规范化策略（single source of truth；`./types.ts` 的
 * `ComparePayload` 注释与 `./diff.ts` 的入口接线注释均指向本文件），并给 UI
 * 提供与 diff 结果正交的边界诊断元数据。策略总纲：
 *
 * 1. **BOM**：仅剥除文本开头的一个 U+FEFF（`normalizeText`）。比较与展示
 *    管线都剥除 —— BOM 不可见，保留会造成幻影首行差异（两侧仅 BOM 有无
 *    不同时会产出一整行幻影差异）。UTF-16 BOM（FF FE / FE FF）不做二进制
 *    级处理：本插件输入以字符串形态到达，preload 解码时已处理。
 * 2. **行尾符**：CRLF / LF / CR 统一按行切分（切分契约见 `./diff.ts` 的
 *    `splitLines`，本文件以同一契约本地实现，见下方说明），行内容不含
 *    行尾符 → 混用行尾符不产生差异。
 * 3. **尾部换行有无**：归一化为等价（`'a\n'` ≡ `'a'`）。理由：粘贴文本的
 *    尾部换行差异是最常见的噪声源，行号与展示模型不受影响；同时以
 *    `NormalizedInput.endsWithNewline` 与 `analyzeInputPair` 的
 *    `trailingNewlineDiffers` 元数据供 UI 未来展示「尾部换行不一致」提示徽标。
 * 4. **0 字节 / 空文本**：`''` 与 `''` → 0 行、无差异；`''` 与非空 →
 *    纯增 / 纯删（引擎侧空侧守卫见 `./diff.ts` 的 `diffLinesCore`）。
 *
 * 接线方式：`./diff.ts` 的引擎入口（`diffLinesCore` / `compareWithOptions`）
 * 对 left / right 先 `normalizeText` 再 `splitLines`，因此引擎产出的行号与
 * 行文本不含 BOM；除剥 BOM 外各侧行文本恒保留原文 —— 规范化只用于相等性
 * 判定与元数据统计，不写回展示文本。
 *
 * 硬性约束（对齐引擎层既有约束）：
 * - 零 UI 依赖、零 DOM、零 store 依赖、零第三方依赖（仅用全局 `TextEncoder`）；
 * - 纯函数：不修改入参、不持有可变状态；
 * - 本文件是引擎层的【叶子模块】，不 import 任何引擎模块 —— 行切分以同一
 *   契约本地实现（`splitNormalizedLines`），避免 normalize ↔ diff 循环依赖；
 *   与 `./diff.ts` `splitLines` 的一致性由单元测试锁定（边界输入全集上
 *   `analyzeInput(x).lines` 与 `splitLines(normalizeText(x))` 逐元素相等）。
 *
 * 追加职责（ENG-012）：单行超长阈值与判定（`LONG_LINE_THRESHOLD` /
 * `isLongLine`，见文件末段）—— 放在本文件而非 ./guards.ts 的理由：guards.ts
 * 的职责是【整体输入体量】的 too-large 防护（字节 / 行数上限），而单行超长
 * 判定属于【文本度量】（字符数口径），与 analyzeInput 的 byteLength /
 * lines 等度量职责同类；且本文件是 guards.ts 的依赖上游（叶子），diff.ts
 * 无需新增依赖即可消费。
 * ============================================================================
 */

/** BOM 字符（U+FEFF）。UTF-16 中为单个 code unit，`charCodeAt` 可直接判定。 */
const BOM_CODE_UNIT = 0xfeff

/** UTF-8 字节计数用的编码器实例（TextEncoder 为 Node 18+ / 浏览器全局）。 */
const UTF8_ENCODER = new TextEncoder()

/**
 * 把（已剥 BOM 的）文本按行切分，契约与 `./diff.ts` 的 `splitLines` 逐字一致：
 * 支持 `\r\n` / `\n` / `\r` 三种换行符、不保留行尾符、空串返回 `[]`、
 * 尾部换行丢弃 split 产生的末尾空串（即 `'a\n'` 与 `'a'` 都得 `['a']`）。
 *
 * 存在原因：`analyzeInput` / `analyzeInputPair` 需要在本模块内完成切分，
 * 而 `splitLines` 属于 `./diff.ts` —— 直接反向 import 会构成 normalize ↔ diff
 * 循环依赖，故以本地副本承载同一契约（一致性由单元测试锁定，见文件头）。
 * 若 `splitLines` 契约变更，必须同步修改本函数。
 *
 * @param text 已剥 BOM 的文本（本函数不做 BOM 处理）
 * @returns 行内容数组（不含行尾符）；空文本返回 `[]`（0 行）
 */
function splitNormalizedLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r\n|\n|\r/)
  // 文本以换行符结尾时，split 的末尾元素恒为空串，丢弃之（同 splitLines）。
  if (/(?:\r\n|\n|\r)$/.test(text)) lines.pop()
  return lines
}

/**
 * 判定文本是否混用 ≥2 种行尾符风格（ENG-010 策略第 2 条的元数据出口）。
 *
 * 风格划分为三种：CRLF（`\r\n`，算一种风格）、孤立 LF（前面不是 `\r` 的
 * `\n`）、孤立 CR（后面不是 `\n` 的 `\r`）。单趟扫描（O(n)）逐个换行符
 * 判类：`\r` 后紧跟 `\n` 记 CRLF 并跳过该 `\n`（避免同一对字符同时计入
 * CRLF 与孤立 LF），`\r` 后非 `\n` 记孤立 CR，裸 `\n` 记孤立 LF。
 *
 * @param text 已剥 BOM 的文本（BOM 不是行尾符，先剥后判结果相同，调用方
 *             按约定先剥 —— 见 `analyzeInput`）
 * @returns 是否同时出现 ≥2 种风格（0 或 1 种风格时为 `false`）
 */
function hasMixedLineEndings(text: string): boolean {
  let hasCrlf = false
  let hasLoneLf = false
  let hasLoneCr = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\r') {
      if (text[i + 1] === '\n') {
        hasCrlf = true
        i += 1 // 该 \n 已被 CRLF 吸收，跳过
      } else {
        hasLoneCr = true
      }
    } else if (ch === '\n') {
      hasLoneLf = true
    }
    if (hasCrlf && hasLoneLf && hasLoneCr) break // 三种齐活，提前退出
  }
  const styleCount = (hasCrlf ? 1 : 0) + (hasLoneLf ? 1 : 0) + (hasLoneCr ? 1 : 0)
  return styleCount >= 2
}

/**
 * 单侧输入的规范化结果与边界诊断元数据（ENG-010）。
 *
 * `lines` 是引擎实际消费的比较视图（剥 BOM + 按行切分）；其余字段为
 * 【原文】的元数据快照，供 UI 诊断展示与 ENG-011 大文本阈值复用，
 * 不参与相等性判定。
 */
export interface NormalizedInput {
  /**
   * 规范化（剥 BOM）后的行内容数组，不含行尾符（契约同 `./diff.ts` 的
   * `splitLines`：空文本为 `[]`，尾部换行不产生额外空行）。
   */
  lines: string[]
  /** 原文是否以 U+FEFF（BOM）开头。 */
  hadBom: boolean
  /** 原文是否以换行符结尾（`\n` 或 `\r`；CRLF 以 `\n` 结尾，亦算）。 */
  endsWithNewline: boolean
  /**
   * 原文（剥 BOM 后）是否混用 ≥2 种行尾符风格（CRLF / 孤立 LF / 孤立 CR）。
   */
  hasMixedLineEndings: boolean
  /**
   * 原文是否为空串（0 字节文本）。
   * 注意：BOM-only 输入（`'\uFEFF'`）原文非空，本值为 `false`，但剥 BOM 后
   * `lines` 为 `[]`（0 行）—— 引擎按空文本处理。
   */
  isEmpty: boolean
  /**
   * 原文的 UTF-8 字节数（`TextEncoder` 计数，含 BOM 的 3 字节，若有）。
   * 供 ENG-011 大文本阈值（默认 5MB）复用。
   */
  byteLength: number
}

/**
 * 单侧输入的规范化与元数据分析（ENG-010 核心）。
 *
 * 各字段判定口径（均为对【原文】的只读观察，不修改入参）：
 * - `hadBom`：原文以 U+FEFF 开头；
 * - `endsWithNewline`：原文以 `\n` 或 `\r` 结尾（CRLF 也算）；
 * - `hasMixedLineEndings`：对剥 BOM 后的文本做三种风格的混用判定（见
 *   `hasMixedLineEndings`）；
 * - `isEmpty`：原文 `=== ''`（0 字节）；
 * - `byteLength`：原文的 UTF-8 字节数；
 * - `lines`：`normalizeText(text)` 后按 `splitLines` 同一契约切分（引擎
 *   入口 `diffLinesCore` / `compareWithOptions` 消费的就是这一视图）。
 *
 * @param text 原始文本（原样输入；BOM / 行尾符 / 尾部换行原样保留）
 * @returns 见 `NormalizedInput` 各字段注释
 */
export function analyzeInput(text: string): NormalizedInput {
  const hadBom = text.charCodeAt(0) === BOM_CODE_UNIT
  const withoutBom = hadBom ? text.slice(1) : text
  return {
    lines: splitNormalizedLines(withoutBom),
    hadBom,
    endsWithNewline: /[\n\r]$/.test(text),
    hasMixedLineEndings: hasMixedLineEndings(withoutBom),
    isEmpty: text === '',
    byteLength: UTF8_ENCODER.encode(text).length,
  }
}

/**
 * 剥除文本开头的一个 BOM（U+FEFF），其余内容原样返回（ENG-010 策略第 1 条）。
 *
 * 行为细则：
 * - 只剥【开头】【一个】：仅当首 code unit 为 U+FEFF 时去掉它 —— 文本中间
 *   的 U+FEFF、连续两个开头 BOM 的第二个均不剥（U+FEFF 在正文中间可能是
 *   有意的零宽字符，开头重复 BOM 视为用户原文的一部分）；
 * - 无 BOM / 空串原样返回（空串 `charCodeAt(0)` 为 `NaN`，判定自然为否）。
 *
 * 用途：引擎入口（`diffLinesCore` / `compareWithOptions`）对 left / right
 * 各调一次后再切分，保证 BOM 不进入行文本 —— 展示管线由此同样无 BOM。
 *
 * @param text 原始文本
 * @returns 剥除开头单个 U+FEFF 后的文本（无 BOM 时恒等于入参）
 */
export function normalizeText(text: string): string {
  return text.charCodeAt(0) === BOM_CODE_UNIT ? text.slice(1) : text
}

/* -------------------------------------------------------------------------- */
/* 单行超长判定（roadmap 任务 ENG-012）                                          */
/* -------------------------------------------------------------------------- */

/**
 * 单行超长阈值（ENG-012 定稿）：单行文本【严格大于】该字符数即视为超长行，
 * 供 `isLongLine` 与 UI（阈值提示）复用。
 *
 * 单位口径：UTF-16 code unit 数（与 `string.length` 一致），【不用】UTF-8 字节
 * —— 理由：渲染层（UI-006/007）的截断展示与「展开」交互按【字符】呈现与
 * 计数，字节口径会因多字节字符（中文 3 字节 / emoji 4 字节）造成「同一行
 * 引擎标记而 UI 按字符截断两套度量不一致」的换算成本；引擎与 UI 统一字符
 * 口径，阈值即所见。字节口径的大文本整体防护是另一维度（ENG-011 的
 * `DIFF_LIMITS.maxBytes`，见 ./guards.ts），两者正交不混用。
 */
export const LONG_LINE_THRESHOLD = 10_000

/**
 * 判定单行文本是否为超长行（ENG-012 核心）：`text.length > LONG_LINE_THRESHOLD`
 * （恰好等于阈值不算超长，与 ENG-011 限制校验的「严格大于」口径一致）。
 *
 * 长度口径为 `text.length`（UTF-16 code unit 数，理由见 `LONG_LINE_THRESHOLD`
 * 注释）。消费方：引擎行展开处（./diff.ts 的 `diffLinesCore` / `expandRows`）
 * 为每个产出的 `DiffRow` 计算 `longLine` 标记 —— 任一侧超长即 `longLine: true`
 * （见 `DiffRow.longLine` 契约），供 UI 默认截断 + 展开交互消费；'modify' 行
 * 的标记由 ./pairing.ts 的保守合并逻辑承接。
 *
 * @param text 单行文本（不含行尾符，切分契约见 ./diff.ts 的 `splitLines`）
 * @returns 是否超长（字符数 > 10000）
 */
export function isLongLine(text: string): boolean {
  return text.length > LONG_LINE_THRESHOLD
}

/**
 * 双侧输入的规范化结果（`analyzeInputPair` 的返回形状）。
 */
export interface AnalyzedInputPair {
  /** 左侧（旧文本）的规范化结果与元数据。 */
  left: NormalizedInput
  /** 右侧（新文本）的规范化结果与元数据。 */
  right: NormalizedInput
  /**
   * 「唯一差异是尾部换行」提示位：两侧剥 BOM 后的可见行全等、但
   * `endsWithNewline` 不同时为 `true`（例：`'a\n'` vs `'a'`）。此时引擎
   * 按定稿策略产出全 equal 无差异，本标记供 UI 未来展示「尾部换行不一致」
   * 提示徽标。BOM 有无不影响本判定（BOM 已剥除、不进入可见行）。
   */
  trailingNewlineDiffers: boolean
}

/**
 * 双侧输入的规范化与诊断元数据分析（ENG-010 元数据出口，供 UI 诊断用）。
 *
 * 实现方式：两侧各自走一遍 `analyzeInput`；`trailingNewlineDiffers` 用
 * 「normalizeText 后按 splitLines 同一契约切分的可见行逐元素相等」+
 * 「`endsWithNewline` 不同」判定。引擎主入口（`compare` / `compareFull`）
 * 的返回形状（`DiffResult`）不受影响 —— 本函数是正交的诊断通道，UI 可与
 * diff 结果并行消费。
 *
 * 边界：`''` vs `''` 为 `false`（两侧都无尾部换行，谈不上「不同」）；
 * `''` vs `'\n'` 为 `true`（可见行均为 0 行，唯一差异是尾部换行）。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @returns 见 `AnalyzedInputPair` 各字段注释
 */
export function analyzeInputPair(left: string, right: string): AnalyzedInputPair {
  const leftInput = analyzeInput(left)
  const rightInput = analyzeInput(right)
  const trailingNewlineDiffers =
    leftInput.endsWithNewline !== rightInput.endsWithNewline &&
    leftInput.lines.length === rightInput.lines.length &&
    leftInput.lines.every((line, index) => line === rightInput.lines[index])
  return { left: leftInput, right: rightInput, trailingNewlineDiffers }
}
