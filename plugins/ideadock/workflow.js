// ==================== 工作流 + 自定义脚本 ====================
// 从 app.js 抽出。依赖 app.js 提供的全局：$ / storeGet / storeSet /
// ops / showToast / addSlot / persistCurrent / updateCount 等，以及
// 脚本执行所需的 window.textTool。必须在 app.js 之后加载。
// 文件末尾顶层调用 loadScripts() / initWorkflowUI() 在 parse 期执行，
// 依赖上述全局与 DOM 元素已就绪（脚本位于 body 末尾）。

const WORKFLOWS_KEY = 'ideadock.workflows'

const WORKFLOW_OPS = [
  { key: 'trimLines',          label: '去首尾空格' },
  { key: 'removeEmptyLines',   label: '去除空行' },
  { key: 'addLineSpacing',     label: '行间插空行' },
  { key: 'addLineNumbers',     label: '有序行编号' },
  { key: 'addBulletPoints',    label: '无序行编号' },
  { key: 'removeLineNumbers',  label: '删除行编号' },
  { key: 'prependRandomEmoji', label: '随机行首Emoji' },
  { key: 'removeLineBreaks',   label: '合并为一行' },
  { key: 'dedupeLines',        label: '行去重' },
  { key: 'sortLinesAsc',       label: '排序(升)' },
  { key: 'sortLinesDesc',      label: '排序(降)' },
  { key: 'normalizeSpaces',    label: '合并空格' },
  { key: 'removeAllSpaces',    label: '去除空格' },
  { key: 'tabToSpace',         label: 'Tab→空格' },
  { key: 'toHalfWidth',        label: '全角→半角' },
  { key: 'toFullWidth',        label: '半角→全角' },
  { key: 'toUpperCase',        label: '英文转大写' },
  { key: 'toLowerCase',        label: '英文转小写' },
  { key: 'capitalizeWords',    label: '首字母大写' },
  { key: 'toCamelCase',        label: '驼峰' },
  { key: 'toSnakeCase',        label: '下划线' },
  { key: 'toKebabCase',        label: '中横线' },
  { key: 'base64Encode',       label: 'Base64编码' },
  { key: 'base64Decode',       label: 'Base64解码' },
  { key: 'urlEncode',          label: 'URL编码' },
  { key: 'urlDecode',          label: 'URL解码' },
  { key: 'unicodeEscape',      label: 'Unicode转义' },
  { key: 'unicodeUnescape',    label: 'Unicode反转义' },
  { key: 'jsonFormat',         label: 'JSON格式化' },
  { key: 'jsonMinify',         label: 'JSON压缩' },
  { key: 'jsonToArray',        label: '转为数组' },
  { key: 'jsonWrapObject',     label: '加{}包裹' },
  { key: 'jsonUnwrap',         label: '去外层括号' },
  { key: 'htmlFormat',         label: 'HTML格式化' },
  { key: 'copyToClipboard',    label: '复制剪贴板', isOutput: true },
]

const WORKFLOW_OP_GROUPS = [
  { label: '行处理', keys: ['trimLines','removeEmptyLines','addLineSpacing','addLineNumbers','addBulletPoints','removeLineNumbers','prependRandomEmoji','removeLineBreaks','dedupeLines','sortLinesAsc','sortLinesDesc'] },
  { label: '空白',   keys: ['normalizeSpaces','removeAllSpaces','tabToSpace'] },
  { label: '大小写', keys: ['toHalfWidth','toFullWidth','toUpperCase','toLowerCase','capitalizeWords','toCamelCase','toSnakeCase','toKebabCase'] },
  { label: '编码',   keys: ['base64Encode','base64Decode','urlEncode','urlDecode','unicodeEscape','unicodeUnescape'] },
  { label: 'JSON',   keys: ['jsonFormat','jsonMinify','jsonToArray','jsonWrapObject','jsonUnwrap','htmlFormat'] },
]

let wfList = []
let wfActive = 0

function loadWorkflows() {
  try {
    const raw = storeGet(WORKFLOWS_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      wfList = Array.isArray(saved.list) && saved.list.length > 0 ? saved.list : [{ steps: [] }]
      wfActive = Math.min(saved.active ?? 0, wfList.length - 1)
    } else {
      wfList = [{ steps: [] }]
      wfActive = 0
    }
  } catch {
    wfList = [{ steps: [] }]
    wfActive = 0
  }
}

function persistWorkflows() {
  storeSet(WORKFLOWS_KEY, JSON.stringify({ list: wfList, active: wfActive }))
}

