/**
 * ============================================================================
 * 对比选项的规范化与比较辅助（roadmap 任务 ENG-006）
 * ============================================================================
 *
 * 为 ENG-006 的三个对比选项（忽略空白 / 忽略大小写 / 忽略空行变化）提供
 * 「比较层」的单一事实来源：
 *
 * 1. `normalizeForCompare`：把一行文本按选项折叠成「仅用于比较」的规范形
 *    （不改展示文本 —— `DiffRow` 各侧的 `text` 恒保留原文）；
 * 2. `isEmptyish`：判定「空行」（trim 后为空，含纯空白行），供
 *    ignoreEmptyLines 的过滤-投影算法（见 `./diff.ts` `compareWithOptions`）使用；
 * 3. `optionsKey`：为缓存会话（`./precision.ts`）生成稳定的选项缓存键片段，
 *    同一输入在不同选项下落不同缓存槽位；
 * 4. `DEFAULT_OPTIONS`：三个开关全关的缺省选项 —— 此时不做任何规范化，
 *    引擎行为与 ENG-001/003/004 的严格比较完全一致。
 *
 * 分工边界：`ignoreRules`（自定义忽略规则）的编译与替换原语归 ENG-007
 * （`./ignoreRules.ts`），本模块负责把它接入比较管线 —— `normalizeForCompare`
 * 的折叠顺序为「规则替换最先（作用于原始行）→ ignoreWhitespace →
 * ignoreCase」，`optionsKey` 纳入启用规则的指纹（不同规则不共享缓存槽位）。
 *
 * 硬性约束（对齐 ENG-001/002/003/004/007 的引擎层约束）：
 * - 零 UI 依赖、零 DOM、零 store 依赖：类型依赖 `./types.ts`（type-only），
 *   运行时仅依赖 `./ignoreRules.ts`（同为纯逻辑引擎模块）；
 * - 纯函数：不修改入参，不持有任何可变状态。
 * ============================================================================
 */

import { compileIgnoreRules } from './ignoreRules'
import type { DiffOptions, IgnoreRule } from './types'

/**
 * 影响「比较」行为的选项子集（ENG-006/007 行内 diff 也复用同一比较语义）。
 *
 * `DiffOptions` 的比较相关子集：行级 diff（`compareWithOptions`）与
 * 行内 token diff（`computeSpans`）的 comparator 都以本子集为规范化输入；
 * `ignoreEmptyLines` 只作用于行级骨架的输入过滤，不参与逐字符 / 逐 token
 * 的规范化，因此不在本子集内。
 *
 * `ignoreRules`（ENG-007）为可选字段：`DiffOptions` 整体可赋给本类型
 * （精度链路原样透传完整 options），老调用方只传两个开关的裸对象也兼容
 * （缺省视为无规则）。
 */
export type CompareOptions = Pick<DiffOptions, 'ignoreWhitespace' | 'ignoreCase'> & {
  /** 自定义忽略规则（ENG-007，可选）：缺省 / 空数组 / 全 disabled = 无规则。 */
  ignoreRules?: IgnoreRule[]
}

