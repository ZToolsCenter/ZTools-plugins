// ==================== 查找/替换（模式状态 + 预置标签 + 高亮导航）====================
// 从 app.js 抽出：查找/替换状态、标点对照数据、预置标签 UI、正则查找、
// 命中高亮与上/下导航。依赖 app.js 全局：$ / applyOp / ops / storeGet /
// showToast / FIND_HIGHLIGHT_* 常量 / findTimer；scheduleFindRun 仍在
// app.js（运行期调用本模块 frRunFind/frActive）。必须在 app.js 之后加载。
// 内含 IIFE 向 ops 挂载 zhPunctToEn/enPunctToZh（ops 来自更早的 text-ops.js）。

let frMode = 'replace'   // 'find' | 'replace'，默认替换
let frRegex = true       // 正则开关，默认开启
let frMatches = []       // 查找命中的 [start, end] 列表
let frIndex = -1         // 当前定位到第几个命中

$('btn-replace').addEventListener('click', () => {
  let find = $('find-input').value
  let replace = $('replace-input').value
  const useRegex = frRegex
  if (!find) return
  // \n \t 在两种模式下都先还原成真实换行/Tab：
  // 正则模式下等价于 \n \t 转义本身；普通模式下让字面匹配/写入真实控制字符
  find = unescapeControlChars(find)
  replace = unescapeControlChars(replace)
  applyOp('替换', text => {
    if (useRegex) {
      const re = new RegExp(find, 'gm')
      return text.replace(re, replace)
    }
    return text.split(find).join(replace)
  })
})

// ==================== 查找替换预置标签 ====================

// 中英文标点对照：每一对上下排列（中文在上、英文在下），方便中英文符号混排时互相替换
const PUNCT_PAIRS = [
  ['，', ','],
  ['。', '.'],
  ['！', '!'],
  ['？', '?'],
  ['；', ';'],
  ['：', ':'],
  ['“', '"'],
  ['”', '"'],
  ['‘', "'"],
  ['’', "'"],
  ['（', '('],
  ['）', ')'],
  ['【', '['],
  ['】', ']'],
  ['｛', '{'],
  ['｝', '}'],
  ['《', '<'],
  ['》', '>'],
  ['、', ',']
]

// 中英文符号互转，基于 PUNCT_PAIRS 预编译，O(n) 单次扫描
;(() => {
  const zhToEn = Object.fromEntries(PUNCT_PAIRS.map(([zh, en]) => [zh, en]))
  const enToZh = {}
  for (const [zh, en] of PUNCT_PAIRS) { if (!(en in enToZh)) enToZh[en] = zh }
  const esc = s => s.replace(/[\]\\^-]/g, '\\$&')
  const zhRe = new RegExp('[' + Object.keys(zhToEn).map(esc).join('') + ']', 'g')
  const enRe = new RegExp('[' + Object.keys(enToZh).map(esc).join('') + ']', 'g')
  ops.zhPunctToEn = text => text.replace(zhRe, c => zhToEn[c])
  ops.enPunctToZh = text => text.replace(enRe, c => enToZh[c])
})()

// 普通：空格/Tab/换行/竖线等常见字符，无论是否开启正则都常驻显示
// Tab/换行无法在单行输入框里直接显示，用 \t \n 文本表示（替换时会做转义还原，见 unescapeControlChars）
const COMMON_TAGS = [
  { label: '|', value: '|' },
  { label: '\\t', value: '\\t', title: 'Tab' },
  { label: '␣', value: ' ', title: '空格' },
  { label: '\\n', value: '\\n', title: '换行' }
]

// 正则辅助（查找字段）
const REGEX_TAGS_FIND = [
  { label: '开头', value: '^', title: '匹配行开头\n示例：^关键词 → 仅匹配以"关键词"开头的行' },
  { label: '结尾', value: '$', title: '匹配行结尾\n示例：关键词$ → 仅匹配以"关键词"结尾的行' },
  { label: '数字', value: '\\d+', title: '匹配一个或多个数字\n示例：价格：\\d+ → 匹配"价格：123"' },
  { label: '模糊', value: '.*?', title: '懒惰匹配任意内容（非贪婪）\n示例：前缀.*?后缀 → 前后有固定文字，中间任意内容均可匹配' },
  { label: '空白', value: '\\s+', title: '匹配一个或多个空白（空格/Tab/换行）\n示例：单词\\s+单词 → 匹配两词之间有空白的情况' },
  { label: '字母', value: '[a-zA-Z]+', title: '匹配一个或多个英文字母\n示例：\\d+[a-zA-Z]+ → 匹配"123px"' },
  { label: '汉字', value: '[\\u4e00-\\u9fa5]+', title: '匹配一个或多个汉字\n示例：[\\u4e00-\\u9fa5]+ → 匹配连续中文，如"你好世界"' }
]

