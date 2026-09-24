/**
 * 语法高亮（roadmap 任务 INT-001）—— 结果行高亮的纯渲染支撑模块。
 *
 * 职责边界：本模块只做「单行文本 → 带 token 类名的 spans」的纯函数转换，
 * 不感知 diff 结构与 Vue 响应性；行内容的消费（词级 diff 高亮共存、虚拟滚动
 * 可视行接入）在 SplitDiffView / UnifiedDiffView。
 *
 * 实现要点：
 * - 语言包按需注册：12 个语言包工厂（javascript/typescript/python/java/go/
 *   sql/json/yaml/html/markdown/css/xml）静态 import，但 LanguageSupport
 *   实例【惰性构造】并缓存 —— 未被选中的语言永不付出构造成本；plaintext /
 *   未知语言 → null（调用方回退纯文本渲染）。
 * - 解析 API：lezer Parser.parse(input) 直接接受字符串（@lezer/common
 *   的 Parser 接口签名 parse(input: Input | string)），无需经 EditorState
 *   间接构造；类名收集用 @lezer/highlight 的 highlightTree(tree, highlighter,
 *   putStyle(from, to, classes)) —— putStyle 按位置有序、区间不重叠，
 *   highlighter 用自定义单类映射（见 tagToClass）。
 * - 类名方案（tok-* 前缀命名空间，CSS 定义在 main.css 的 --syntax-* 段）：
 *   有限类名集合，跟随 GitHub light/dark 语法色板 —— keyword / string /
 *   comment / number / atom / entity(tagName) / type / attribute / property /
 *   variable(默认文字色) / operator / punctuation / meta。Tag → 类名映射
 *   基于 Tag.set 父链回退（子 tag 未显式映射时落到父 tag 的类，如
 *   controlKeyword → keyword），与 @lezer/highlight tagHighlighter 的
 *   优先级语义一致，但每个区段只返回【单个】类名（diff 词级类并列挂载
 *   需要类名串可控）。
 * - 缓存：per (lang, text) 的 LRU（Map 插入序即访问序，命中先删后插刷新
 *   新鲜度；超上限删最旧）。虚拟滚动只对可视行调用本函数，滚动回看由
 *   缓存兜底避免重复 parse。
 *
 * 已知局限（接受的设计取舍）：逐行解析 —— 跨行的多行注释 / 模板字符串 /
 * markdown 围栏等结构在单行视角下不可见，对应行可能漏上色或不平衡（lezer
 * 的容错恢复保证不抛错、拼接恒等式不受影响）。这是「diff 行级渲染 + 虚拟
 * 滚动只 parse 可视行」的必然选择；完整文档级高亮与 diff 行模型冲突，收益
 * 不成比例。解析异常（理论上由 lezer 容错兜底，此处防御）回退纯文本单 span。
 */
import type { Parser } from '@lezer/common'
import type { Extension } from '@codemirror/state'
import type { Highlighter, Tag } from '@lezer/highlight'
import { highlightTree, tags } from '@lezer/highlight'
import type { LanguageSupport } from '@codemirror/language'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'

/**
 * 语言 id → LanguageSupport 工厂（惰性调用）。key 与 viewStore.LANGUAGE_OPTIONS
 * 的 value 同口径；typescript 复用 javascript 包（typescript 配置二选一）。
 */
const LANGUAGE_FACTORIES: Readonly<Record<string, () => LanguageSupport>> = {
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  python: () => python(),
  java: () => java(),
  go: () => go(),
  sql: () => sql(),
  json: () => json(),
  yaml: () => yaml(),
  html: () => html(),
  markdown: () => markdown(),
  css: () => css(),
  xml: () => xml(),
  cpp: () => cpp(),
}

/** LanguageSupport 实例缓存（按需注册：首次取用才构造，null 也缓存避免反复重试） */
const supportCache = new Map<string, LanguageSupport | null>()

/**
 * 按语言取 LanguageSupport（惰性构造并缓存）。
 *
 * @param lang 语言 id（viewStore.LANGUAGE_OPTIONS 口径）
 * @returns 对应 LanguageSupport；plaintext / 未注册语言返回 null
 */