async function execScriptStep(s, text) {
  if (s.lang === 'python') {
    if (!window.textTool?.runPython) throw new Error('Python 需要 uTools 运行环境')
    const { python: pythonBin = '' } = loadRuntimeConfig()
    const escaped = text.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')
    const wrapped = `text = """${escaped}"""\ndef __script(text):\n${s.code.split('\n').map(l => '  ' + l).join('\n')}\nprint(__script(text))`
    const { stdout, stderr } = await window.textTool.runPython(wrapped, 30, pythonBin)
    const out = (stdout || '').trimEnd()
    if (!out && stderr) throw new Error('Python: ' + stderr.trim().split('\n').pop())
    return out
  }
  const r = new Function('text', s.code)(text)
  return r !== undefined ? String(r) : text
}

async function execWorkflowAt(index, text) {
  let result = text
  for (const key of (wfList[index]?.steps || [])) {
    if (key === 'copyToClipboard') {
      if (window.ideadockHost.supports('copyText')) window.ideadockHost.copyText(result)
      else navigator.clipboard?.writeText(result).catch(() => {})
    } else if (key.startsWith('script:')) {
      const id = parseInt(key.slice(7), 10)
      const s = scripts.find(sc => sc.id === id)
      if (s) {
        try { result = await execScriptStep(s, result) } catch (e) { showToast(e.message) }
      }
    } else if (ops[key]) {
      result = ops[key](result)
    }
  }
  return result
}

function renderWorkflowRows() {
  const container = $('workflow-rows')
  container.innerHTML = ''
  wfList.forEach((wf, ri) => {
    const row = document.createElement('div')
    row.className = 'workflow-row'

    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'wf-active'
    radio.className = 'wf-row-radio'
    radio.checked = ri === wfActive
    radio.title = 'uTools run-workflow 入口将执行此工作流'
    radio.addEventListener('change', () => { wfActive = ri; persistWorkflows() })
    row.appendChild(radio)

    const chips = document.createElement('div')
    chips.className = 'wf-row-chips'
    if (wf.steps.length === 0) {
      chips.innerHTML = '<span class="workflow-empty">从上方选择操作</span>'
    } else {
      wf.steps.forEach((key, ci) => {
        const def = WORKFLOW_OPS.find(o => o.key === key)
        let chipLabel, isScript = false
        if (key.startsWith('script:')) {
          const id = parseInt(key.slice(7), 10)
          const s = scripts.find(sc => sc.id === id)
          chipLabel = (s ? (s.name || '未命名') : '已删除脚本')
          isScript = true
        } else {
          chipLabel = def ? def.label : key
        }
        if (ci > 0) {
          const arrow = document.createElement('span')
          arrow.className = 'wf-arrow'
          arrow.textContent = '→'
          chips.appendChild(arrow)
        }
        const chip = document.createElement('div')
        chip.className = 'workflow-chip' + (def?.isOutput ? ' workflow-chip-output' : '') + (isScript ? ' workflow-chip-script' : '')
        const lbl = document.createElement('span')
        lbl.className = 'wf-chip-label'
        lbl.textContent = chipLabel
        const del = document.createElement('button')
        del.className = 'wf-chip-del'
        del.textContent = '×'
        del.dataset.ri = ri
        del.dataset.ci = ci
        chip.append(lbl, del)
        chips.appendChild(chip)
      })
    }
    row.appendChild(chips)

    const execBtn = document.createElement('button')
    execBtn.className = 'btn-tool wf-row-exec'
    execBtn.textContent = '执行'
    execBtn.dataset.ri = ri
    row.appendChild(execBtn)

    if (wfList.length > 1) {
      const rowDel = document.createElement('button')
      rowDel.className = 'wf-row-del'
      rowDel.textContent = '×'
      rowDel.dataset.ri = ri
      row.appendChild(rowDel)
    }

    container.appendChild(row)
  })
}

function renderWorkflowOpsPool() {
  const pool = $('workflow-ops-pool')
  if (!pool) return
  pool.innerHTML = ''
  const makeCard = (text, cls, title, onClick) => {
    const btn = document.createElement('button')
    btn.className = 'wf-op-card' + (cls ? ' ' + cls : '')
    btn.textContent = text
    if (title) btn.title = title
    btn.addEventListener('click', onClick)
    return btn
  }
  const push = key => { if (!wfList[wfActive]) return; wfList[wfActive].steps.push(key); persistWorkflows(); renderWorkflowRows() }

  // 普通操作：铺平成一个 grid
  const mainGrid = document.createElement('div')
  mainGrid.className = 'wf-op-grid'
  WORKFLOW_OPS.filter(o => !o.isOutput).forEach(({ key, label }) =>
    mainGrid.appendChild(makeCard(label, '', '', () => push(key)))
  )
  scripts.forEach(s =>
    mainGrid.appendChild(makeCard('脚本-' + (s.name || '未命名'), '', s.desc || '', () => push('script:' + s.id)))
  )
  pool.appendChild(mainGrid)

  // 输出单独一行，绿色
  const outputRow = document.createElement('div')
  outputRow.className = 'wf-op-output-row'
  const outputDef = WORKFLOW_OPS.find(o => o.key === 'copyToClipboard')
  if (outputDef) outputRow.appendChild(makeCard(outputDef.label, 'is-output', '', () => push('copyToClipboard')))
  pool.appendChild(outputRow)
}