// 正则辅助（替换字段）：仅保留替换语义有效的项
const REGEX_TAGS_REPLACE = [
  { label: '$1', value: '$1', title: '第1个捕获组' },
  { label: '$2', value: '$2', title: '第2个捕获组' },
  { label: '$3', value: '$3', title: '第3个捕获组' },
  { label: '$&', value: '$&', title: '整个匹配内容' }
]

// 非正则模式下，把字面 \n \t 还原为真实的换行符/Tab，方便用 \n \t 表达控制字符
function unescapeControlChars(text) {
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

function renderTags() {
  const useRegex = frRegex
  renderTagRow('find-tags', 'find-input', useRegex, REGEX_TAGS_FIND)
  renderTagRow('replace-tags', 'replace-input', useRegex, REGEX_TAGS_REPLACE)
}

function renderTagRow(rowId, inputId, useRegex, regexTags) {
  const row = $(rowId)
  row.innerHTML = ''

  // 第一块：中英文标点对照
  const punctGroup = document.createElement('div')
  punctGroup.className = 'tag-group'
  PUNCT_PAIRS.forEach(([zh, en]) => {
    punctGroup.appendChild(makeTagBtn(inputId, { label: zh, value: zh }, false))
    punctGroup.appendChild(makeTagBtn(inputId, { label: en, value: en }, false))
  })
  row.appendChild(punctGroup)

  // 第二块：普通常见字符
  const commonGroup = document.createElement('div')
  commonGroup.className = 'tag-group'
  COMMON_TAGS.forEach(t => commonGroup.appendChild(makeTagBtn(inputId, t, false)))
  row.appendChild(commonGroup)

  // 第三块：正则辅助，查找/替换字段各用各自的标签集
  if (useRegex) {
    const regexGroup = document.createElement('div')
    regexGroup.className = 'tag-group'
    regexTags.forEach(t => regexGroup.appendChild(makeTagBtn(inputId, t, true)))
    row.appendChild(regexGroup)
  }
}

function makeTagBtn(inputId, t, isRegex) {
  const btn = document.createElement('button')
  btn.className = 'tag-btn' + (isRegex ? ' regex-tag' : '')
  btn.textContent = t.label
  btn.title = t.title || t.value
  btn.addEventListener('click', () => {
    let val = t.value
    if (!isRegex && inputId === 'find-input' && frRegex) {
      val = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    insertTagValue(inputId, val)
  })
  return btn
}

function insertTagValue(inputId, value) {
  const input = $(inputId)
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? input.value.length
  input.value = input.value.slice(0, start) + value + input.value.slice(end)
  const pos = start + value.length
  input.focus()
  input.setSelectionRange(pos, pos)
}

// ---- 查找 / 替换 模式控制 ----

// 查找高亮是否生效：处于查找模式且查找替换 tab 可见
function frActive() {
  return frMode === 'find' && $('tab-find-replace').style.display !== 'none'
}

// 根据 frMode / frRegex 刷新整块 UI（字段显隐、按钮、分段高亮、标签、高亮背板）
function frUpdateUI() {
  const isFind = frMode === 'find'
  $('replace-field').style.display = isFind ? 'none' : ''
  $('btn-replace').style.display = isFind ? 'none' : ''
  document.querySelectorAll('#fr-mode-toggle .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === frMode))
  document.querySelectorAll('#fr-regex-toggle .seg-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.regex === 'on') === frRegex))
  renderTags()
  if (isFind) frRunFind()
  else frClearHighlights()
}

// 由 find-input 当前内容构造正则；纯文本模式下转义特殊字符
function frBuildRegex() {
  let pat = $('find-input').value
  if (!pat) return null
  pat = unescapeControlChars(pat)
  if (!frRegex) pat = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try { return new RegExp(pat, 'gm') } catch (e) { return null }
}

// 扫描编辑器全文，收集命中、渲染高亮背板、更新计数
// keepIndex=true 时保留当前定位且不滚动（供实时输入/编辑时调用，避免抢焦点）
function frRunFind(keepIndex) {
  clearTimeout(findTimer)
  findTimer = null
  const re = frBuildRegex()
  const text = $('editor').value
  frMatches = []
  if (re) {
    let m
    while ((m = re.exec(text))) {
      frMatches.push([m.index, m.index + m[0].length])
      if (m[0].length === 0) re.lastIndex++   // 防零宽匹配死循环
    }
  }
  if (frMatches.length === 0) frIndex = -1
  else if (!keepIndex || frIndex < 0 || frIndex >= frMatches.length) frIndex = 0
  frRenderHighlights()
  frUpdateNav()
  if (frMatches.length && !keepIndex) frScrollToCurrent()
}

function frRenderHighlights() {
  const content = document.querySelector('.eh-content')
  if (!content) return
  const text = $('editor').value
  if (
    frMode !== 'find' ||
    frMatches.length === 0 ||
    text.length > FIND_HIGHLIGHT_TEXT_LIMIT ||
    frMatches.length > FIND_HIGHLIGHT_MATCH_LIMIT
  ) {
    content.innerHTML = ''
    frSyncHighlight()
    return
  }
  let html = '', pos = 0
  frMatches.forEach(([s, e], i) => {
    html += escHtmlDiff(text.slice(pos, s))
    html += `<mark${i === frIndex ? ' class="fr-cur"' : ''}>` + escHtmlDiff(text.slice(s, e)) + '</mark>'
    pos = e
  })
  html += escHtmlDiff(text.slice(pos))
  content.innerHTML = html
  frSyncHighlight()
}

// 背板与文本框对齐：内容宽度取文本框可视宽，滚动用 transform 跟随
function frSyncHighlight() {
  const editor = $('editor')
  const content = document.querySelector('.eh-content')
  if (!content) return
  content.style.width = editor.clientWidth + 'px'
  content.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`
}

function frClearHighlights() {
  frMatches = []
  frIndex = -1
  const content = document.querySelector('.eh-content')
  if (content) content.innerHTML = ''
  frUpdateNav()
}

function frUpdateNav() {
  const onFindTab = $('tab-find-replace').style.display !== 'none'
  const show = frMode === 'find' && onFindTab
  $('fr-nav').style.display = show ? 'flex' : 'none'
  if (!show) return
  const total = frMatches.length
  $('fr-counter').textContent = `${total ? frIndex + 1 : 0} / ${total}`
  $('fr-prev').disabled = total === 0
  $('fr-next').disabled = total === 0
}

// 把当前命中滚入视口（按行号估算，避免 focus 抢走查找框焦点）
function frScrollToCurrent() {
  if (frIndex < 0 || !frMatches[frIndex]) return
  const editor = $('editor')
  const line = editor.value.slice(0, frMatches[frIndex][0]).split('\n').length - 1
  const lineHeight = 13 * 1.5
  const target = line * lineHeight
  const view = editor.clientHeight
  if (target < editor.scrollTop + 20 || target > editor.scrollTop + view - 40) {
    editor.scrollTop = Math.max(0, target - view / 2)
    $('line-numbers').scrollTop = editor.scrollTop
  }
  frSyncHighlight()
}

function frGoto(delta) {
  if (frMatches.length === 0) return
  frIndex = (frIndex + delta + frMatches.length) % frMatches.length
  frRenderHighlights()
  frUpdateNav()
  frScrollToCurrent()
}

document.querySelectorAll('#fr-mode-toggle .seg-btn').forEach(b => {
  b.addEventListener('click', () => { frMode = b.dataset.mode; frUpdateUI() })
})
document.querySelectorAll('#fr-regex-toggle .seg-btn').forEach(b => {
  b.addEventListener('click', () => { frRegex = b.dataset.regex === 'on'; frUpdateUI() })
})
$('fr-prev').addEventListener('click', () => frGoto(-1))
$('fr-next').addEventListener('click', () => frGoto(1))
$('find-input').addEventListener('input', () => { if (frMode === 'find') scheduleFindRun(true) })
$('find-input').addEventListener('keydown', e => {
  if (frMode === 'find' && e.key === 'Enter') {
    e.preventDefault()
    frGoto(e.shiftKey ? -1 : 1)
  }
})
window.addEventListener('resize', () => {
  if (resizeWorkFrame) return
  resizeWorkFrame = requestAnimationFrame(() => {
    resizeWorkFrame = null
    if (frActive()) frSyncHighlight()
    applyEditorSplitWidth()
    updateCount()
    if (compareOpen) applyCompareWidth()
    if (isSketchOpen()) resizeSketchCanvas()
    if (isToolPanelOpen()) fitToolHeightToContent()
  })
})

frUpdateUI()