export function getLanguageSupport(lang: string): LanguageSupport | null {
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_FACTORIES, lang) === false) {
    return null
  }
  const cached = supportCache.get(lang)
  if (cached !== undefined) return cached
  let support: LanguageSupport | null = null
  try {
    support = LANGUAGE_FACTORIES[lang]()
  } catch (error) {
    // 语言包构造异常（正常不可达）：按「无语言」处理并留调试信息
    console.debug(`[highlight] 语言包构造失败：${lang}`, error)
    support = null
  }
  supportCache.set(lang, support)
  return support
}

/** 编辑器接入用（InputEditor 的语言 compartment 消费）：support 实例本身即 Extension */
export function getLanguageExtension(lang: string): Extension | null {
  return getLanguageSupport(lang)?.extension ?? null
}

/**
 * 按语言取 lezer 解析器（行级高亮消费）。
 *
 * @returns Parser；plaintext / 未注册语言 / 构造失败返回 null
 */
export function getParser(lang: string): Parser | null {
  return getLanguageSupport(lang)?.language.parser ?? null
}

/* -------------------------------------------------------------------------- */
/* Tag → tok-* 类名映射                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 高亮 Tag → 有限类名集合的显式映射（entry 形式，供 Map 与 HighlightStyle 共用）。
 * 只需列出「不落默认」的 tag：子 tag 未列出时沿 Tag.set 父链回退到父 tag 的类
 * （见 syntaxHighlighter）。variableName 刻意映射到 tok-variable（CSS 里
 * color: inherit，占位不染色），其余未映射 tag（heading / emphasis / link 等
 * markup 修饰）保持默认文字色。
 */
const TAG_CLASS_ENTRIES: ReadonlyArray<readonly [Tag, string]> = [
  // 关键字族（self / null / atom / 各类子关键字沿父链回退到此）
  [tags.keyword, 'tok-keyword'],
  // 字面量族：bool 直连 literal 父链不走 string，显式给关键字色（GitHub 把 true/false 当常量红）
  [tags.bool, 'tok-keyword'],
  // 字符串族（docString / character / attributeValue 沿父链回退到此）
  [tags.string, 'tok-string'],
  [tags.regexp, 'tok-string'],
  [tags.escape, 'tok-string'],
  [tags.url, 'tok-string'],
  [tags.color, 'tok-number'],
  // 注释 / 数字
  [tags.comment, 'tok-comment'],
  [tags.number, 'tok-number'],
  // 标识符族（tagName 是 typeName 子 tag，须列在 typeName 之前以获得更高特异性命中）
  [tags.tagName, 'tok-entity'],
  [tags.typeName, 'tok-type'],
  [tags.className, 'tok-type'],
  [tags.namespace, 'tok-type'],
  [tags.macroName, 'tok-type'],
  [tags.labelName, 'tok-type'],
  [tags.attributeName, 'tok-attribute'],
  [tags.propertyName, 'tok-property'],
  [tags.variableName, 'tok-variable'],
  // 操作符 / 标点 / 元信息（各子类沿父链回退）
  [tags.operator, 'tok-operator'],
  [tags.punctuation, 'tok-punctuation'],
  [tags.meta, 'tok-meta'],
]

const TAG_CLASS_MAP = new Map<Tag, string>(TAG_CLASS_ENTRIES)

/**
 * 单个 Tag（或其父链上任一祖先）→ tok-* 类名（syntaxHighlighter 消费 Tag.set 父链）。
 *
 * @param tag 待判定的 tag（通常是某 tag.set 中的一项）
 * @returns 类名；未映射返回 null（该区段保持默认文字色）
 */
export function tagToClass(tag: Tag): string | null {
  return TAG_CLASS_MAP.get(tag) ?? null
}

/**
 * 编辑器侧（InputEditor）共用同一色板的 HighlightStyle：class 型 spec
 * （tag → 'tok-*' 静态类名，不内联样式）—— CM 高亮 DOM 直接挂 tok-* 类，
 * 颜色由 main.css 的 .tok-* 规则承载，与结果视图 spans 完全同一套 token。
 */
