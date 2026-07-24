// ==================== 运行环境配置 + Python/JS 执行面板 ====================
// 从 app.js 抽出：运行时/AI 配置、设置弹窗、Python/Node 代码执行、
// Markdown/HTML 预览触发、代码格式化。依赖 app.js 全局：$ / storeGet /
// storeSet / applyOp / ops / getActiveSlot / updateCount / persistCurrent /
// showToast / renderMarkdown 等，以及 window.textTool（运行/检测）。
// 必须在 app.js 之后加载；顶层仅注册按钮事件（依赖 $ 与 body DOM）。

const RUNTIME_CONFIG_KEY = 'ideadock.runtimeConfig'
const AI_CONFIG_KEY = 'ideadock.aiConfig'

function loadAiConfig() {
  try { return JSON.parse(storeGet(AI_CONFIG_KEY) || '{}') } catch { return {} }
}

function saveAiConfig(cfg) {
  storeSet(AI_CONFIG_KEY, JSON.stringify(cfg))
}

function loadRuntimeConfig() {
  try { return JSON.parse(storeGet(RUNTIME_CONFIG_KEY) || '{}') } catch { return {} }
}

function saveRuntimeConfig(cfg) {
  storeSet(RUNTIME_CONFIG_KEY, JSON.stringify(cfg))
}