/**
 * 把一行文本按选项折叠成「仅用于比较」的规范形（ENG-006 核心 + ENG-007 规则）。
 *
 * 折叠顺序（固定，不可交换）：
 * 1. `ignoreRules`（ENG-007）最先：按已编译规则对【原始行】依次做全量删除
 *    （replaceAll 语义，见 `./ignoreRules.ts` `normalizeWithRules`）。规则
 *    先行的意义：规则可删除原文中「带空白 / 带大小写信息」的片段，其留下
 *    的空白由后续空白折叠吸收（例：规则 `/\d+/g` 下 `'v 1'` → `'v '` →
 *    空白折叠 + trim → `'v'`，与 `'v999'` → `'v'` 等价；若顺序颠倒则得
 *    `'v '` ≠ `'v'`）；
 * 2. `ignoreWhitespace` 先行：所有 `\s+` 连续空白（空格 / tab 等 Unicode
 *    空白类字符）折叠为单个空格，再 trim 掉两端空白。该顺序同时覆盖三类
 *    场景 —— 行尾 / 行首空白（trim 削平）、行中连续空白（折叠为单空格）、
 *    全空白行（折叠 + trim 后得空串 `''`）；
 * 3. `ignoreCase` 后行：整体 `toLowerCase`。放在空白折叠之后，保证小写化
 *    只影响字符本身、不会与空白折叠相互干扰（对结果而言二者顺序无关，
 *    但固定顺序让规范形可预测、可测试）。
 *
 * 无规则（未传 `regexes` 且 options 无启用规则）时第 1 步为空操作，行为与
 * ENG-006 时代逐字节一致；三个维度全关时整体退化为恒等 —— 基于本函数的
 * comparator 在缺省选项下即严格相等，引擎既有行为不受影响。
 *
 * 性能约定（ENG-007）：第 3 参 `regexes` 由调用方 `compileIgnoreRules`
 * 【编译一次】后传入（生产链路 `compareWithOptions` / `applyInlineSpans`
 * 均如此）；不传且 `options.ignoreRules` 存在启用规则时，本函数内部兜底
 * 编译 —— 【慢路径】逐行调用都会重新编译，仅为便捷 / 兼容保留，生产代码
 * 不要依赖。兜底编译失败（存在非法正则）时跳过规则：本函数返回 string、
 * 不承担错误通道职责，非法正则由行级入口 `compareWithOptions`（抛
 * `RuleError`）与 `compareFull`（返回 invalid-regex）负责上报。
 *
 * 用途边界：返回值仅用于「相等性比较」（行级 comparator、行内 token
 * comparator），绝不写入 `DiffRow` 的 `text` —— 展示文本恒为原文。
 *
 * @param line 一行文本（或行内单个 token，见 `./inline.ts` 的用法）
 * @param options 比较选项（只读取 `ignoreWhitespace` / `ignoreCase` /
 *                `ignoreRules` 字段，其余字段缺省按 `false` / 无规则处理，
 *                传入部分对象也安全）
 * @param regexes 已编译忽略规则（ENG-007，可选）：来自
 *                `compileIgnoreRules(...).regexes`（恒带 g）；`undefined`
 *                = 按 options 兜底解析（慢路径），空数组 = 显式无规则
 * @returns 规范化后的比较文本（非展示用）
 */
export function normalizeForCompare(line: string, options: CompareOptions, regexes?: RegExp[]): string {
  let normalized = line

  // 第 1 步（ENG-007）：忽略规则替换，作用于原始行。
  let effective = regexes
  if (effective === undefined) {
    const rules = options.ignoreRules
    if (rules !== undefined && rules.some((rule) => rule.enabled)) {
      // 慢路径（兜底）：见函数 JSDoc「性能约定」—— 逐行重编译，勿在生产
      // 链路依赖；调用方应 compile 一次后经第 3 参传入。
      const compiled = compileIgnoreRules(rules)
      if (compiled.ok) effective = compiled.regexes
      // 编译失败：跳过规则（错误通道在 compareWithOptions / compareFull）。
    }
  }
  if (effective !== undefined) {
    for (const re of effective) {
      // re 恒带 g（compileIgnoreRules 保证）→ 全量替换（replaceAll 语义）。
      normalized = normalized.replace(re, '')
    }
  }

  if (options.ignoreWhitespace === true) {
    // 连续空白折叠为单空格并削平两端：行尾空白、行首空白、全空白行一次覆盖。
    normalized = normalized.replace(/\s+/g, ' ').trim()
  }
  if (options.ignoreCase === true) {
    normalized = normalized.toLowerCase()
  }
  return normalized
}