export const syntaxHighlightStyle: HighlightStyle = HighlightStyle.define(
  // HighlightStyle 的 class 型 spec 形状与 TAG_CLASS_ENTRIES 一致（tag + class）
  TAG_CLASS_ENTRIES.map(([tag, cls]) => ({ tag, class: cls })),
)

/**
 * syntaxHighlightStyle 的 Extension 形态（CM6 要求经 syntaxHighlighting 包装
 * 才能装入扩展集；HighlightStyle 实例本身不是 Extension）。无语言（编辑器的
 * 语言 compartment 为空）时本扩展无任何效果。
 */
export const syntaxHighlightingExtension: Extension = syntaxHighlighting(syntaxHighlightStyle)

/**
 * highlightTree 消费的自定义 Highlighter：一组规则 tag（可多个）按序取
 * 第一个可映射类（含 Tag.set 父链回退），整段只返回【单个】类名 —— 与
 * tagHighlighter 的「多 tag 类名拼接」不同，单类串让词级 diff 类
 * （word-changed）的并列挂载保持可控。null = 不染色。
 */
const syntaxHighlighter: Highlighter = {
  style(ruleTags: readonly Tag[]): string | null {
    for (const tag of ruleTags) {
      // Tag.set = [自身, 父, 祖先…]（特异性递减）：先命中先返回
      for (const t of tag.set) {
        const cls = tagToClass(t)
        if (cls !== null) return cls
      }
    }
    return null
  },
}

/* -------------------------------------------------------------------------- */
/* 行级 spans 产出（含 LRU 缓存）                                               */
/* -------------------------------------------------------------------------- */

/**
 * 渲染 span：cls 为单个 tok-* 类名或空串（'' = 默认文字色，无类）。
 * 词级 diff 共存时 cls 亦可为 'word-changed' 或 'word-changed tok-*'
 * （mergeWordSyntax 产出，类名以空格分隔）。
 */
export interface SyntaxSpan {
  /** 片段文本（spans 按序拼接恒等于原行文本 —— 拼接恒等式） */
  text: string
  /** 空格分隔的 CSS 类名串（'' = 无类） */
  cls: string
}

/** LRU 缓存上限（条）：虚拟滚动下可视行数有限，2000 条足够覆盖滚动回看窗口 */
const SPAN_CACHE_LIMIT = 2000

/** (lang, text) → spans 的 LRU 缓存；key 用 \u0000 连接避免 lang/text 边界歧义 */
const spanCache = new Map<string, SyntaxSpan[]>()

/**
 * 把 highlightTree 收集的染色区段拼接成覆盖全行文本的 spans（拼接恒等式）。
 * 区段由 highlightTree 保证有序不重叠，这里仍做钳制防御（from < pos 时丢弃
 * 重叠残余），保证任何输入下拼接都完整还原原文。
 */
function buildSpans(text: string, marks: { from: number; to: number; cls: string }[]): SyntaxSpan[] {
  const spans: SyntaxSpan[] = []
  let pos = 0
  for (const mark of marks) {
    if (mark.to <= pos) continue // 完全落在已覆盖区间的防御分支
    if (mark.from > pos) {
      spans.push({ text: text.slice(pos, mark.from), cls: '' })
    }
    const from = Math.max(pos, mark.from)
    spans.push({ text: text.slice(from, mark.to), cls: mark.cls })
    pos = mark.to
  }
  if (pos < text.length) {
    spans.push({ text: text.slice(pos), cls: '' })
  }
  return spans
}

/**
 * 单行文本 → 语法 spans（INT-001 结果行高亮的核心出口）。
 *
 * @param text 行文本（含行内空白；虚拟滚动下每次只对可视行调用）
 * @param lang 语言 id（'plaintext' / 未注册语言直接回退单 span）
 * @returns spans 数组：按序拼接恒等于 text；无 parser / 解析异常时为
 *          [{ text, cls: '' }] 单 span。同一 (lang, text) 重复调用命中
 *          LRU 缓存返回【同一数组引用】（调用方应把 spans 视为只读）。
 */