function aiLegacyProviderBin(command, provider, suffixRe) {
  const value = String(command || '').trim()
  if (!value) return ''
  const normalized = value.replace(/^['"]|['"]$/g, '').toLowerCase()
  if (!normalized.includes(provider)) return ''
  return value.replace(suffixRe, '').trim()
}

function validAiBin(value, provider, otherProvider) {
  const text = String(value || '').trim()
  if (!text) return ''
  const normalized = text.toLowerCase()
  if (normalized.includes(otherProvider) && !normalized.includes(provider)) return ''
  return text
}

function isBareAiCommand(value, provider) {
  const text = String(value || '').trim().replace(/^['"]|['"]$/g, '')
  if (!text) return true
  const lower = text.toLowerCase()
  if (lower === provider || lower === provider + '.cmd' || lower === provider + '.exe') return true
  return !/[\\/]/.test(text) && !/^[a-zA-Z]:/.test(text)
}

function resolveAiBin(saved, detected, provider, otherProvider, legacy) {
  const valid = validAiBin(saved, provider, otherProvider)
  if (valid && !isBareAiCommand(valid, provider)) return valid
  return detected || legacy || valid || provider
}

function openSettingsModal() {
  const cfg = loadRuntimeConfig()
  const aiCfg = loadAiConfig()
  let detected = {}
  $('cfg-theme').value = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  if (window.textTool) {
    detected = window.textTool.detectBinaries()
    $('cfg-python-bin').value = cfg.python !== undefined ? cfg.python : (detected.python || '')
    $('cfg-node-bin').value = cfg.node !== undefined ? cfg.node : (detected.node || '')
  } else {
    $('cfg-python-bin').value = cfg.python || ''
    $('cfg-node-bin').value = cfg.node || ''
  }
  $('cfg-ai-codex-bin').value = resolveAiBin(
    aiCfg.codexBin,
    detected.codex,
    'codex',
    'claude',
    aiLegacyProviderBin(aiCfg.command, 'codex', /\s+exec\s+-\s*$/)
  )
  $('cfg-ai-claude-bin').value = resolveAiBin(
    aiCfg.claudeBin,
    detected.claude,
    'claude',
    'codex',
    aiLegacyProviderBin(aiCfg.command, 'claude', /\s+-p\s*$/)
  )
  $('cfg-ai-url').value = aiCfg.url || ''
  $('cfg-ai-model').value = aiCfg.model || ''
  $('cfg-ai-key').value = aiCfg.apiKey || ''
  $('runtime-config-modal').style.display = ''
}

$('btn-theme').addEventListener('click', openSettingsModal)

$('runtime-config-overlay').addEventListener('click', () => {
  $('runtime-config-modal').style.display = 'none'
})

$('cfg-cancel').addEventListener('click', () => {
  $('runtime-config-modal').style.display = 'none'
})

$('cfg-save').addEventListener('click', () => {
  const cfg = {
    python: $('cfg-python-bin').value.trim(),
    node: $('cfg-node-bin').value.trim()
  }
  const prevAiCfg = loadAiConfig()
  const aiCfg = {
    ...prevAiCfg,
    codexBin: $('cfg-ai-codex-bin').value.trim() || 'codex',
    claudeBin: $('cfg-ai-claude-bin').value.trim() || 'claude',
    url: $('cfg-ai-url').value.trim(),
    model: $('cfg-ai-model').value.trim(),
    apiKey: $('cfg-ai-key').value.trim()
  }
  saveRuntimeConfig(cfg)
  saveAiConfig(aiCfg)
  applyTheme($('cfg-theme').value)
  $('runtime-config-modal').style.display = 'none'
})

$('cfg-python-detect').addEventListener('click', () => {
  if (!window.textTool || !window.textTool.pickExecutable) { showToast('需在 uTools 环境中运行'); return }
  const p = window.textTool.pickExecutable('选择 Python 可执行文件')
  if (p) $('cfg-python-bin').value = p
})

$('cfg-node-detect').addEventListener('click', () => {
  if (!window.textTool || !window.textTool.pickExecutable) { showToast('需在 uTools 环境中运行'); return }
  const p = window.textTool.pickExecutable('选择 Node.js 可执行文件')
  if (p) $('cfg-node-bin').value = p
})

$('cfg-ai-codex-detect').addEventListener('click', () => {
  if (!window.textTool || !window.textTool.pickExecutable) { showToast('需要在 uTools 环境中运行'); return }
  const p = window.textTool.pickExecutable('选择 Codex 可执行文件')
  if (p) $('cfg-ai-codex-bin').value = p
})

$('cfg-ai-claude-detect').addEventListener('click', () => {
  if (!window.textTool || !window.textTool.pickExecutable) { showToast('需要在 uTools 环境中运行'); return }
  const p = window.textTool.pickExecutable('选择 Claude 可执行文件')
  if (p) $('cfg-ai-claude-bin').value = p
})
// ==================== Python 执行面板 ====================

let pythonRunning = false

async function runPythonCode() {
  if (pythonRunning) return
  if (!window.textTool || !window.textTool.runPython) {
    showToast('Python 执行不可用（需在 uTools 环境中运行）')
    return
  }
  const code = $('editor').value.trim()
  if (!code) return

  showLangPanel('python', { render: false })
  pythonRunning = true
  $('btn-run-python').disabled = true
  $('btn-kill-python').style.display = ''
  $('btn-run-python').style.display = 'none'
  const output = $('python-output')
  output.textContent = '运行中...'
  output.className = 'python-output'

  const { python: pythonBin = '' } = loadRuntimeConfig()
  const { stdout, stderr } = await window.textTool.runPython(code, 30, pythonBin)

  const timedOut = stderr.includes('[超时已中断]')
  if (timedOut) showToast('执行超时（30s），已中断')

  const cleanStderr = stderr.replace('\n[超时已中断]', '').trim()
  output.textContent = (stdout + (cleanStderr ? '\n' + cleanStderr : '')).trim() || '（无输出）'
  output.className = 'python-output' + (cleanStderr ? ' has-error' : '')
  pythonRunning = false
  $('btn-run-python').disabled = false
  $('btn-run-python').style.display = ''
  $('btn-kill-python').style.display = 'none'
  window.textTool._currentProc = null
}

async function runPythonFormat() {
  if (!window.textTool || !window.textTool.formatPython) {
    showToast('格式化不可用（需在 uTools 环境中运行）')
    return
  }
  const editor = $('editor')
  const before = editor.value
  // 去除所有行的公共前缀空白（dedent），保留相对缩进，避免顶层缩进导致 black 解析报错
  const lines = before.split(/\r?\n/)
  const minIndent = lines
    .filter(l => l.trim().length > 0)
    .reduce((min, l) => Math.min(min, l.match(/^[ \t]*/)[0].length), Infinity)
  const dedented = minIndent > 0 ? lines.map(l => l.slice(minIndent)).join('\n') : before
  showToast('正在格式化...')
  const { python: pythonBin = '' } = loadRuntimeConfig()
  const { ok, result, error } = await window.textTool.formatPython(dedented, pythonBin)
  if (ok) {
    flushTyping()
    pushUndo({ value: before, selectionStart: 0, selectionEnd: 0 })
    editor.value = result
    persistCurrent()
    updateCount()
    showUndo('代码格式化')
  } else {
    showUndo(null, error)
  }
}

let jsRunning = false

async function runJsCode() {
  if (jsRunning) return
  if (!window.textTool || !window.textTool.runJs) {
    showToast('JS 执行不可用（需在 uTools 环境中运行）')
    return
  }
  const code = $('editor').value.trim()
  if (!code) return

  showLangPanel('js', { render: false })
  jsRunning = true
  $('btn-run-js').disabled = true
  $('btn-kill-js').style.display = ''
  $('btn-run-js').style.display = 'none'
  const output = $('js-output')
  output.textContent = '运行中...'
  output.className = 'python-output'

  const { node: nodeBin = '' } = loadRuntimeConfig()
  const { stdout, stderr } = await window.textTool.runJs(code, 30, nodeBin)

  const timedOut = stderr.includes('[超时已中断]')
  if (timedOut) showToast('执行超时（30s），已中断')

  const cleanStderr = stderr.replace('\n[超时已中断]', '').trim()
  output.textContent = (stdout + (cleanStderr ? '\n' + cleanStderr : '')).trim() || '（无输出）'
  output.className = 'python-output' + (cleanStderr ? ' has-error' : '')
  jsRunning = false
  $('btn-run-js').disabled = false
  $('btn-run-js').style.display = ''
  $('btn-kill-js').style.display = 'none'
  window.textTool._currentJsProc = null
}

function runMarkdownPreview() {
  showLangPanel('markdown')
}

function runHtmlPreview() {
  showLangPanel('html')
}

$('btn-run-python').addEventListener('click', runPythonCode)
$('btn-kill-python').addEventListener('click', () => {
  if (window.textTool) window.textTool.killPython()
})
$('btn-run-js').addEventListener('click', runJsCode)
$('btn-kill-js').addEventListener('click', () => {
  if (window.textTool) window.textTool.killJs()
})
$('btn-run-md').addEventListener('click', runMarkdownPreview)
$('btn-run-html').addEventListener('click', runHtmlPreview)
$('btn-format-lang').addEventListener('click', () => {
  const lang = $('lang-select').value
  if (lang === 'python') runPythonFormat()
  else if (lang === 'json') applyOp('JSON格式化', ops.jsonFormat)
  else if (lang === 'html') applyOp('HTML格式化', ops.htmlFormat)
})
$('btn-json-minify').addEventListener('click', () => applyOp('JSON压缩', ops.jsonMinify))
$('btn-clear-output').addEventListener('click', () => {
  const lang = $('lang-select').value
  showLangPanel(lang, { render: false })
  const el = lang === 'js' ? $('js-output') : $('python-output')
  el.textContent = ''
  el.className = 'python-output'
})

// 供 preload.js MCP 工具调用：同步 slots 后固定指定槽位到桌面
window._pinSlot = (id) => {
  try {
    const raw = storeGet(SLOTS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) slots.splice(0, slots.length, ...arr)
    }
  } catch {}
  if (!pinnedRecords.has(id)) togglePin(id)
}

window._reloadSlotsFromStorage = () => {
  flushTyping()
  loadSlots()
  renderSlots()
  $('editor').value = getActiveSlot().text
  updateCount()
}