/**
 * 判定一行文本是否为「空行」（ENG-006 ignoreEmptyLines 的过滤判据）。
 *
 * 约定：`trim()` 后为空串即算空行 —— 覆盖真空行 `''` 与纯空白行
 * （`'   '`、`'\t'` 等）。该判据独立于 `ignoreWhitespace` 开关：
 * 开启「忽略空行变化」时，纯空白行同样视为空行被剔除出 diff 输入。
 *
 * @param line 一行文本（不含行尾符）
 * @returns 是否空行（trim 后为空）
 */
export function isEmptyish(line: string): boolean {
  return line.trim() === ''
}

/**
 * 生成对比选项的稳定缓存键片段（ENG-006 缓存会话用；ENG-007 接入规则指纹）。
 *
 * 实现：按固定字段顺序构造普通对象后 `JSON.stringify`，例如
 * `{"ignoreWhitespace":true,"ignoreCase":false,"ignoreEmptyLines":false}`。
 * 固定字段顺序 + 显式布尔化（`=== true`，`undefined` 归一为 `false`）保证：
 * - 字段声明顺序不同 / 缺省字段不同的等价选项对象生成同一键；
 * - 键只由「影响比较结果」的开关决定，与对象其余字段无关。
 *
 * 规则指纹（ENG-007）：存在【启用】规则时，在基础键后追加
 * `|rules=` + 各启用规则 `[pattern, flags]` 的 JSON 序列化（数组顺序即
 * 替换顺序，语义有序）。要点：
 * - 仅启用规则参与指纹：disabled 规则不影响比较结果，开关切换不换缓存槽位；
 * - 非法 pattern 同样参与指纹（编译发生在引擎入口而非本函数）：只要
 *   pattern+flags 序列不同键就不同，编译失败的 options 与合法 options、
 *   与无规则 options 都不会共享缓存；
 * - `flags` 缺省归一为 `''`（与编译语义一致：两者编译出同一正则）。
 * 无启用规则（含 `ignoreRules` 缺省 / 空数组 / 全 disabled）时返回值与
 * ENG-006 时代逐字节一致 —— 既有键值断言与既有缓存行为不受影响。
 *
 * 拼接约定：与 `./precision.ts` 的 NUL 分隔键配合使用 ——
 * `left + '\u0000' + right + '\u0000' + optionsKey(options)`；本函数返回值
 * 是 JSON 片段 + 固定前缀 `|rules=`（不含 U+0000），不会破坏分隔符语义；
 * 基础键为固定字段的 JSON，不含 `|`，追加段无拼接歧义。
 *
 * @param options 对比选项（只读取三个开关字段与 `ignoreRules`，
 *                `ignoreEmptyLines` 缺省按 false）
 * @returns 稳定的缓存键片段（同一选项状态恒得同一字符串）
 */
export function optionsKey(options: DiffOptions): string {
  const base = JSON.stringify({
    ignoreWhitespace: options.ignoreWhitespace === true,
    ignoreCase: options.ignoreCase === true,
    ignoreEmptyLines: options.ignoreEmptyLines === true,
  })
  const rules = options.ignoreRules
  if (rules === undefined) return base
  const enabled = rules.filter((rule) => rule.enabled)
  if (enabled.length === 0) return base
  const fingerprint = JSON.stringify(enabled.map((rule) => [rule.pattern, rule.flags ?? '']))
  return base + '|rules=' + fingerprint
}

/**
 * 缺省对比选项（ENG-006）：三个开关全关 + 空规则列表。
 *
 * 语义：与 ENG-001/003/004 时代的严格比较完全一致 —— `normalizeForCompare`
 * 恒等、无空行过滤。各引擎出口的可选 `options` 参数缺省都取本常量，保证
 * 「不传选项 = 既有行为」的向后兼容约定。
 */
export const DEFAULT_OPTIONS: DiffOptions = {
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreEmptyLines: false,
  ignoreRules: [],
}
