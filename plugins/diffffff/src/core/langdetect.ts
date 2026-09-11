/**
 * 语言自动检测（roadmap 任务 INT-001）—— 纯函数模块，无 Vue / store 依赖，可单测。
 *
 * 检测优先级链（两级）：
 * 1. 扩展名优先：filename 非空时按扩展名映射表命中即返回（大小写不敏感）；
 * 2. 内容启发式兜底：扩展名无结果（未知扩展名 / 无扩展名 / 未提供文件名）时，
 *    对内容采样按置信度顺序依次尝试一组轻量模式，取【首个命中】的语言。
 * 两级都未命中 → 'plaintext'（视图层据此不渲染语法 spans）。
 *
 * 设计取舍（诚实声明）：
 * - 启发式是兜底而非精确判定，正确率不追求完美 —— 目标是「贴入一段常见代码 /
 *   配置文本时大概率选对语言」，误判的代价只是语法色不出现或张冠李戴，
 *   不影响 diff 本身；因此各规则从简、宁可漏判（返回 plaintext）不追求覆盖。
 * - 置信度顺序即歧义消解规则：同一段文本命中多条时取顺序靠前者（如「同时
 *   像 JSON 和 JS」的对象字面量判为 JSON —— 结构化数据比代码片段的误报少
 *   得多）。实际顺序：HTML 强锚点 → XML → CSS → YAML → Python → Go →
 *   Java → Markdown → JavaScript → SQL → C++（对任务给定顺序的两处微调及
 *   理由见 detectByContentSample 内注释：HTML 强锚点先于 XML 泛化形态、
 *   Markdown 提前到 JavaScript 之前）。
 * - 逐行解析的局限与逐行高亮一致（见 src/core/highlight.ts 文件头），
 *   检测只看内容形态、无此局限。
 */

/** 语言 id：与 viewStore.LANGUAGE_OPTIONS 的 value 同口径（'plaintext' 为兜底） */
export type DetectedLanguage = string

/** 与 viewStore.LANGUAGE_OPTIONS 一致的兜底语言 id */
export const PLAINTEXT_LANGUAGE = 'plaintext'

/**
 * 扩展名 → 语言映射表（INT-001 任务给定清单；key 一律小写，查表前同样归一）。
 * 未列出的扩展名不在此命中，继续走内容启发式兜底。
 */
const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, DetectedLanguage>> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  py: 'python',
  java: 'java',
  go: 'go',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  htm: 'html',
  css: 'css',
  xml: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
}

/**
 * 内容采样的行数上限（INT-001 任务给定：前 512 行足够）。
 * 启发式模式都锚定在「文件头部形态」，截断采样不影响判定效果。
 */
const SAMPLE_MAX_LINES = 512

/** 内容采样的字符上限：限制正则扫描成本（512 行极端长行时的保护） */
const SAMPLE_MAX_CHARS = 65536

/**
 * 从文件名提取语言（扩展名优先级的第一级）。
 *
 * @param filename 文件名或完整路径（路径只取 basename；含盘符 / 混合分隔符均可）
 * @returns 命中的语言 id；无扩展名 / 未知扩展名 / 非法输入返回 null（继续兜底）
 *
 * 细节：
 * - 隐藏文件（如 '.gitignore'）按「无扩展名」处理（点在首位不是扩展名分隔）；
 * - 扩展名大小写不敏感（'.PY' 与 '.py' 同判）；
 * - 多重点（如 'a.min.js'）取最后一个点之后的部分。
 */
function detectByFilename(filename: string): DetectedLanguage | null {
  if (typeof filename !== 'string' || filename === '') return null
  // 取 basename（容忍 Windows / POSIX 混合分隔符），再取最后一个点之后的部分
  const base = filename.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null // 无点（无扩展名）或首位点（隐藏文件）
  const ext = base.slice(dot + 1).toLowerCase()
  return EXTENSION_LANGUAGE_MAP[ext] ?? null
}

/** 抽取内容采样：前 512 行 + 字符数上限（split 带 limit 在主流引擎会提前停止） */
function sampleOf(content: string): string {
  return content
    .split('\n', SAMPLE_MAX_LINES)
    .join('\n')
    .slice(0, SAMPLE_MAX_CHARS)
}

/** 判断字符是否空白字符（contentBounds 首尾扫描用，覆盖空格 / 制表 / 换行 / 回车） */
function isWs(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'
}

/**
 * 内容首尾非空白字符的下标（实时对比下每次输入都可能触发检测，刻意用
 * 下标扫描而非 trim() —— 避免 5MB 级文本的整体拷贝）。
 *
 * @returns {first, last} 首个 / 末个非空白字符下标；全空白内容返回 null
 */
function contentBounds(content: string): { first: number; last: number } | null {
  let i = 0
  let j = content.length - 1
  while (i <= j && isWs(content[i])) i++
  while (j >= i && isWs(content[j])) j--
  if (j < i) return null
  return { first: i, last: j }
}

