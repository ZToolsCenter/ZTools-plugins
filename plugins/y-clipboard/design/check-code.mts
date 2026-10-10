/**
 * 代码块展示 回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-code.mts
 *
 * 覆盖四件事：
 *   1. 语言识别：常见语言能认出来，认不出时返回空串（不瞎标）
 *   2. 行切分与折叠：保留缩进、去首尾空行、超长行截断、超出上限折叠
 *   3. 行高：与 CodeCard 的 CSS 排版严格对齐（虚拟列表算错高度就会错位）
 *   4. 语法着色：关键字/字符串/注释着色，且任何输入都不会注入 HTML
 */

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望=${String(expected)} 实际=${String(actual)}`}`)
}

const {
  codeLangOf, codeLines, codeIsClipped, highlightLines,
  CODE_MAX_LINES, CODE_MAX_CHAR, CODE_PREVIEW_MAX_LINES
} = await import('../src/utils/code.ts')
const {
  codeRowHeight, CODE_LINE_H, CODE_BLOCK_PAD, CODE_BLOCK_BORDER, CODE_CARD_PAD, CODE_META_H,
  CODE_MORE_H, CODE_MIN_H, ROW_GAP
} = await import('../src/utils/layout.ts')

/* ------------------------------------------------------------------ */
/* 1. 语言识别                                                         */
/* ------------------------------------------------------------------ */

console.log('--- 语言识别 ---')
check('JavaScript', codeLangOf("const a = 1\nconsole.log(a)"), 'JavaScript')
check('TypeScript（类型注解）', codeLangOf('const fn = (a: string): void => {}'), 'TypeScript')
check('TypeScript（interface）', codeLangOf('interface Props { id: number }'), 'TypeScript')
check('JSON（合法）', codeLangOf('{\n  "name": "y-clipboard"\n}'), 'JSON')
check('JSON（非法不当 JSON 报）', codeLangOf('{ name: 1 }'), 'JavaScript')
check('Python', codeLangOf('def main():\n    print("hi")'), 'Python')
check('Java', codeLangOf('public static void main(String[] args) {}'), 'Java')
check('Go', codeLangOf('func main() {\n\tfmt.Println("hi")\n}'), 'Go')
check('SQL', codeLangOf('SELECT id FROM clipboard ORDER BY id'), 'SQL')
check('Shell', codeLangOf('npm run build && git status'), 'Shell')
check('HTML', codeLangOf('<div class="a"><span>hi</span></div>'), 'HTML')
check('CSS', codeLangOf('.card { color: red; margin: 0 auto; }'), 'CSS')
check('PHP', codeLangOf('<?php echo "hi"; ?>'), 'PHP')
check('C/C++', codeLangOf('#include <stdio.h>'), 'C/C++')
check('认不出时返回空串（不瞎标）', codeLangOf('这是一段普通中文说明文字，没有明显的语法特征'), '')

/* ------------------------------------------------------------------ */
/* 2. 行切分与折叠                                                     */
/* ------------------------------------------------------------------ */

console.log('\n--- 行切分 ---')
check('按换行切分', codeLines('a = 1\nb = 2').length, 2)
check('去掉首部空行', codeLines('\n\na = 1')[0], 'a = 1')
check('去掉尾部空行', codeLines('a = 1\n\n\n').length, 1)
check('保留中间空行（是代码的一部分）', codeLines('a\n\nb').length, 3)
check('制表符展开成 2 空格', codeLines('\ta')[0], '  a')
check('未超上限的行原样保留', codeLines('x'.repeat(CODE_MAX_CHAR))[0].endsWith('…'), false)
check('超长行被截断并加省略号', codeLines('x'.repeat(CODE_MAX_CHAR + 100))[0].endsWith('…'), true)
check('超长行截断后不超过上限', codeLines('x'.repeat(CODE_MAX_CHAR + 100))[0].length, CODE_MAX_CHAR + 1)
// 全屏查看传 0 = 不截断：卡片里被截掉的长行，在那里要能看全
check('全屏查看不截断单行', codeLines('x'.repeat(CODE_MAX_CHAR + 900), 0)[0].length, CODE_MAX_CHAR + 900)
check('全屏查看不截断时不加省略号', codeLines('x'.repeat(CODE_MAX_CHAR + 10), 0)[0].endsWith('…'), false)
// 被截断要能如实报出来：卡片据此提示"超长行已截断 · 展开看全部"
check('短内容不算被截断', codeIsClipped('const a = 1\nconsole.log(a)'), false)
check('恰好到上限不算被截断', codeIsClipped('x'.repeat(CODE_MAX_CHAR)), false)
check('超过上限算被截断', codeIsClipped('a = 1\n' + 'x'.repeat(CODE_MAX_CHAR + 1)), true)
check('制表符展开后再判断长度', codeIsClipped('\t'.repeat(CODE_MAX_CHAR), 10), true)
check('CRLF 视为单个换行', codeLines('a = 1\r\nb = 2').length, 2)