export function highlightLineSpans(text: string, lang: string): SyntaxSpan[] {
  const parser = getParser(lang)
  if (parser === null || text === '') {
    return [{ text, cls: '' }]
  }
  const key = `${lang}\u0000${text}`
  const cached = spanCache.get(key)
  if (cached !== undefined) {
    // LRU 刷新：命中先删后插，Map 插入序即访问序（最旧条目恒在队首）
    spanCache.delete(key)
    spanCache.set(key, cached)
    return cached
  }
  let spans: SyntaxSpan[]
  try {
    const tree = parser.parse(text)
    const marks: { from: number; to: number; cls: string }[] = []
    highlightTree(tree, syntaxHighlighter, (from, to, classes) => {
      // 本实现每个区段只产一个类名；split 取首段作防御（容其它 highlighter 形态）
      const cls = classes.split(/\s+/)[0] ?? ''
      if (cls !== '' && to > from) {
        marks.push({ from, to, cls })
      }
    })
    spans = buildSpans(text, marks)
  } catch (error) {
    // 解析异常防御：回退纯文本单 span（拼接恒等式仍成立）
    console.debug('[highlight] 行解析失败，回退纯文本', error)
    return [{ text, cls: '' }]
  }
  if (spanCache.size >= SPAN_CACHE_LIMIT) {
    const oldest = spanCache.keys().next().value
    if (oldest !== undefined) spanCache.delete(oldest)
  }
  spanCache.set(key, spans)
  return spans
}

/* -------------------------------------------------------------------------- */
/* 词级 diff 与语法高亮的共存合并                                                */
/* -------------------------------------------------------------------------- */

/**
 * 词级 diff spans 与语法 spans 的合并（INT-001 共存规则）：
 * - 词级 diff 高亮优先 —— changed 片段保留 word-changed 背景（CSS 语义：
 *   word-changed 管背景、tok-* 管文字色，class 并列挂载互不冲突）；
 * - 两侧 spans 拼接恒等于同一行文本，按「两者全部边界」切分成最小片段，
 *   每个片段取其所属 word span 的 changed 与 syntax span 的类名拼成 cls。
 *
 * @param words 词级 spans（拼接恒等于行文本，changed 标记 diff）
 * @param syntax 语法 spans（拼接恒等于同一行文本，cls 为 tok-* 或 ''）
 * @returns 合并后的渲染 spans（拼接恒等于行文本；cls 形如
 *          '' / 'tok-*' / 'word-changed' / 'word-changed tok-*'）
 */
export function mergeWordSyntax(
  words: ReadonlyArray<{ text: string; changed?: boolean }>,
  syntax: readonly SyntaxSpan[],
): SyntaxSpan[] {
  const full = words.map((span) => span.text).join('')
  if (full === '') return []
  // 边界集合 = {0, 长度} ∪ 词级边界 ∪ 语法边界：切出的最小片段既不跨词级
  // span 也不跨语法 span，按起点所属片段取 changed / cls 即可。
  const cuts = new Set<number>([0, full.length])
  let offset = 0
  for (const span of words) {
    offset += span.text.length
    cuts.add(offset)
  }
  offset = 0
  for (const span of syntax) {
    offset += span.text.length
    cuts.add(offset)
  }
  const sorted = Array.from(cuts).sort((a, b) => a - b)

  const out: SyntaxSpan[] = []
  let wordIndex = 0
  let syntaxIndex = 0
  let wordStart = 0
  let syntaxStart = 0
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]
    const to = sorted[i + 1]
    if (to <= from) continue
    // 指针推进到覆盖 from 的片段（cuts 含全部片段边界，不会越界）
    while (wordIndex < words.length && wordStart + words[wordIndex].text.length <= from) {
      wordStart += words[wordIndex].text.length
      wordIndex += 1
    }
    while (syntaxIndex < syntax.length && syntaxStart + syntax[syntaxIndex].text.length <= from) {
      syntaxStart += syntax[syntaxIndex].text.length
      syntaxIndex += 1
    }
    const changed = words[wordIndex]?.changed === true
    const syntaxCls = syntaxIndex < syntax.length ? syntax[syntaxIndex].cls : ''
    const cls = [changed ? 'word-changed' : '', syntaxCls].filter(Boolean).join(' ')
    out.push({ text: full.slice(from, to), cls })
  }
  return out
}