function initWorkflowUI() {
  loadWorkflows()
  renderWorkflowOpsPool()
  renderWorkflowRows()
}

$('workflow-rows').addEventListener('click', e => {
  const chipDel = e.target.closest('.wf-chip-del')
  if (chipDel) {
    wfList[+chipDel.dataset.ri].steps.splice(+chipDel.dataset.ci, 1)
    persistWorkflows()
    renderWorkflowRows()
    return
  }
  const execBtn = e.target.closest('.wf-row-exec')
  if (execBtn) {
    const ri = +execBtn.dataset.ri
    try { applyOp('执行工作流', text => execWorkflowAt(ri, text)) }
    catch (err) { showToast(err.message) }
    return
  }
  const rowDel = e.target.closest('.wf-row-del')
  if (rowDel) {
    const ri = +rowDel.dataset.ri
    wfList.splice(ri, 1)
    if (wfActive >= wfList.length) wfActive = wfList.length - 1
    persistWorkflows()
    renderWorkflowRows()
  }
})

$('btn-add-workflow').addEventListener('click', () => {
  wfList.push({ steps: [] })
  persistWorkflows()
  renderWorkflowRows()
})

// initWorkflowUI() 在 loadScripts() 之后调用，确保自定义脚本已加载

// ==================== 自定义脚本 ====================

const SCRIPTS_KEY = 'ideadock.scripts'
let scripts = []
let scriptsActive = 0
let scriptsLang = 'js'

function loadScripts() {
  try {
    const raw = storeGet(SCRIPTS_KEY)
    scripts = raw ? JSON.parse(raw) : [
      { id: Date.now(), name: '转大写', desc: '英文全转大写', lang: 'js', code: 'return text.toUpperCase()' },
      { id: Date.now() + 1, name: '行排序去重', desc: '按行排序并去重', lang: 'js', code: 'return [...new Set(text.split("\\n"))].sort().join("\\n")' }
    ]
  } catch { scripts = [] }
}
function saveScripts() { storeSet(SCRIPTS_KEY, JSON.stringify(scripts)); renderWorkflowOpsPool() }

// 单击选中 / 双击编辑：用 click 事件的 detail 属性区分（1=单击, 2=双击）
function handleItemClick(e, i) {
  if (e.target.closest('button')) return  // 按钮由其自身处理
  if (e.detail === 1) { scriptsActive = i; switchScript(i) }
}
function handleNameClick(e, i, span) {
  if (e.target.closest('button')) return
  if (e.detail >= 2) { beginEditName(span, i) }
}
function handleDescClick(e, i, span) {
  if (e.target.closest('button')) return
  if (e.detail >= 2) { beginEditDesc(span, i) }
}

function defaultScriptName(i) {
  const s = scripts[i]
  if (!s) return '未命名'
  const firstLine = (s.code || '').split('\n')[0].replace(/^\/\/|^#/, '').trim()
  return firstLine.slice(0, 24) || '未命名'
}

function beginEditName(span, i) {
  const s = scripts[i]
  beginEdit(span, 'script-item-name-input', s.name || '',
    v => { s.name = v || defaultScriptName(i) })
}
function beginEditDesc(span, i) {
  const s = scripts[i]
  beginEdit(span, 'script-item-desc-input', s.desc || '',
    v => { s.desc = v })
}

// 将 span 转为 input 进入编辑态
function beginEdit(span, cls, curVal, setVal) {
  const input = document.createElement('input')
  input.className = cls
  input.value = curVal
  span.replaceWith(input)
  input.focus()
  input.select()
  const commit = () => { setVal(input.value.trim()); saveScripts(); renderScriptsList() }
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { input.blur() } })
}