console.log('\n--- 折叠 ---')
const longCode = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n')
check('展示行数不超过上限', Math.min(codeLines(longCode).length, CODE_MAX_LINES), CODE_MAX_LINES)
check('折叠后卡片高度仍随行数封顶', codeRowHeight({ content: longCode } as any), codeRowHeight({ content: Array.from({ length: CODE_MAX_LINES + 3 }, (_, i) => `l${i}`).join('\n') } as any))
check('行数更多不会更高（已封顶）', codeRowHeight({ content: longCode } as any) <= codeRowHeight({ content: 'a' } as any) + 5 * CODE_LINE_H + CODE_MORE_H + 1, true)

/* ------------------------------------------------------------------ */
/* 3. 行高与排版对齐                                                   */
/* ------------------------------------------------------------------ */

console.log('\n--- 行高 ---')
const expectH = (lines: number, more: boolean) =>
  Math.round(
    Math.max(
      CODE_MIN_H,
      CODE_CARD_PAD * 2 + CODE_META_H + 4
        + (CODE_BLOCK_PAD + CODE_BLOCK_BORDER) * 2 + lines * CODE_LINE_H + (more ? CODE_MORE_H : 0)
    ) + ROW_GAP
  )
check('单行代码块', codeRowHeight({ content: 'const a = 1' } as any), expectH(1, false))
check('三行代码块', codeRowHeight({ content: 'a\nb\nc' } as any), expectH(3, false))
check('超过上限时多一条折叠提示', codeRowHeight({ content: longCode } as any), expectH(CODE_MAX_LINES, true))
check('空内容按一行算（不塌成 0）', codeRowHeight({ content: '' } as any), expectH(1, false))
// DOM 的 offsetHeight 是含边框的，公式漏掉边框就会比真实高度少 2px
const noBorderH = (lines: number) =>
  Math.round(
    Math.max(CODE_MIN_H, CODE_CARD_PAD * 2 + CODE_META_H + 4 + CODE_BLOCK_PAD * 2 + lines * CODE_LINE_H) + ROW_GAP
  )
check('边框计入行高（漏掉会让虚拟列表少算 2px）', codeRowHeight({ content: 'a\nb\nc' } as any) - noBorderH(3), 2)
check('单行时取最小高度（不比文本行单薄）', codeRowHeight({ content: 'a' } as any) >= CODE_MIN_H, true)
check('代码行高于普通文本行（要放得下代码块）', codeRowHeight({ content: 'a\nb' } as any) > 72 + ROW_GAP, true)

/* ------------------------------------------------------------------ */
/* 4. 语法着色                                                         */
/* ------------------------------------------------------------------ */

console.log('\n--- 着色 ---')
const jsHtml = highlightLines(['const a = "hi" // 注释'], 'JavaScript')[0]
check('关键字着色', jsHtml.includes('<span class="tk-kw">const</span>'), true)
check('字符串着色', jsHtml.includes('<span class="tk-str">'), true)
check('行注释着色', jsHtml.includes('<span class="tk-com">// 注释</span>'), true)
check('数字着色', highlightLines(['const n = 42'], 'JavaScript')[0].includes('<span class="tk-num">42</span>'), true)
check('函数调用着色', highlightLines(['doSomething(1)'], 'JavaScript')[0].includes('<span class="tk-fn">doSomething</span>'), true)
check('无关键字语言不着色关键字', highlightLines(['const a = 1'], '')[0].includes('tk-kw'), false)

console.log('\n--- 块注释跨行 ---')
const blockLines = highlightLines(['/* 开始', '还在注释里', '结束 */', 'const a = 1'], 'JavaScript')
check('块注释首行', blockLines[0].includes('tk-com'), true)
check('块注释中间行整行是注释', blockLines[1].startsWith('<span class="tk-com">') && blockLines[1].endsWith('</span>'), true)
check('块注释结束后恢复', blockLines[2].includes('tk-com'), true)
check('块注释之后的代码正常着色', blockLines[3].includes('tk-kw'), true)

