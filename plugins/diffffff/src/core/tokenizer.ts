/**
 * ============================================================================
 * CJK 感知 tokenizer（roadmap 任务 ENG-002：词法层切词）
 * ============================================================================
 *
 * 为词级 / 字符级 diff（ENG-003）与智能精度策略（ENG-004）提供行内文本的
 * 词法切分。为什么不用 jsdiff 自带分词：jsdiff 的 `diffWords` 按「空白 +
 * 单词边界」切 token，对完全没有空格的中文只会把整句产出成【一个】token
 * （「对比两段文本差异」是 1 个 token 而不是 8 个），词级 diff 因此只能把
 * 整句标红，无法定位句内到底改了哪几个字。本模块自研切词规则，对 CJK
 * 文字一律逐字成 token，让中文与英文一样具备「词粒度」的行内差异定位能力。
 *
 * 五类 token（类别互不重叠，按最长匹配）：
 * 1. 拉丁词   ：`[A-Za-z_]+`，下划线并入词（蛇形命名 `foo_bar` 不拆；
 *              纯下划线串 `___` 也成词）；
 * 2. 数字串   ：`[0-9]+`，与拉丁字母相邻时同样独立成 token（`v1` → `v`+`1`）；
 * 3. 空白     ：连续的 `\s` 类字符（空格 / tab / 换行 / \u00a0 等）合并为一个
 *              token —— 词级 diff 中空白独立参与，ENG-006 的 ignoreWhitespace
 *              在比较层忽略它，这里必须先无损保留；
 * 4. CJK 文字 ：汉字（统一表意区 / 扩展 A 区 / 兼容表意区）、日文假名、
 *              韩文谚文，逐字成 token；
 * 5. 其他     ：标点（含全角标点）、emoji 等剩余字符，逐 Unicode code point
 *              成 token（BMP 外字符如 emoji 的代理对整体成一个 token，
 *              不会被劈成两半；汉字扩展 B 区及以后虽不在第 4 类的 BMP 区间，
 *              走本兜底路径粒度同样是逐字，不影响差异定位）。
 *
 * 铁律（无损拼接恒等式）：对任意输入 text 恒有
 *   tokenizeWords(text).join('') === text
 *   tokenizeChars(text).join('') === text
 * 该恒等式是 `types.ts` 中 WordDiffSpan「spans 拼接恒等于该侧 text」契约的
 * 词法层基础：ENG-003 把相邻同类 token 合并成 span，切词一旦丢字符，渲染
 * 层的行内容就会缺字。
 *
 * 硬性约束：
 * - 单趟 O(n) 扫描（sticky 正则锚定 lastIndex 逐位推进 + 兜底逐 code point
 *   消费，每次循环至少前进 1 个 code unit；正则无嵌套量词，无回溯灾难）；
 * - 零 UI 依赖、零 DOM、零 store 依赖（对齐 ENG-001 的引擎层约束，
 *   本文件不 import 任何其他模块）。
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* CJK 字符类定义（tokenizeWords 与 isCjkChar 共用的单一事实来源）                */
/* -------------------------------------------------------------------------- */

/**
 * CJK 文字字符类的正则源片段（含方括号，可直接嵌入正则）。
 *
 * 覆盖范围（均为 BMP 内区间，与任务书约定一致）：
 * - `\u3040-\u30ff`：日文假名（平假名 3040–309F + 片假名 30A0–30FF）；
 * - `\u3400-\u4dbf`：汉字扩展 A 区；
 * - `\u4e00-\u9fff`：CJK 统一表意文字（常用汉字主体）；
 * - `\uf900-\ufaff`：CJK 兼容表意文字；
 * - `\uac00-\ud7af`：韩文谚文音节。
 *
 * 注意：汉字扩展 B 区及以后（U+20000 起）为 BMP 外字符，不在本类内；
 * 它们经「其他符号」兜底路径同样按单个 code point 切分，粒度不变。
 * 用 String.raw 保留 `\u` 字面量，避免转义歧义。
 */
const CJK_CHAR_CLASS_SOURCE = String.raw`[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]`

/**
 * 词级切词主正则（sticky 模式）。
 *
 * sticky（`y`）标志使 `exec` 只在 `lastIndex` 处尝试匹配：锚定当前位置、
 * 逐 token 推进、不做跨位置扫描，配合「每次匹配至少消费 1 个字符」保证
 * 整体单趟 O(n)（`+` 量词与单字符类都不允许空匹配，循环不会死循环）。
 * 各分支类别互不重叠，交替顺序不影响结果，按可读性排列。
 */
const WORD_TOKEN_RE = new RegExp(
  // 拉丁词：字母/下划线连续段。延续字符类刻意不含数字——
  // 若按任务书字面的 [A-Za-z_][A-Za-z0-9_]* 贪婪匹配，`v1` 会被整体
  // 吞成一个 token，与「数字与拉丁字母相邻时独立成 token（v1 → v + 1）」
  // 的显式要求矛盾（取舍理由见 tokenizeWords 的 JSDoc）。
  '[A-Za-z_]+' +
    '|' +
    // 数字串：连续数字，即使紧邻拉丁字母也独立成 token。
    '[0-9]+' +
    '|' +
    // 空白：连续 \s 类字符合并为一个 token（含换行，词级 diff 逐行
    // 切分后行内通常不含换行，合并不影响 ENG-003 用法）。
    '\\s+' +
    '|' +
    // CJK 文字：单个字符，逐字成 token（不用 + 量词合并整句，
    // 这是解决「中文整句一个 token」问题的关键）。
    CJK_CHAR_CLASS_SOURCE,
  'y',
)

