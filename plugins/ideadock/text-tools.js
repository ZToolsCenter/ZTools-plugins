// ==================== 文本工具面板：Markdown 格式化 + 代码/JSON/YAML ====================
// 从 app.js 抽出：md-tools / lang-tools-code / lang-tools-json / lang-tools-yaml
// 四个工具面板的按钮分发。依赖 app.js 全局：$ / applyOp / ops（含 app.js
// 挂载的 ops.htmlFormat）/ saveLang / applyLang。必须在 app.js 之后加载。

// 行前缀切换：全部已有则去除，否则添加（标题类先清除已有标题前缀）
function mdLinePrefixFn(prefix) {
  const isHeading = /^#{1,6} $/.test(prefix)
  const headingRe = /^#{1,6} /
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('^' + escapedPrefix)
  return text => {
    const lines = text.split(/\r?\n/)
    const nonEmpty = lines.filter(l => l.trim())
    const allHave = nonEmpty.length > 0 && nonEmpty.every(l => l.startsWith(prefix))
    return lines.map(l => {
      if (!l.trim()) return l
      if (allHave) return l.replace(re, '')
      if (isHeading) return prefix + l.replace(headingRe, '')
      return prefix + l
    }).join('\n')
  }
}

function mdTaskListFn(text) {
  const taskRe = /^\s*[-*+]\s+\[[ xX]\]\s*/
  const listRe = /^\s*(?:[-*+]\s+|\d+[.)、。]\s*)/
  const lines = text.split(/\r?\n/)
  const nonEmpty = lines.filter(l => l.trim())
  const allTask = nonEmpty.length > 0 && nonEmpty.every(l => taskRe.test(l))
  return lines.map(l => {
    if (!l.trim()) return l
    if (allTask) return l.replace(taskRe, '')
    return '- [ ] ' + l.replace(listRe, '')
  }).join('\n')
}

// 行内包裹：有选区则包裹选区，无选区则插入标记并将光标置于中间
function applyMdInline(open, close, label) {
  const editor = $('editor')
  const { selectionStart, selectionEnd } = editor
  if (selectionEnd <= selectionStart) {
    const before = editor.value
    flushTyping()
    pushUndo({ value: before, selectionStart, selectionEnd })
    editor.value = before.slice(0, selectionStart) + open + close + before.slice(selectionEnd)
    editor.focus()
    editor.setSelectionRange(selectionStart + open.length, selectionStart + open.length)
    persistCurrent()
    updateCount()
    renderMarkdown()
    showUndo(label)
    return
  }
  applyOp(label, text => open + text + close)
}

// 代码块
function applyMdCodeBlock() {
  const editor = $('editor')
  const { selectionStart, selectionEnd } = editor
  const before = editor.value
  flushTyping()
  pushUndo({ value: before, selectionStart, selectionEnd })
  if (selectionEnd > selectionStart) {
    const selected = before.slice(selectionStart, selectionEnd).replace(/\n$/, '')
    const replaced = '```\n' + selected + '\n```'
    editor.value = before.slice(0, selectionStart) + replaced + before.slice(selectionEnd)
    editor.focus()
    editor.setSelectionRange(selectionStart, selectionStart + replaced.length)
  } else {
    const insert = '```\n\n```'
    editor.value = before.slice(0, selectionStart) + insert + before.slice(selectionEnd)
    editor.focus()
    editor.setSelectionRange(selectionStart + 4, selectionStart + 4)
  }
  persistCurrent()
  updateCount()
  renderMarkdown()
  showUndo('代码块')
}

function applyMdMermaidBlock() {
  const editor = $('editor')
  const { selectionStart, selectionEnd } = editor
  const before = editor.value
  flushTyping()
  pushUndo({ value: before, selectionStart, selectionEnd })
  if (selectionEnd > selectionStart) {
    const selected = before.slice(selectionStart, selectionEnd).replace(/\n$/, '')
    const replaced = '```mermaid\n' + selected + '\n```'
    editor.value = before.slice(0, selectionStart) + replaced + before.slice(selectionEnd)
    editor.focus()
    editor.setSelectionRange(selectionStart, selectionStart + replaced.length)
  } else {
    const insert = '```mermaid\ngraph LR\n  A --> B\n```'
    editor.value = before.slice(0, selectionStart) + insert + before.slice(selectionEnd)
    editor.focus()
    editor.setSelectionRange(selectionStart + '```mermaid\n'.length, selectionStart + insert.length - '\n```'.length)
  }
  persistCurrent()
  updateCount()
  renderMarkdown()
  showUndo('流程图')
}

// 分割线
function applyMdHr() {
  const editor = $('editor')
  const { selectionStart, selectionEnd } = editor
  const before = editor.value
  const pos = selectionEnd
  flushTyping()
  pushUndo({ value: before, selectionStart, selectionEnd })
  const needLeading = pos > 0 && before[pos - 1] !== '\n'
  const needTrailing = pos < before.length && before[pos] !== '\n'
  const insert = (needLeading ? '\n' : '') + '---' + (needTrailing ? '\n' : '')
  editor.value = before.slice(0, pos) + insert + before.slice(pos)
  const newPos = pos + insert.length
  editor.focus()
  editor.setSelectionRange(newPos, newPos)
  persistCurrent()
  updateCount()
  renderMarkdown()
  showUndo('分割线')
}