console.log('\n--- 转义只做一次（否则屏幕上是 =&gt; 这种字面量）---')
const arrow = highlightLines(['const f = (a) => a'], 'JavaScript')[0]
check('=> 转义一次', arrow.includes('=&gt;'), true)
check('没有被二次转义成 &amp;gt;', arrow.includes('&amp;gt;'), false)
check('DOM 里应渲染为 =>', arrow.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>'), 'const f = (a) => a')
check('单引号字符串着色', highlightLines(["const s = 'hi'"], 'JavaScript')[0].includes('tk-str'), true)
check('尖括号转义且只转一次', highlightLines(['a < b && c'], 'JavaScript')[0], 'a &lt; b &amp;&amp; c')
check('Python 的 # 是注释', highlightLines(['x = 1  # 说明'], 'Python')[0].includes('tk-com'), true)

console.log('\n--- 语言不该抢错 ---')
check('TS 片段不因 export 判成 Shell', codeLangOf('interface Props {\n  id: number\n}\n\nexport function Card() {}'), 'TypeScript')
check('真命令行仍是 Shell', codeLangOf('npm run build && git add -A'), 'Shell')

console.log('\n--- 安全（剪贴板内容不可信）---')
const evil = highlightLines(['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>'], 'JavaScript').join('')
check('尖括号被转义', evil.includes('<script>'), false)
check('不产出可执行标签', /<(script|img)/i.test(evil), false)
check('onerror 只是文本', evil.includes('onerror'), true)
check('保留原文内容可见', evil.includes('alert'), true)

/* ------------------------------------------------------------------ */
/* 5. 分类：命令行也算代码                                             */
/* ------------------------------------------------------------------ */

console.log('\n--- 分类 ---')
// api.ts 顶层会判断有无宿主，先摆一个最小 stub 再 import
;(globalThis as any).window = { ztools: {} }
const { detectKind, looksLikeShell } = await import('../src/api.ts')

check('npm 命令', detectKind('npm run build && git add -A'), 'code')
check('git 单行命令', detectKind('git commit -m "feat: 代码块展示"'), 'code')
check('ssh 连接命令', detectKind('ssh -p 2222 dev@10.0.0.12'), 'code')
check('散文里提到 npm 不算代码', detectKind('我刚用 npm 装了个包，然后 git 提交了代码'), 'text')
check('普通中文文本不受影响', detectKind('会议纪要：周三评审剪贴板插件交互稿，重点看键盘流是否顺'), 'text')
check('链接仍是链接', detectKind('https://vuejs.org/guide/introduction.html'), 'link')
check('颜色值仍是颜色', detectKind('#5B8DEF'), 'color')
check('代码片段仍能识别', detectKind('const a = 1\nconsole.log(a)'), 'code')
check('太短的词不当命令', looksLikeShell('cd'), false)
check('带路径的 cd 算命令', looksLikeShell('cd /Users/me/project'), true)

/* ------------------------------------------------------------------ */
/* 6. 代码块恒定暗底：不随主题切换（CSS 层面断言）                      */
/* ------------------------------------------------------------------ */

console.log('\n--- 代码块配色 ---')
const { readFileSync } = await import('node:fs')
const css = readFileSync(new URL('../src/main.css', import.meta.url), 'utf8')
const card = readFileSync(new URL('../src/components/CodeCard.vue', import.meta.url), 'utf8')

/** 取某个选择器块内的 CSS 文本 */
function blockOf(source: string, selector: string): string {
  const i = source.indexOf(selector + ' {')
  if (i < 0) return ''
  let depth = 0
  for (let j = i + selector.length; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}' && --depth === 0) return source.slice(i, j + 1)
  }
  return ''
}

/** 块内某个自定义属性的值 */
function varOf(block: string, name: string): string {
  const m = block.match(new RegExp(`\\${name}\\s*:\\s*([^;]+);`))
  return m ? m[1].trim() : ''
}