/**
 * CJK 判定正则（isCjkChar 用）。
 *
 * 刻意不带 `g` 标志：`RegExp.prototype.test` 在非全局正则上无 lastIndex
 * 状态，可安全地跨调用复用；传入长字符串时语义为「是否包含 CJK 字符」。
 */
const CJK_CHAR_RE = new RegExp(CJK_CHAR_CLASS_SOURCE)

/* -------------------------------------------------------------------------- */
/* 导出：词级 / 字符级切词与 CJK 判定                                          */
/* -------------------------------------------------------------------------- */

/**
 * 行内词级切词（ENG-002 主入口）：把一段文本切成五类 token 序列。
 *
 * 分类规则与设计理由：
 * - **拉丁词** `[A-Za-z_]+`：下划线并入词，蛇形命名 `foo_bar` 不拆，
 *   纯下划线串 `___` 也成词。任务书把拉丁词写作 `[A-Za-z_][A-Za-z0-9_]*`，
 *   但该模式与「数字与拉丁字母相邻时独立成 token（`v1` → `v` + `1`）」
 *   矛盾——延续类含数字时贪婪匹配会把 `v1` 整体吞掉。本实现以显式行为
 *   示例为准，词的延续字符不含数字，因此 `v1` → `v`+`1`、`abc123def` →
 *   `abc`+`123`+`def`。对 diff 粒度这是更优解：`v1.2.3` 改为 `v1.2.4`
 *   时只有末位数字被标红，而不是整段版本号。
 * - **数字串** `[0-9]+`：极大数字串独立成 token（`123abc456` →
 *   `123`+`abc`+`456`）。
 * - **CJK 逐字**：汉字 / 假名 / 谚文每个字符各成一个 token。这是本模块
 *   存在的核心原因：中文没有词间空格，任何基于空白的分词（含 jsdiff 的
 *   `diffWords`）只能产出整句 token，词级 diff 无法定位句内变化；逐字
 *   切分后改一个字就只高亮一个字。
 * - **空白合并**：连续 `\s` 类字符合并为一个 token，作为独立 token 参与
 *   词级 diff；ENG-006 的 ignoreWhitespace 在比较层忽略它，tokenize 阶段
 *   必须无损保留以维持拼接恒等式。
 * - **其他符号兜底**：标点（含全角标点 `，。！`）、emoji 等按 Unicode
 *   code point 逐个成 token（`-` 属于此类，故 `hello-world` 拆三段）。
 *   用 `codePointAt` + `fromCodePoint` 消费，emoji 等 BMP 外代理对整体
 *   成 token；即使输入含孤立代理项（非法 UTF-16 序列）也原样保留，
 *   恒等式对任意输入成立。
 *
 * 复杂度：单趟 O(n)——sticky 正则锚定 `lastIndex` 逐位推进，每个 code unit
 * 至多被消费一次；兜底分支每次前进 1 个 code point。空串返回 `[]`。
 *
 * @param text 原始文本（原样输入，不做任何规范化；可含任意 Unicode）
 * @returns token 数组，满足铁律 `tokens.join('') === text`
 */
export function tokenizeWords(text: string): string[] {
  const tokens: string[] = []
  const re = WORD_TOKEN_RE
  let i = 0
  const n = text.length // UTF-16 code unit 长度

  while (i < n) {
    re.lastIndex = i
    const m = re.exec(text)
    if (m !== null) {
      // 命中四类多字符 token（拉丁词 / 数字串 / 空白 / CJK 单字）之一。
      tokens.push(m[0])
      i = re.lastIndex
    } else {
      // 兜底：其他符号逐 Unicode code point 成 token。
      const ch = String.fromCodePoint(text.codePointAt(i)!)
      tokens.push(ch)
      i += ch.length
    }
  }

  return tokens
}

/**
 * 字符级切词（ENG-002 / ENG-003 字符精度用）：逐 Unicode code point 切分。
 *
 * 与 `tokenizeWords` 的差异：不做任何分类合并——空白不合并（每个空格 /
 * tab 各自成 token）、拉丁词不合并（每个字母一个 token）、CJK 逐字。
 * 用 `Array.from` 的字符串迭代器按 code point 切分，emoji 等 BMP 外字符
 * 的代理对保持完整（`'a🎉b'` → 3 个 token 而不是 4 个），孤立代理项也
 * 各自成元素，保证拼接恒等式对任意输入成立。
 *
 * 复杂度：单趟 O(n)。空串返回 `[]`。
 *
 * @param text 原始文本（原样输入，不做任何规范化）
 * @returns 单字符（code point）token 数组，满足 `tokens.join('') === text`
 */
export function tokenizeChars(text: string): string[] {
  return Array.from(text)
}

/**
 * 判断字符（或字符串）是否属于 CJK 文字（ENG-002 导出，供 ENG-004 使用）。
 *
 * 双重语义（同一实现天然覆盖两种用法）：
 * - 传入单个字符：判断该字符是否为汉字 / 假名 / 谚文（判定区间与
 *   `tokenizeWords` 的 CJK 类完全一致，两处共用同一字符类常量）；
 * - 传入整行 / 长字符串：判断其中是否【包含】至少一个 CJK 字符——
 *   ENG-004 用它决定行内高亮策略（含 CJK 的行用逐字 token 对齐，
 *   纯拉丁行用整词对齐）。
 *
 * 全角标点（如 `，`）、emoji、空白均不属于 CJK 文字，返回 `false`。
 *
 * @param ch 单个字符，或任意长度的待检查字符串
 * @returns 是否（包含）CJK 文字字符
 */
export function isCjkChar(ch: string): boolean {
  return CJK_CHAR_RE.test(ch)
}