/**
 * 对一段完整内容执行内容启发式（JSON 形态看全文首尾，其余看采样）。
 */
function detectByContent(content: string): DetectedLanguage | null {
  const bounds = contentBounds(content)
  if (bounds === null) return null
  // JSON 形态判定对全文做（采样截断会破坏「以 } 或 ] 结尾」的判定）
  const first = content[bounds.first]
  const last = content[bounds.last]
  if ((first === '{' && last === '}') || (first === '[' && last === ']')) return 'json'
  return detectByContentSample(sampleOf(content))
}

/*
 * 内容启发式的各语言模式（置信度顺序见 detectByContent）。
 * 带修饰说明的规则是对任务给定口径的收紧（防误报），理由见行内注释。
 */
const XML_DECL_RE = /^<\?xml\b/i
const XML_TAG_OPEN_RE = /^<[A-Za-z_][\w.:$-]*[\s>]/
const HTML_DOCTYPE_RE = /^<!doctype\s+html\b/i
const HTML_TAG_RE = /^<html\b/i
/** 任务给定的 CSS 规则块形态：selector { ...prop: value... }（selector 字符集刻意排除 = ; ( 等代码特征） */
const CSS_RULE_START_RE = /^[\s\w.,#:[\]">~+*-]+\{[^}]*:/
/** CSS 次级形态：任意位置的「selector 行 { 含属性声明的块 }」，配合无 <html 守卫 */
const CSS_RULE_RE = /(^|\n)\s*[\w.#>~+*:()[\]"',\s-]*[.#\w-]\s*\{[^{}]*\}/
const CSS_DECL_RE = /\{[^{}]*:[^{}]*\}/
/** YAML：行首「标识符形态的 key:」（要求冒号紧随标识符，避免 Python def foo(): 形态误报） */
const YAML_KEY_RE = /^[A-Za-z_][\w.-]*:(\s|$)/m
/** YAML：存在缩进结构行 */
const YAML_INDENT_RE = /^[ \t]+\S/m
const PYTHON_DEF_RE = /^[ \t]*def\s+\w+\s*\(/m
/** Python import：行尾收束（排除 JS 的 `import x from 'y'` —— from 在模块名之后） */
const PYTHON_IMPORT_RE = /^[ \t]*import\s+[\w.]+(\s+as\s+\w+)?(\s*,\s*[\w.]+(\s+as\s+\w+)?)*\s*$/m
const PYTHON_FROM_RE = /^[ \t]*from\s+[\w.]+\s+import\s/m
/** Go：package 子句行无分号收尾（Java 的 `package a.b;` 因此不命中 Go）；
 * func 规则要求「func 名字 (」或「func (接收器)」形态（JS 的 function 前缀不误报） */
const GO_PACKAGE_RE = /^package\s+\w+\s*$/m
const GO_FUNC_RE = /^[ \t]*func\s+\w+\s*\(|^[ \t]*func\s*\(/m
const JAVA_PACKAGE_RE = /^package\s+[\w.]+;\s*$/m
const JAVA_CLASS_RE = /public\s+(final\s+|abstract\s+)*class\s+\w+/
const JS_DECL_RE = /^(const\s|let\s|var\s|function[\s*])/m
const JS_ARROW_RE = /=>/
const MD_HEADING_RE = /^#{1,6}\s/m
const MD_FENCE_RE = /^```/m
const SQL_KEYWORD_RE = /^[ \t]*(select|insert|update|delete|create)\b/im
const CPP_INCLUDE_RE = /#include\s*[<"]/

/**
 * 内容启发式判定（对采样文本执行，置信度顺序取首个命中）。
 *
 * @param sample 已采样的内容（调用方负责截断；detectByContent 内部已采样）
 * @returns 命中的语言 id；全部未命中返回 null
 */
function detectByContentSample(sample: string): DetectedLanguage | null {
  const trimmed = sample.trim()
  if (trimmed === '') return null

  // 1. HTML 强锚点（<!DOCTYPE html 或 <html 开头）—— 先于 XML 的泛化标签
  //    形态：否则 `<html ...>` 文档会被 XML 的「<标签> 开头且含 </」规则抢走，
  //    HTML 的 <html 分支永不可达（XHTML 以 <?xml 开头，不受影响，仍走 XML）
  if (HTML_DOCTYPE_RE.test(trimmed) || HTML_TAG_RE.test(trimmed)) return 'html'
  // 2. XML（<?xml 声明，或 <tag> 形态开头且含闭合 </）
  if (XML_DECL_RE.test(trimmed)) return 'xml'
  if (XML_TAG_OPEN_RE.test(trimmed) && trimmed.includes('</')) return 'xml'
  // 3. CSS（规则块形态；含 <html 的样例已在 HTML 命中，防御再挡一道）
  if (!/<html/i.test(trimmed)) {
    if (CSS_RULE_START_RE.test(sample)) return 'css'
    if (CSS_RULE_RE.test(sample) && CSS_DECL_RE.test(sample)) return 'css'
  }
  // 4. YAML（标识符形态行首 key: + 缩进结构；括号开头是 JSON 的地盘，防御跳过）
  if (!/^[{[]/.test(trimmed) && YAML_KEY_RE.test(sample) && YAML_INDENT_RE.test(sample)) {
    return 'yaml'
  }
  // 5. Python（def / import / from x import；import 模式行尾收束防 JS 误报）
  if (PYTHON_DEF_RE.test(sample) || PYTHON_IMPORT_RE.test(sample) || PYTHON_FROM_RE.test(sample)) {
    return 'python'
  }
  // 6. Go（package 行无分号 / func 声明；func 规则带词边界，避免 JS 的
  //    function 命中 func 前缀）
  if (GO_PACKAGE_RE.test(sample) || GO_FUNC_RE.test(sample)) return 'go'
  // 7. Java（package 带分号 / public class）
  if (JAVA_PACKAGE_RE.test(sample) || JAVA_CLASS_RE.test(sample)) return 'java'
  // 8. Markdown（标题 + 代码围栏，两者同时出现才算）—— 刻意排在 JavaScript
  //    之前（对任务给定顺序的调整）：md 围栏里常含 const/function 等代码行，
  //    若 JS 在前会把 Markdown 文档误判为 JS；反过来 JS 文件不会在行首出现
  //    # 标题与 ``` 围栏（都不是合法 JS 行首形态），提前无 JS 误报风险
  if (MD_HEADING_RE.test(sample) && MD_FENCE_RE.test(sample)) return 'markdown'
  // 9. JavaScript（const/let/var/function 声明或箭头函数）
  if (JS_DECL_RE.test(sample) || JS_ARROW_RE.test(sample)) return 'javascript'
  // 10. SQL（行首 DML/DDL 关键字，大小写不敏感）
  if (SQL_KEYWORD_RE.test(sample)) return 'sql'
  // 11. C/C++（#include 预处理指令是强特征）
  if (CPP_INCLUDE_RE.test(sample)) return 'cpp'
  return null
}

/**
 * 单文本语言检测（INT-001 主入口之一）。
 *
 * @param filename 文件名 / 路径（可选；非空时扩展名优先）
 * @param content 文本内容（可选；扩展名未命中时启发式兜底）
 * @returns 语言 id（viewStore.LANGUAGE_OPTIONS 口径）；两级都未命中 → 'plaintext'
 */
export function detectLanguage(filename?: string, content?: string): DetectedLanguage {
  const byName = filename !== undefined ? detectByFilename(filename) : null
  if (byName !== null) return byName
  if (content !== undefined) {
    const byContent = detectByContent(content)
    if (byContent !== null) return byContent
  }
  return PLAINTEXT_LANGUAGE
}

/**
 * 成对语言检测（INT-001 主入口：diff 是「本次对比」一个语言值，两侧共用）。
 *
 * 检测优先级链：
 * 1. 左侧文件名扩展名命中 → 用之（左优先 —— 两侧文件名指向不同语言时取左，
 *    与「原始文本优先」的阅读语义一致，本函数的既定约定）；
 * 2. 右侧文件名扩展名命中 → 用之；
 * 3. 左侧内容启发式（JSON 形态对全文判定）；
 * 4. 右侧内容启发式；
 * 5. 合并采样兜底：左右采样拼接（\n 连接）后再过一遍启发式 —— 覆盖
 *    「单侧形态不完备、拼接后命中」的边缘情形（如左侧行以 # 标题结尾、
 *    右侧以 ``` 围栏开头，合并后才构成 Markdown 的完整特征）；
 * 6. 全部未命中 → 'plaintext'。
 *
 * @param leftFileName 左侧文件名（'' = 无）
 * @param rightFileName 右侧文件名（'' = 无）
 * @param leftContent 左侧文本（'' = 空）
 * @param rightContent 右侧文本（'' = 空）
 */
export function detectLanguagePair(
  leftFileName: string,
  rightFileName: string,
  leftContent: string,
  rightContent: string,
): DetectedLanguage {
  const leftByName = detectByFilename(leftFileName)
  if (leftByName !== null) return leftByName
  const rightByName = detectByFilename(rightFileName)
  if (rightByName !== null) return rightByName

  const leftByContent = detectByContent(leftContent)
  if (leftByContent !== null) return leftByContent
  const rightByContent = detectByContent(rightContent)
  if (rightByContent !== null) return rightByContent

  const merged = `${sampleOf(leftContent)}\n${sampleOf(rightContent)}`
  const byMerged = detectByContentSample(merged)
  return byMerged ?? PLAINTEXT_LANGUAGE
}