function renderScriptsList() {
  const container = $('scripts-list')
  container.innerHTML = ''
  scripts.forEach((s, i) => {
    const item = document.createElement('div')
    item.className = 'script-item' + (i === scriptsActive ? ' active' : '')
    // item 本身响应单击选中
    item.addEventListener('click', e => handleItemClick(e, i))

    // Row 1: lang tag + name
    const row1 = document.createElement('div'); row1.className = 'script-item-row1'
    const lang = document.createElement('span'); lang.className = 'script-item-lang'; lang.textContent = s.lang === 'python' ? 'Py' : 'JS'
    const nameEl = document.createElement('span')
    nameEl.className = 'script-item-name'
    nameEl.textContent = s.name || '未命名'
    if (!s.name) nameEl.classList.add('is-placeholder')
    nameEl.addEventListener('click', e => handleNameClick(e, i, nameEl))
    row1.append(lang, nameEl)

    // Row 2: desc + actions
    const row2 = document.createElement('div'); row2.className = 'script-item-row2'
    const descEl = document.createElement('span')
    descEl.className = 'script-item-desc'
    descEl.textContent = s.desc || '描述...'
    if (!s.desc) descEl.classList.add('is-placeholder')
    descEl.addEventListener('click', e => handleDescClick(e, i, descEl))
    const actions = document.createElement('div'); actions.className = 'script-item-actions'
    const execBtn = document.createElement('button'); execBtn.className = 'script-item-exec'; execBtn.textContent = '执行'
    execBtn.addEventListener('click', e => { e.stopPropagation(); execScript(i) })
    const delBtn = document.createElement('button'); delBtn.className = 'script-item-del'; delBtn.textContent = '×'
    delBtn.addEventListener('click', e => {
      e.stopPropagation()
      scripts.splice(i, 1)
      if (scriptsActive >= scripts.length) scriptsActive = Math.max(0, scripts.length - 1)
      saveScripts(); renderScriptsList()
      if (scripts.length) switchScript(scriptsActive); else clearScriptEditor()
    })
    actions.append(execBtn, delBtn)
    row2.append(descEl, actions)

    item.append(row1, row2)
    container.appendChild(item)
  })

  // 新建脚本时自动进入名称编辑
  if (scripts.length && !scripts[scriptsActive]?.name) {
    const activeItem = container.children[scriptsActive]
    if (activeItem) {
      const nameEl = activeItem.querySelector('.script-item-name')
      if (nameEl) setTimeout(() => beginEditName(nameEl, scriptsActive), 80)
    }
  }
}

function switchScript(i) {
  scriptsActive = i
  const s = scripts[i]
  if (!s) return
  scriptsLang = s.lang
  $('script-code').value = s.code || ''
  document.querySelectorAll('.script-lang-btn').forEach(b => b.classList.toggle('active', b.dataset.sl === s.lang))
  renderScriptsList()
}

function clearScriptEditor() { $('script-code').value = '' }

async function execScript(i) {
  const s = scripts[i]
  if (!s) return
  const text = $('editor').value
  if (!text.trim()) { showToast('编辑区无内容'); return }
  try {
    if (s.lang === 'python') {
      if (!window.textTool?.runPython) { showToast('Python 需要运行环境支持（uTools 插件环境）'); return }
      const { python: pythonBin = '' } = loadRuntimeConfig()
      const escaped = text.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')
      // 将用户代码包装为返回值的函数，和 JS 保持一致的 return 模式
      const wrapped = `text = """${escaped}"""\ndef __script(text):\n${s.code.split('\n').map(l => '  ' + l).join('\n')}\nprint(__script(text))`
      try {
        const { stdout, stderr } = await window.textTool.runPython(wrapped, 30, pythonBin)
        const result = (stdout || '').trimEnd()
        if (!result && stderr) showToast('Python: ' + stderr.trim().split('\n').pop())
        else applyOp('执行脚本: ' + (s.name || '未命名'), () => result)
      } catch { showToast('Python 执行失败') }
      return
    }
    const fn = new Function('text', s.code)
    const result = fn(text)
    if (result !== undefined) {
      applyOp('执行脚本: ' + (s.name || '未命名'), () => String(result))
    }
  } catch (err) { showToast('脚本错误: ' + err.message) }
}

// Lang toggle
document.querySelectorAll('.script-lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    scriptsLang = btn.dataset.sl
    document.querySelectorAll('.script-lang-btn').forEach(b => b.classList.toggle('active', b.dataset.sl === scriptsLang))
    if (scripts[scriptsActive]) { scripts[scriptsActive].lang = scriptsLang; saveScripts(); renderScriptsList() }
  })
})

// Auto-save code on input (debounced)
let scriptSaveTimer = 0
$('script-code').addEventListener('input', () => {
  const s = scripts[scriptsActive]
  if (!s) return
  clearTimeout(scriptSaveTimer)
  scriptSaveTimer = setTimeout(() => {
    s.code = $('script-code').value
    s.lang = scriptsLang
    saveScripts()
  }, 600)
})

// Add new script
$('btn-add-script').addEventListener('click', () => {
  scripts.push({ id: Date.now(), name: '', desc: '', lang: scriptsLang, code: 'return text' })
  scriptsActive = scripts.length - 1
  saveScripts()
  renderScriptsList()
  switchScript(scriptsActive)
})

loadScripts()
initWorkflowUI()
if (scripts.length) switchScript(0)   // 初始渲染脚本列表并选中第一条（抽取时遗漏，补回）
