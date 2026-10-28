import type { ClipboardRecord } from '../types'

/**
 * 代码片段的展示处理：语言识别、行切分、折叠、语法着色。
 *
 * 代码类记录原本被压成一行纯文本（换行、缩进全丢），基本不可读。
 * 这里把它还原成真正的代码块再交给 CodeCard 渲染：
 * 保留换行与缩进、等宽字体、标注语言与行数、超长片段折叠。
 */

/** 列表里最多展示几行，其余折叠（行高可控，列表才扫得动） */
export const CODE_MAX_LINES = 5
/**
 * 列表卡片里单行最多保留多少字符。
 *
 * 卡片是**横向可滚动**的，所以这里不再是为了"防撑爆宽度"（那是 old 160 的理由），
 * 而是给极端内容兜底：压缩成一行的 JS、base64 这类内容可能有几万字符，
 * 全量塞进 DOM 会拖慢渲染。卡片里截断即可，完整内容在全屏查看里看。
 */
export const CODE_MAX_CHAR = 500
/** 全屏查看最多渲染多少行（超大文件只渲染前面部分，避免卡死页面） */
export const CODE_PREVIEW_MAX_LINES = 2000
/** 制表符展开成几个空格：等宽字体下缩进才对得齐 */
const TAB_WIDTH = 2

/* ------------------------------------------------------------------ */
/* 语言识别                                                            */
/* ------------------------------------------------------------------ */

/**
 * 语言识别规则：命中即用，**数组顺序即优先级**。
 *
 * 顺序上把"特征最独特"的放前面（PHP/HTML/SQL 这些不会被别的语言长成），
 * 把 JavaScript / Shell 这类通用词最多的放后面 —— 否则 `export`（Shell 与 JS 都有）
 * 之类的词会把一个 TS 片段误判成 Shell。
 */