/** 十六进制颜色的相对亮度（0 黑 ~ 255 白），用于判断深浅 */
function luma(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return NaN
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const rootBlock = blockOf(css, ':root')
const darkBlock = blockOf(css, '.dark')

const codeBg = varOf(rootBlock, '--code-bg')
const codeFg = varOf(rootBlock, '--code-fg')

check('代码块底色存在', /^#[0-9a-f]{6}$/i.test(codeBg), true)
check('底色是暗色（亮度 < 60）', luma(codeBg) < 60, true)
check('前景是浅色（亮度 > 150）', luma(codeFg) > 150, true)
check('前景/底色对比足够（亮度差 > 120）', luma(codeFg) - luma(codeBg) > 120, true)
check('有 hover 提亮档位', varOf(rootBlock, '--code-bg-hover') !== '', true)
check('暗底用浅色描边', varOf(rootBlock, '--code-border').includes('235'), true)

// 整套 token 颜色都只许出现在 :root，.dark 里一旦再覆盖就变回"随主题走"
const codeVars = ['--code-bg', '--code-fg', '--tk-kw', '--tk-str', '--tk-num', '--tk-fn', '--tk-type']
for (const v of codeVars) {
  check(`.dark 不覆盖 ${v}`, varOf(darkBlock, v), '')
}

// 六种 token 颜色必须彼此不同，否则等于没着色
const tokenColors = ['--tk-kw', '--tk-str', '--tk-com', '--tk-num', '--tk-fn', '--tk-type'].map((v) => varOf(rootBlock, v))
check('六种 token 颜色互不相同', new Set(tokenColors).size, tokenColors.length)
check('注释色比正文色暗（退到背景里）', luma(varOf(rootBlock, '--tk-com')) < luma(codeFg), true)

check('代码行用块内前景色而非主题文字色', /\.cline\s*\{[^}]*color:\s*var\(--code-fg\)/.test(card), true)
check('代码块边框用暗底描边', /\.code\s*\{[^}]*border:\s*1px solid var\(--code-border\)/.test(card), true)
check('背景已不再是透明叠色', css.includes('--code-bg: rgba'), false)

/* ------------------------------------------------------------------ */
/* 7. 横向超出的内容必须能看到                                          */
/* ------------------------------------------------------------------ */

console.log('\n--- 横向可查看 ---')
const preview = readFileSync(new URL('../src/components/CodePreview.vue', import.meta.url), 'utf8')
const vlist = readFileSync(new URL('../src/components/VirtualList.vue', import.meta.url), 'utf8')

// 卡片层：代码块可横滚，且滚出来的内容不再被 CSS 砍掉
check('代码块可横向滚动', /\.code\s*\{[^}]*overflow-x:\s*auto/.test(card), true)
check('代码块不产生纵向滚动', /\.code\s*\{[^}]*overflow-y:\s*hidden/.test(card), true)
check('内容按最长行撑开', /\.code-inner\s*\{[^}]*width:\s*max-content/.test(card), true)
check('行内保留原始空白（pre）', /\.cline\s*\{[^}]*white-space:\s*pre\b/.test(card), true)
check('不再用省略号硬截行', /\.cline\s*\{[^}]*text-overflow/.test(card), false)
check('右侧有渐变提示还有内容', /\.fade\s*\{[^}]*linear-gradient/.test(card), true)
// 横向滚动条一旦占位，块高就变了，而虚拟列表的行高是预算好的 —— 必须隐藏
check('隐藏横向滚动条（否则改变块高）', /\.code\s*\{[^}]*scrollbar-width:\s*none/.test(card), true)
check('webkit 滚动条也隐藏', /\.code::-webkit-scrollbar\s*\{[^}]*display:\s*none/.test(card), true)
check('换记录时横向位置归零', /props\.record\.id[\s\S]{0,200}scrollLeft\s*=\s*0/.test(card), true)
check('卡片能发出展开事件', /emit\(\s*'preview'\s*\)/.test(card), true)

// 全屏层：完整内容 + 自动换行兜底 + 行号
check('全屏查看不截断字符', /codeLines\(props\.record\.content,\s*0\)/.test(preview), true)
check('全屏默认自动换行（保证一眼看全）', /const wrap = ref\(true\)/.test(preview), true)
check('全屏可切换换行/横滚', /wrap = !wrap/.test(preview), true)
check('全屏带行号', /class="ln"/.test(preview), true)
check('行号不参与复制选择', /\.ln\s*\{[^}]*user-select:\s*none/.test(preview), true)
check('超长文件有渲染上限', new RegExp(`slice\\(0,\\s*CODE_PREVIEW_MAX_LINES\\)`).test(preview), true)
check('上限值足够大', CODE_PREVIEW_MAX_LINES >= 1000, true)
check('全屏仍提示复制带走全部', preview.includes('复制带走全部'), true)

// 列表要把代码卡片的展开事件往上传
check('列表转发代码卡片的展开事件', /v-else-if="row\.rec\.kind === 'code'"[\s\S]{0,400}@preview="emit\('preview', row\.rec\)"/.test(vlist), true)

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
