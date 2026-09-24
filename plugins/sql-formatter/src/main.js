import './styles.css'
import { DIALECTS, extractSqlFromAction, formatSql } from './formatter.js'

const SETTINGS_KEY = 'ztools-sql-formatter-settings-v1'
const AUTO_FORMAT_DELAY = 300

let autoFormatTimer

const elements = {
  input: document.querySelector('#inputSql'),
  output: document.querySelector('#outputSql'),
  language: document.querySelector('#languageSelect'),
  keywordCase: document.querySelector('#keywordCaseSelect'),
  tabWidth: document.querySelector('#tabWidthSelect'),
  denseOperators: document.querySelector('#denseOperatorsInput'),
  formatButton: document.querySelector('#formatButton'),
  pasteButton: document.querySelector('#pasteButton'),
  clearButton: document.querySelector('#clearButton'),
  copyButton: document.querySelector('#copyButton'),
  inputStats: document.querySelector('#inputStats'),
  outputStats: document.querySelector('#outputStats'),
  status: document.querySelector('#statusText')
}

/**
 * 读取本地保存的格式化偏好。
 * @returns {{language: string, keywordCase: string, tabWidth: number, denseOperators: boolean}} 已归一化的偏好。
 */
function loadSettings() {
  try {
    return {
      language: 'sql',
      keywordCase: 'preserve',
      tabWidth: 2,
      denseOperators: false,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    }
  } catch {
    return { language: 'sql', keywordCase: 'preserve', tabWidth: 2, denseOperators: false }
  }
}

/**
 * 获取当前界面中的格式化偏好。
 * @returns {{language: string, keywordCase: string, tabWidth: number, denseOperators: boolean}} 当前偏好。
 */
function getSettings() {
  return {
    language: elements.language.value,
    keywordCase: elements.keywordCase.value,
    tabWidth: Number(elements.tabWidth.value),
    denseOperators: elements.denseOperators.checked
  }
}

/**
 * 保存当前偏好，供下次打开插件时恢复。
 * @returns {void} 无返回值。
 */
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(getSettings()))
}

/**
 * 设置状态栏消息及语义样式。
 * @param {string} message 消息文本。
 * @param {'normal'|'success'|'error'} tone 消息语气。
 * @returns {void} 无返回值。
 */
function setStatus(message, tone = 'normal') {
  elements.status.textContent = message
  elements.status.dataset.tone = tone
}

/**
 * 更新输入输出的字符和行数统计。
 * @returns {void} 无返回值。
 */
function updateStats() {
  const input = elements.input.value
  const output = elements.output.value
  elements.inputStats.textContent = `${input.length} 字符${input ? ` · ${input.split('\n').length} 行` : ''}`
  elements.outputStats.textContent = output
    ? `${output.length} 字符 · ${output.split('\n').length} 行`
    : '等待格式化'
  elements.copyButton.disabled = !output
}

/**
 * 执行格式化，并更新结果区域。
 * @param {{quiet?: boolean}} options 是否减少成功提示。
 * @returns {boolean} 格式化是否成功。
 */
function runFormat({ quiet = false } = {}) {
  try {
    const result = formatSql(elements.input.value, getSettings())
    elements.output.value = result
    updateStats()
    if (!quiet) setStatus('格式化完成', 'success')
    return true
  } catch (error) {
    elements.output.value = ''
    updateStats()
    setStatus(error instanceof Error ? error.message : 'SQL 格式化失败', 'error')
    return false
  }
}

/**
 * 输入停止片刻后自动格式化，避免每次按键都重复执行格式化器。
 * @returns {void} 无返回值。
 */
function scheduleAutoFormat() {
  clearTimeout(autoFormatTimer)
  updateStats()

  if (!elements.input.value.trim()) {
    elements.output.value = ''
    updateStats()
    setStatus('等待输入 SQL')
    return
  }

  autoFormatTimer = setTimeout(() => runFormat({ quiet: true }), AUTO_FORMAT_DELAY)
}

/**
 * 将格式化结果写入系统剪贴板。
 * @returns {Promise<void>} 复制完成后结束的 Promise。
 */
async function copyOutput() {
  const text = elements.output.value
  if (!text) return

  try {
    if (window.ztools?.copyText) {
      window.ztools.copyText(text)
    } else {
      await navigator.clipboard.writeText(text)
    }
    setStatus('已复制格式化结果', 'success')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '复制失败', 'error')
  }
}

/**
 * 从自定义 preload 或浏览器剪贴板读取文本。
 * @returns {Promise<void>} 粘贴完成后结束的 Promise。
 */
async function pasteInput() {
  try {
    const text = window.sqlFormatterBridge?.readClipboardText
      ? window.sqlFormatterBridge.readClipboardText()
      : await navigator.clipboard.readText()
    elements.input.value = text
    updateStats()
    if (text.trim()) runFormat()
    elements.input.focus()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '无法读取剪贴板', 'error')
  }
}

/**
 * 处理 ZTools 指令进入事件，并在正则命中 SQL 时自动填充与格式化。
 * @param {{type?: string, payload?: unknown}} action ZTools 进入事件。
 * @returns {void} 无返回值。
 */
function handlePluginEnter(action) {
  const sql = extractSqlFromAction(action)
  if (sql) {
    elements.input.value = sql
    updateStats()
    runFormat({ quiet: true })
  }
  requestAnimationFrame(() => elements.input.focus())
}

// 构建方言选项并恢复上次使用的偏好。
for (const [value, label] of DIALECTS) {
  elements.language.add(new Option(label, value))
}
const settings = loadSettings()
elements.language.value = settings.language
elements.keywordCase.value = settings.keywordCase
elements.tabWidth.value = String(settings.tabWidth)
elements.denseOperators.checked = Boolean(settings.denseOperators)

// 将所有选项变更统一保存；已有结果时同步刷新，避免配置与结果不一致。
for (const control of [
  elements.language,
  elements.keywordCase,
  elements.tabWidth,
  elements.denseOperators
]) {
  control.addEventListener('change', () => {
    saveSettings()
    if (elements.input.value.trim()) runFormat({ quiet: true })
  })
}

elements.input.addEventListener('input', scheduleAutoFormat)
elements.formatButton.addEventListener('click', () => {
  clearTimeout(autoFormatTimer)
  runFormat()
})
elements.copyButton.addEventListener('click', copyOutput)
elements.pasteButton.addEventListener('click', pasteInput)
elements.clearButton.addEventListener('click', () => {
  clearTimeout(autoFormatTimer)
  elements.input.value = ''
  elements.output.value = ''
  updateStats()
  setStatus('已清空')
  elements.input.focus()
})

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault()
    runFormat()
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    void copyOutput()
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v') {
    event.preventDefault()
    void pasteInput()
  }
})

// 公共 preload 可能在页面脚本之前或之后完成注入，因此同时兼容两种时序。
if (window.ztools?.onPluginEnter) {
  window.ztools.onPluginEnter(handlePluginEnter)
  void window.ztools.setExpendHeight?.(600)
}

updateStats()
elements.input.focus()