const LANG_RULES: Array<[string, RegExp]> = [
  ['PHP', /<\?php/],
  ['Dockerfile', /^\s*FROM\s+\S+/m],
  ['SQL', /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i],
  // TS/JS 的"强特征"必须在 HTML 之前判：JSX 里带 <div> 的 TS 片段
  // 只看标签会误判成 HTML，而 interface / 类型注解 / 行首关键字不会出现在 HTML 里
  ['TypeScript', /\b(interface|type|enum)\s+[A-Z]\w*|:\s*(string|number|boolean|void|any|unknown|never)\b|\bReact\.FC\b|\bas\s+const\b/],
  ['JavaScript', /^\s*(import|export|const|let|var|function|class)\s/m],
  ['HTML', /<!DOCTYPE\s+html|<\/?(html|head|body|div|span|script|style|section|ul|li|table)\b/i],
  ['CSS', /@media|@import|[.#][\w-]+\s*\{[^}]*:[^}]*;|\b[a-z-]+\s*:\s*[^;{]+;/i],
  ['Java', /\b(public|private|protected)\s+(static\s+)?(void|final|class|int|String|boolean)\b|System\.out\./],
  ['Go', /\bfunc\s+\w+\s*\(|^\s*package\s+\w+|fmt\./m],
  ['Python', /^\s*def\s+\w+\s*\(|^\s*(import|from)\s+\w+(\s+import)?$|^\s*print\(|\bself\./m],
  ['C/C++', /#include\s*[<"]|\bint\s+main\s*\(|std::/],
  ['JavaScript', /\(\s*\)\s*=>|=>|require\(|module\.exports|console\.|\.then\(/],
  // Shell 的特征词（export/echo 等）在别的语言里也常见，放最后
  ['Shell', /^\s*(npm|pnpm|yarn|git|docker|docker-compose|cd|ls|mkdir|sudo|curl|ssh|chmod|chown)\s/m],
  ['YAML', /^\s*[\w.-]+:\s*(\S|$)/m]
]

/**
 * 识别代码语言；识别不出返回空串（卡片就不显示语言标签，不瞎猜）。
 * 纯靠内容特征，不依赖任何外部库。
 */
export function codeLangOf(text: string): string {
  const t = String(text ?? '').trim()
  if (!t) return ''
  // JSON 单独用解析验证，避免把任何 "{...}" 都当成 JSON；
  // 解析失败但确实是 {}/[] 开头时，按 JavaScript 的对象/数组字面量处理
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t)
      return 'JSON'
    } catch {
      return 'JavaScript'
    }
  }
  for (const [lang, re] of LANG_RULES) {
    if (lang === 'JSON') continue
    if (re.test(t)) return lang
  }
  return ''
}

/* ------------------------------------------------------------------ */
/* 行切分与折叠                                                        */
/* ------------------------------------------------------------------ */

/**
 * 切出用于展示的行：去掉首尾空行、展开制表符、按需裁剪超长行。
 *
 * @param maxChar 单字符上限；传 0 表示**不截断**（全屏查看用，那里能自由横滚）
 */
export function codeLines(text: string, maxChar: number = CODE_MAX_CHAR): string[] {
  const raw = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' '.repeat(TAB_WIDTH))
    .split('\n')
  // 首尾空行没有信息量，去掉；中间的空行是代码的一部分，保留
  while (raw.length && raw[0].trim() === '') raw.shift()
  while (raw.length && raw[raw.length - 1].trim() === '') raw.pop()
  return raw.map((l) =>
    maxChar > 0 && l.length > maxChar ? l.slice(0, maxChar) + '…' : l
  )
}

/** 代码块实际渲染的行数（超出上限折叠成一行"还有 N 行"） */
export function codeLinesOf(r: ClipboardRecord): number {
  return Math.min(Math.max(codeLines(r.content).length, 1), CODE_MAX_LINES)
}

/**
 * 是否存在被字符上限截断的超长行。
 *
 * 卡片里超长行截断后末尾会带省略号，但用户看不出来"是内容就这么长"还是"被我们截了"，
 * 得如实说一声 —— 提示文案上区别对待（"已截断 · 展开看全部"）。
 */
export function codeIsClipped(text: string, maxChar: number = CODE_MAX_CHAR): boolean {
  return String(text ?? '')
    .split(/\r\n?|\n/)
    .some((l) => l.replace(/\t/g, ' '.repeat(TAB_WIDTH)).length > maxChar)
}

/* ------------------------------------------------------------------ */
/* 语法着色                                                            */
/* ------------------------------------------------------------------ */

const KEYWORDS: Record<string, string> = {
  js: 'const let var function return if else for while do new class extends import export from default await async try catch finally throw typeof instanceof delete void yield super this null undefined true false switch case break continue in of static get set',
  ts: 'interface type enum implements private public protected readonly namespace declare as is keyof infer satisfies unknown never any string number boolean',
  py: 'def class return if elif else for while import from as with try except finally raise lambda yield pass break continue global nonlocal assert del in is not and or none true false self',
  java: 'public private protected static final void class interface extends implements new return if else for while try catch finally throw throws package import null true false this super instanceof enum abstract native synchronized volatile transient',
  go: 'func package import return if else for range var const type struct interface map chan go defer select switch case default nil true false string int error',
  sql: 'select from where insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset as and or not null distinct union case when then else end count sum avg max min',
  php: 'function class return if else elseif foreach for while echo print new public private protected static extends implements namespace use require include null true false var const array',
  c: 'include define ifdef endif int char float double void struct union enum typedef static const return if else for while switch case break continue sizeof null std',
  sh: 'if then else fi for while do done case esac function export local echo cd sudo return npm git docker',
  json: 'true false null',
  yaml: 'true false null yes no'
}

/** 语言 → 关键字包名 */
const KW_PACK: Record<string, string[]> = {
  JavaScript: ['js'],
  TypeScript: ['js', 'ts'],
  JSON: ['json'],
  Python: ['py'],
  Java: ['java'],
  Go: ['go'],
  SQL: ['sql'],
  PHP: ['php'],
  'C/C++': ['c'],
  Shell: ['sh'],
  Dockerfile: ['sh'],
  YAML: ['yaml']
}

/** 行注释符号（按语言；CSS/HTML 只有块注释，不参与单行 # 判定） */
const LINE_COMMENT: Record<string, string> = {
  Python: '#',
  Shell: '#',
  Dockerfile: '#',
  YAML: '#',
  SQL: '--'
}
const DEFAULT_LINE_COMMENT = '//'

/**
 * HTML 转义。只处理 `& < >`：
 * 着色结果输出在元素**内容**里（不是属性），引号无需转义；
 * 而把引号转成 `&#39;` 会引入数字，反而会被数字着色规则误命中。
 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 字符串字面量：单双引号成对（未闭合时容错到行尾） */
const STR_RE = `"[^"]*"?|'[^']*'?`

/** 块注释：闭合的整段，或"起始之后到行尾"（未闭合，标记下一行继续） */
const BLOCK_RE = '/\\*[\\s\\S]*?\\*/|/\\*[\\s\\S]*$|<!--[\\s\\S]*?-->|<!--[\\s\\S]*$'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildTokenRe(lineComment: string): RegExp {
  return new RegExp(
    [
      `(${STR_RE})`, // 1 字符串
      `(${escapeRe(lineComment)}[^\\n]*)`, // 2 行注释
      `(${BLOCK_RE})`, // 3 块注释
      '(\\b\\d+(?:\\.\\d+)?\\b)', // 4 数字
      '([A-Za-z_$@][\\w$-]*)' // 5 标识符
    ].join('|'),
    'g'
  )
}

/**
 * 着色一段"确定不在块注释中"的文本。
 *
 * 先整段转义再做 token 化：这样正则面对的是已经无害的文本，
 * 输出的 HTML 里不可能出现源内容带来的标签，也不会有实体被拆坏。
 */
function paint(line: string, kw: Set<string>, re: RegExp): string {
  const src = esc(line)
  let html = ''
  let last = 0
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const [full, str, lineComment, block, num, id] = m
    // src 已经转义过：这里**不能**再 esc 一次，否则 &gt; 会变成 &amp;gt;
    html += src.slice(last, m.index)
    last = m.index + full.length
    if (str !== undefined) html += `<span class="tk-str">${full}</span>`
    else if (lineComment !== undefined) html += `<span class="tk-com">${full}</span>`
    else if (block !== undefined) html += `<span class="tk-com">${full}</span>`
    else if (num !== undefined) html += `<span class="tk-num">${full}</span>`
    else if (id !== undefined) {
      const next = src.slice(last)
      if (kw.has(id.toLowerCase())) html += `<span class="tk-kw">${full}</span>`
      else if (/^\s*\(/.test(next)) html += `<span class="tk-fn">${full}</span>`
      else if (/^[A-Z][A-Za-z0-9_]*$/.test(id)) html += `<span class="tk-type">${full}</span>`
      else html += full
    } else html += full
  }
  return html + src.slice(last)
}

function kwSetOf(lang: string): Set<string> {
  const packs = KW_PACK[lang] ?? []
  const out = new Set<string>()
  for (const p of packs) {
    for (const w of (KEYWORDS[p] ?? '').split(' ')) if (w) out.add(w)
  }
  return out
}

/**
 * 给一组代码行做语法着色，返回可直接 v-html 的 HTML 数组。
 *
 * 安全：先整段转义 HTML，再只对转义后的文本做 token 替换；
 * 转义产生的实体（&quot; / &amp; …）不含关键字，不会被误着色。
 * 跨行的块注释用状态机处理，避免 /* 之后的每一行都被当成代码。
 */
export function highlightLines(lines: string[], lang: string): string[] {
  const kw = kwSetOf(lang)
  const lc = LINE_COMMENT[lang] ?? DEFAULT_LINE_COMMENT
  const re = buildTokenRe(lc)
  const out: string[] = []
  let inBlock = false

  for (const line of lines) {
    if (!inBlock) {
      const html = paint(line, kw, re)
      // 块注释跨行：本行起始后没有闭合符时，下一行整行仍是注释
      const open = Math.max(line.lastIndexOf('/*'), line.lastIndexOf('<!--'))
      if (open >= 0) {
        const close = Math.max(line.indexOf('*/', open), line.indexOf('-->', open))
        if (close < 0) inBlock = true
      }
      out.push(html)
      continue
    }

    // 处于块注释中：找到闭合符，闭合前的内容整段算注释
    const end = Math.max(
      line.indexOf('*/') >= 0 ? line.indexOf('*/') + 2 : -1,
      line.indexOf('-->') >= 0 ? line.indexOf('-->') + 3 : -1
    )
    if (end < 0) {
      out.push(`<span class="tk-com">${esc(line)}</span>`)
      continue
    }
    inBlock = false
    out.push(`<span class="tk-com">${esc(line.slice(0, end))}</span>` + paint(line.slice(end), kw, re))
  }
  return out
}