function parseMdCsvTableRows(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  const pushField = () => { row.push(field.trim()); field = '' }
  const pushRow = () => {
    pushField()
    if (row.some(cell => cell !== '')) rows.push(row)
    row = []
  }
  const source = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushRow()
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) pushRow()
  return rows
}

function mdTableCell(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
}

function csvToMarkdownTable(text) {
  const rows = parseMdCsvTableRows(text)
  if (!rows.length) throw new Error('没有可转换的 CSV 内容')
  const cols = Math.max(...rows.map(row => row.length))
  if (cols < 1) throw new Error('没有可转换的 CSV 列')
  const normalized = rows.map(row => {
    const next = row.slice(0, cols)
    while (next.length < cols) next.push('')
    return next
  })
  const head = normalized[0]
  const body = normalized.slice(1)
  const line = row => '| ' + row.map(mdTableCell).join(' | ') + ' |'
  return [
    line(head),
    '| ' + Array.from({ length: cols }, () => ':---:').join(' | ') + ' |',
    ...body.map(line)
  ].join('\n')
}

$('md-tools').addEventListener('click', e => {
  const btn = e.target.closest('[data-md-op]')
  if (!btn) return
  switch (btn.dataset.mdOp) {
    case 'h1':          applyOp('一级标题', mdLinePrefixFn('# ')); break
    case 'h2':          applyOp('二级标题', mdLinePrefixFn('## ')); break
    case 'h3':          applyOp('三级标题', mdLinePrefixFn('### ')); break
    case 'bullet':      applyOp('无序标号', mdLinePrefixFn('- ')); break
    case 'ordered':     applyOp('有序编号', ops.addLineNumbers); break
    case 'task':         applyOp('任务选择', mdTaskListFn); break
    case 'blockquote':  applyOp('引用', mdLinePrefixFn('> ')); break
    case 'codeblock':   applyMdCodeBlock(); break
    case 'mermaid':     applyMdMermaidBlock(); break
    case 'bold':        applyMdInline('**', '**', '加粗'); break
    case 'italic':      applyMdInline('*', '*', '斜体'); break
    case 'inlinecode':  applyMdInline('`', '`', '行内代码'); break
    case 'strikethrough': applyMdInline('~~', '~~', '删除线'); break
    case 'sup':         applyMdInline('<sup>', '</sup>', '上标'); break
    case 'sub':         applyMdInline('<sub>', '</sub>', '下标'); break
    case 'comment':     applyMdInline('<small>注：', '</small>', '注释'); break
    case 'hr':          applyMdHr(); break
    case 'csvtable':    applyOp('CSV 转 Markdown 表格', csvToMarkdownTable); break
  }
})

// ==================== 代码面板 ====================

$('lang-tools-code').addEventListener('click', e => {
  const btn = e.target.closest('[data-code-op]')
  if (!btn) return
  switch (btn.dataset.codeOp) {
    case 'format': {
      const lang = $('lang-select').value
      if (lang === 'python') runPythonFormat()
      else if (lang === 'html') applyOp('HTML格式化', ops.htmlFormat)
      break
    }
    case 'camel': applyOp('驼峰命名', ops.toCamelCase); break
    case 'snake': applyOp('下划线命名', ops.toSnakeCase); break
    case 'kebab': applyOp('中横线命名', ops.toKebabCase); break
  }
})

// ==================== JSON 面板 ====================

$('lang-tools-json').addEventListener('click', e => {
  const btn = e.target.closest('[data-json-op]')
  if (!btn) return
  switch (btn.dataset.jsonOp) {
    case 'format':  applyOp('JSON格式化', ops.jsonFormat); break
    case 'minify':  applyOp('JSON压缩', ops.jsonMinify); break
    case 'toArray': applyOp('转为数组', ops.jsonToArray); break
    case 'wrapObject': applyOp('加{}包裹', ops.jsonWrapObject); break
    case 'unwrap':  applyOp('去外层括号', ops.jsonUnwrap); break
    case 'camel':   applyOp('驼峰命名', ops.toCamelCase); break
    case 'snake':   applyOp('下划线命名', ops.toSnakeCase); break
    case 'kebab':   applyOp('中横线命名', ops.toKebabCase); break
    case 'toYaml':  applyOp('转为YAML', text => { const r = ops.jsonToYaml(text); saveLang('yaml'); applyLang('yaml'); return r }); break
  }
})

// ==================== YAML 面板 ====================

$('lang-tools-yaml').addEventListener('click', e => {
  const btn = e.target.closest('[data-yaml-op]')
  if (!btn) return
  switch (btn.dataset.yamlOp) {
    case 'toJson': applyOp('转为JSON', text => { const r = ops.yamlToJson(text); saveLang('json'); applyLang('json'); return r }); break
  }
})
